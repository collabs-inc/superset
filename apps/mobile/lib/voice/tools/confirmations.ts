import type {
	VoiceGatedToolName,
	VoicePendingAction,
	VoiceToolResult,
} from "@superset/shared/voice";

/** A gated call stays out of the model's reach until a token comes back with a yes. */
const PENDING_TTL_MS = 5 * 60_000;

export class PendingActions {
	private current: {
		action: VoicePendingAction;
		run: () => Promise<VoiceToolResult>;
	} | null = null;

	constructor(
		private readonly newToken: () => string,
		private readonly now: () => number,
		private readonly onChange: (action: VoicePendingAction | null) => void,
	) {}

	get(): VoicePendingAction | null {
		if (
			this.current &&
			this.now() - this.current.action.createdAt > PENDING_TTL_MS
		) {
			this.set(null);
		}
		return this.current?.action ?? null;
	}

	/** Replaces any earlier pending action: one question at a time. */
	propose(
		input: {
			tool: VoiceGatedToolName;
			summary: string;
			target: string;
			args: Record<string, unknown>;
		},
		run: () => Promise<VoiceToolResult>,
	): VoicePendingAction {
		const action: VoicePendingAction = {
			...input,
			token: this.newToken(),
			createdAt: this.now(),
		};
		this.set({ action, run });
		return action;
	}

	async confirm(token: string): Promise<VoiceToolResult | null> {
		const pending = this.current;
		if (!pending || pending.action.token !== token) return null;
		this.set(null);
		return pending.run();
	}

	cancel(token: string): boolean {
		if (!this.current || this.current.action.token !== token) return false;
		this.set(null);
		return true;
	}

	/** The on-screen button: no token in hand, acts on whatever is pending. */
	confirmCurrent(): Promise<VoiceToolResult | null> {
		const token = this.current?.action.token;
		return token ? this.confirm(token) : Promise.resolve(null);
	}

	cancelCurrent(): boolean {
		const token = this.current?.action.token;
		return token ? this.cancel(token) : false;
	}

	private set(
		next: {
			action: VoicePendingAction;
			run: () => Promise<VoiceToolResult>;
		} | null,
	) {
		this.current = next;
		this.onChange(next?.action ?? null);
	}
}
