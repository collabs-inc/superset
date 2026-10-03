import type { RealtimeNudgeMessage } from "@superset/shared/realtime";
import {
	type VoiceToolResult,
	type VoiceUiDirective,
	voiceContextMessage,
} from "@superset/shared/voice";
import {
	applyUiDirective,
	type DirectiveRouter,
} from "../applyUiDirective/applyUiDirective";
import { RealtimeClient, type ToolCallRequest } from "../client/RealtimeClient";
import { describeScreen } from "../screenContext";
import { PendingActions } from "../tools/confirmations";
import { executeTool, toolSubject } from "../tools/executeTool";
import type { VoiceData, VoiceWorkspace } from "../tools/types";
import type { RealtimeTransport } from "../transport/RealtimeTransport";
import type { useVoiceLevelsStore } from "../voiceLevelsStore";
import type { VoiceStoreApi } from "../voiceStore";

const LEVELS_INTERVAL_MS = 100;
const RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_MS = [500, 1_500, 4_000];
/** Screen changes faster than this are scrolling, not a new subject. */
const SCREEN_CONTEXT_THROTTLE_MS = 1_500;
/** Keep the model's memory of a dropped session to what still matters. */
const HISTORY_SEED_ENTRIES = 12;

export interface VoiceSessionDeps {
	store: VoiceStoreApi;
	levels: typeof useVoiceLevelsStore;
	data: VoiceData;
	mint: () => Promise<{ clientSecret: string }>;
	createTransport: () => RealtimeTransport;
	router: DirectiveRouter;
	getPathname: () => string;
	onRealtimeNudge: (
		listener: (message: RealtimeNudgeMessage) => void,
	) => () => void;
	newId: () => string;
	now: () => number;
}

/**
 * One voice session from start to end: mints a secret, opens the transport,
 * runs the conversation loop, executes tools, and moves the app. Lives
 * outside React so navigation never unmounts it.
 */
export class VoiceSessionController {
	private transport: RealtimeTransport | null = null;
	private client: RealtimeClient | null = null;
	private readonly pending: PendingActions;
	private readonly knownWorkspaces = new Map<string, VoiceWorkspace>();
	private readonly cleanups: Array<() => void> = [];
	private levelsTimer: ReturnType<typeof setInterval> | null = null;
	private lastScreen: { pathname: string; at: number } | null = null;
	private ended = false;

	constructor(private readonly deps: VoiceSessionDeps) {
		this.pending = new PendingActions(deps.newId, deps.now, (action) =>
			deps.store.getState().setPendingAction(action),
		);
	}

	async start(): Promise<void> {
		const store = this.deps.store.getState();
		store.begin(this.deps.now());
		try {
			await this.connect();
		} catch (error) {
			store.setError(
				error instanceof Error ? error.message : "Could not connect.",
			);
			this.end();
			throw error;
		}
		this.cleanups.push(
			this.deps.onRealtimeNudge((message) => this.onNudge(message)),
		);
		this.levelsTimer = setInterval(() => {
			void this.transport?.getLevels().then((levels) => {
				if (!this.ended) this.deps.levels.getState().set(levels);
			});
		}, LEVELS_INTERVAL_MS);
		this.noteScreen(this.deps.getPathname(), true);
	}

	end(): void {
		if (this.ended) return;
		this.ended = true;
		if (this.levelsTimer) clearInterval(this.levelsTimer);
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.client?.stop();
		this.transport?.close();
		this.client = null;
		this.transport = null;
		this.pending.cancelCurrent();
		this.deps.levels.getState().set({ input: 0, output: 0 });
		this.deps.store.getState().setStatus("ended");
	}

	setMuted(muted: boolean): void {
		this.transport?.setMuted(muted);
		this.deps.store.getState().setMuted(muted);
	}

	interrupt(): void {
		this.client?.interrupt();
	}

	/** The on-screen Approve button. The model is told, so it can say "sent". */
	async confirmPending(): Promise<void> {
		const result = await this.pending.confirmCurrent();
		if (!result) return;
		this.applyDirective(result.ui, true);
		this.client?.addContext(
			voiceContextMessage(
				`The user approved the pending action on screen. Result: ${JSON.stringify(result.output)}`,
			),
			true,
		);
	}

	cancelPending(): void {
		if (!this.pending.cancelCurrent()) return;
		this.client?.addContext(
			voiceContextMessage("The user cancelled the pending action on screen."),
			true,
		);
	}

	/** Called by the layer on every route change. */
	noteScreen(pathname: string, force = false): void {
		const now = this.deps.now();
		if (
			!force &&
			this.lastScreen &&
			(this.lastScreen.pathname === pathname ||
				now - this.lastScreen.at < SCREEN_CONTEXT_THROTTLE_MS)
		) {
			return;
		}
		this.lastScreen = { pathname, at: now };
		const text = describeScreen(pathname, {
			workspaceName: (id) => this.knownWorkspaces.get(id)?.name ?? null,
			pageTitle: () => null,
		});
		if (text) this.client?.addContext(voiceContextMessage(text));
	}

	private async connect(seed = false): Promise<void> {
		const { clientSecret } = await this.deps.mint();
		const transport = this.deps.createTransport();
		const client = new RealtimeClient(transport, {
			onStatus: (status) => {
				if (!this.ended) this.deps.store.getState().setStatus(status);
			},
			onUserTranscript: (id, text, final) =>
				this.deps.store.getState().upsertSpeech(id, "user", text, final),
			onAssistantTranscript: (id, text, final) =>
				this.deps.store.getState().upsertSpeech(id, "assistant", text, final),
			onToolCall: (call) => this.onToolCall(call),
			onError: (message) => this.deps.store.getState().setError(message),
		});
		this.cleanups.push(
			transport.onStateChange((state) => {
				if (this.ended) return;
				if (state === "failed" || state === "closed") void this.reconnect();
			}),
		);
		this.transport = transport;
		this.client = client;
		client.start();
		await transport.connect({ clientSecret });
		if (this.deps.store.getState().muted) transport.setMuted(true);
		if (seed) this.seedHistory(client);
		this.deps.store.getState().setStatus("listening");
		this.deps.store.getState().setError(null);
	}

	private async reconnect(): Promise<void> {
		const store = this.deps.store.getState();
		store.setStatus("reconnecting");
		this.client?.stop();
		this.transport?.close();
		this.client = null;
		this.transport = null;
		for (
			let attempt = 0;
			attempt < RECONNECT_ATTEMPTS && !this.ended;
			attempt++
		) {
			await new Promise((resolve) =>
				setTimeout(resolve, RECONNECT_BACKOFF_MS[attempt] ?? 4_000),
			);
			if (this.ended) return;
			try {
				await this.connect(true);
				return;
			} catch {
				// Try again; the last failure ends the session below.
			}
		}
		if (!this.ended) {
			store.setError("Lost the connection and could not get it back.");
			this.end();
		}
	}

	/** The OpenAI session died with the link; what was said is ours to replay. */
	private seedHistory(client: RealtimeClient): void {
		const entries = this.deps.store
			.getState()
			.transcript.flatMap((entry) =>
				entry.role === "tool" || !entry.final || !entry.text.trim()
					? []
					: [{ role: entry.role, text: entry.text }],
			)
			.slice(-HISTORY_SEED_ENTRIES);
		if (entries.length === 0) return;
		client.addContext(
			voiceContextMessage(
				"The connection dropped and was restored. The conversation so far follows; continue without repeating it.",
			),
		);
		client.seedHistory(entries);
	}

	private async onToolCall(call: ToolCallRequest): Promise<VoiceToolResult> {
		const store = this.deps.store.getState();
		const rowId = this.deps.newId();
		store.addTool(rowId, call.name, toolSubject(call.name, call.args));
		const data = this.trackingData();
		const result = await executeTool(call.name, call.args, {
			data,
			pending: this.pending,
			now: this.deps.now,
			follow: {
				get: () => this.deps.store.getState().follow,
				set: (on) => this.deps.store.getState().setFollow(on),
			},
		});
		const failed =
			typeof result.output === "object" &&
			result.output !== null &&
			"error" in result.output;
		store.settleTool(rowId, failed ? "failed" : "done");
		this.applyDirective(result.ui, call.name === "show");
		return result;
	}

	private applyDirective(
		directive: VoiceUiDirective | undefined,
		always: boolean,
	) {
		if (!directive?.navigate) return;
		const state = this.deps.store.getState();
		const target = directive.navigate;
		if ("workspaceId" in target) {
			state.setFocusLabel(
				this.knownWorkspaces.get(target.workspaceId)?.name ?? null,
			);
		} else if (target.screen === "home") {
			state.setFocusLabel(null);
		}
		if (!always && !state.follow) return;
		const moved = applyUiDirective(directive, {
			router: this.deps.router,
			pathname: this.deps.getPathname(),
		});
		if (moved && state.expanded) state.setExpanded(false);
	}

	/** Remembers names as they stream past so screens and nudges can be worded. */
	private trackingData(): VoiceData {
		const data = this.deps.data;
		return {
			...data,
			listWorkspaces: async () => {
				const workspaces = await data.listWorkspaces();
				for (const workspace of workspaces) {
					this.knownWorkspaces.set(workspace.id, workspace);
				}
				return workspaces;
			},
		};
	}

	private onNudge(message: RealtimeNudgeMessage): void {
		const state = this.deps.store.getState();
		for (const update of message.updates) {
			if (
				update.kind !== "cloud_workspaces" ||
				update.agentStatus === undefined
			) {
				continue;
			}
			const name = this.knownWorkspaces.get(update.workspaceId)?.name;
			if (!name) continue;
			const status = update.agentStatus;
			const words =
				status === "review"
					? "finished and is waiting for the user"
					: status === "permission"
						? "is waiting for permission"
						: status === "failed"
							? "failed"
							: status === "working"
								? "started working"
								: "went idle";
			const matters =
				status === "review" || status === "permission" || status === "failed";
			this.client?.addContext(
				voiceContextMessage(
					`Workspace ${name} ${words}.${
						matters && state.proactive
							? " Tell the user in one sentence if they are not mid-sentence."
							: ""
					}`,
				),
				matters && state.proactive && state.status === "listening",
			);
		}
	}
}
