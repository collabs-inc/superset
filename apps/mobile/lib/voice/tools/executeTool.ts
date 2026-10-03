import {
	isVoiceToolName,
	needsConfirmation,
	type VoiceToolInput,
	type VoiceToolName,
	type VoiceToolResult,
	type VoiceUiDirective,
	voiceTool,
} from "@superset/shared/voice";
import { ago } from "./ago";
import type { PendingActions } from "./confirmations";
import { resolveSession, resolveWorkspace } from "./resolveWorkspace";
import {
	type VoiceData,
	VoiceDataError,
	type VoicePage,
	type VoicePullRequest,
	type VoiceSessionRow,
	type VoiceWorkspace,
} from "./types";

export interface ToolContext {
	data: VoiceData;
	pending: PendingActions;
	now: () => number;
	follow: { get: () => boolean; set: (on: boolean) => void };
}

/** A day without activity and a workspace is no longer "active". */
const ACTIVE_WINDOW_MS = 24 * 60 * 60_000;

const ATTENTION_WORDS: Record<
	NonNullable<VoiceWorkspace["attention"]>,
	string
> = {
	working: "working",
	review: "finished, waiting for the user to look",
	permission: "waiting for permission",
	failed: "failed",
};

class ToolFailure extends Error {
	constructor(
		readonly kind: string,
		message: string,
		readonly extra: Record<string, unknown> = {},
	) {
		super(message);
	}
}

function describeWorkspace(workspace: VoiceWorkspace, now: number) {
	return {
		id: workspace.id,
		name: workspace.name,
		project: workspace.project,
		branch: workspace.branch,
		where:
			workspace.kind === "cloud"
				? "cloud"
				: (workspace.hostName ?? "a machine"),
		...(workspace.status !== "ready" ? { status: workspace.status } : {}),
		agent: workspace.attention ? ATTENTION_WORDS[workspace.attention] : "idle",
		since: ago(workspace.attentionAt ?? workspace.lastActivityAt, now),
	};
}

function describeSession(session: VoiceSessionRow, now: number) {
	return {
		id: session.terminalId,
		name: session.title,
		agent: session.agentId,
		state: session.attention ? ATTENTION_WORDS[session.attention] : "idle",
		since: ago(session.lastEventAt ?? session.createdAt, now),
	};
}

function describePullRequest(pr: VoicePullRequest) {
	return {
		number: pr.number,
		title: pr.title,
		state: pr.state,
		current: pr.isCurrent,
	};
}

function describePage(page: VoicePage, now: number) {
	return {
		id: page.id,
		slug: page.slug,
		title: page.title,
		description: page.description,
		updated: ago(page.updatedAt, now),
	};
}

const recency = (workspace: VoiceWorkspace) =>
	workspace.attentionAt ?? workspace.lastActivityAt ?? 0;

async function requireWorkspace(
	query: string,
	ctx: ToolContext,
): Promise<VoiceWorkspace> {
	const resolution = resolveWorkspace(query, await ctx.data.listWorkspaces());
	switch (resolution.kind) {
		case "match":
			return resolution.workspace;
		case "ambiguous":
			throw new ToolFailure(
				"ambiguous",
				`Several workspaces match "${query}".`,
				{
					candidates: resolution.candidates.map((workspace) => workspace.name),
				},
			);
		case "none":
			throw new ToolFailure("not_found", `No workspace matches "${query}".`);
	}
}

async function requireSession(
	workspace: VoiceWorkspace,
	query: string | undefined,
	ctx: ToolContext,
): Promise<VoiceSessionRow> {
	const sessions = await ctx.data.listSessions(workspace);
	const session = resolveSession(query, sessions);
	if (!session) {
		throw new ToolFailure(
			"not_found",
			query
				? `No session called "${query}" in ${workspace.name}.`
				: `${workspace.name} has no running sessions.`,
			{ sessions: sessions.map((row) => describeSession(row, ctx.now())) },
		);
	}
	return session;
}

async function settle<Value>(
	promise: Promise<Value>,
): Promise<{ value: Value } | { error: string }> {
	try {
		return { value: await promise };
	} catch (error) {
		return { error: error instanceof Error ? error.message : "failed" };
	}
}

type Handlers = {
	[Name in VoiceToolName]: (
		args: VoiceToolInput<Name>,
		ctx: ToolContext,
	) => Promise<VoiceToolResult>;
};

const handlers: Handlers = {
	async list_workspaces(args, ctx) {
		const now = ctx.now();
		const all = await ctx.data.listWorkspaces();
		const matching =
			args.filter === "all"
				? all
				: all.filter(
						(workspace) =>
							workspace.attention !== null ||
							workspace.status === "provisioning" ||
							(workspace.lastActivityAt !== null &&
								now - workspace.lastActivityAt < ACTIVE_WINDOW_MS),
					);
		const listed = [...matching]
			.sort((left, right) => recency(right) - recency(left))
			.slice(0, args.limit);
		return {
			output: {
				workspaces: listed.map((workspace) =>
					describeWorkspace(workspace, now),
				),
				shown: listed.length,
				matching: matching.length,
				total: all.length,
			},
			ui: {
				navigate: { screen: "home" },
				highlightWorkspaceIds: listed.map((workspace) => workspace.id),
			},
		};
	},

	async get_workspace(args, ctx) {
		const now = ctx.now();
		const workspace = await requireWorkspace(args.query, ctx);
		const [sessions, pullRequests] = await Promise.all([
			settle(ctx.data.listSessions(workspace)),
			settle(ctx.data.listPullRequests(workspace)),
		]);
		return {
			output: {
				workspace: describeWorkspace(workspace, now),
				sessions:
					"value" in sessions
						? sessions.value.map((row) => describeSession(row, now))
						: { error: sessions.error },
				pullRequests:
					"value" in pullRequests
						? pullRequests.value.map(describePullRequest)
						: { error: pullRequests.error },
			},
			ui: {
				navigate: { screen: "workspace", workspaceId: workspace.id },
				highlightWorkspaceIds: [workspace.id],
			},
		};
	},

	async list_sessions(args, ctx) {
		const workspace = await requireWorkspace(args.workspace, ctx);
		const sessions = await ctx.data.listSessions(workspace);
		return {
			output: {
				workspace: workspace.name,
				sessions: sessions.map((row) => describeSession(row, ctx.now())),
			},
			ui: { navigate: { screen: "sessions", workspaceId: workspace.id } },
		};
	},

	async read_session(args, ctx) {
		const workspace = await requireWorkspace(args.workspace, ctx);
		const session = await requireSession(workspace, args.session, ctx);
		const transcript = await ctx.data.readTranscript(
			workspace,
			session,
			args.maxChars,
		);
		return {
			output: {
				workspace: workspace.name,
				session: describeSession(session, ctx.now()),
				transcript,
			},
			ui: {
				navigate: {
					screen: "workspace",
					workspaceId: workspace.id,
					terminalId: session.terminalId,
				},
			},
		};
	},

	async list_pull_requests(args, ctx) {
		const workspace = await requireWorkspace(args.workspace, ctx);
		const pullRequests = await ctx.data.listPullRequests(workspace);
		return {
			output: {
				workspace: workspace.name,
				pullRequests: pullRequests.map(describePullRequest),
			},
			ui: {
				navigate:
					pullRequests.length > 0
						? { screen: "pull_requests", workspaceId: workspace.id }
						: { screen: "workspace", workspaceId: workspace.id },
			},
		};
	},

	async list_pages(args, ctx) {
		const workspace = args.workspace
			? await requireWorkspace(args.workspace, ctx)
			: null;
		const pages = await ctx.data.listPages(workspace?.id ?? null, args.limit);
		return {
			output: {
				...(workspace ? { workspace: workspace.name } : {}),
				pages: pages.map((page) => describePage(page, ctx.now())),
			},
		};
	},

	async open_page(args, ctx) {
		const page = await ctx.data.findPage(args.page);
		if (!page)
			throw new ToolFailure("not_found", `No page matches "${args.page}".`);
		return {
			output: { page: describePage(page, ctx.now()), opened: true },
			ui: { navigate: { screen: "page", slug: page.slug } },
		};
	},

	async show(args, ctx) {
		let navigate: VoiceUiDirective["navigate"];
		switch (args.screen) {
			case "home":
				navigate = { screen: "home" };
				break;
			case "page": {
				if (!args.page) throw new ToolFailure("invalid", "show needs a page.");
				const page = await ctx.data.findPage(args.page);
				if (!page)
					throw new ToolFailure("not_found", `No page matches "${args.page}".`);
				navigate = { screen: "page", slug: page.slug };
				break;
			}
			default: {
				if (!args.workspace) {
					throw new ToolFailure("invalid", "show needs a workspace.");
				}
				const workspace = await requireWorkspace(args.workspace, ctx);
				navigate = { screen: args.screen, workspaceId: workspace.id };
			}
		}
		return { output: { shown: args.screen }, ui: { navigate } };
	},

	async set_follow(args, ctx) {
		ctx.follow.set(args.on);
		return { output: { follow: args.on } };
	},

	async send_message(args, ctx) {
		const workspace = await requireWorkspace(args.workspace, ctx);
		const session = await requireSession(workspace, args.session, ctx);
		const text = args.text.trim();
		const action = ctx.pending.propose(
			{
				tool: "send_message",
				summary: text,
				target: `${workspace.name} › ${session.title}`,
				args: {
					workspaceId: workspace.id,
					terminalId: session.terminalId,
					text,
				},
			},
			async () => {
				await ctx.data.sendMessage(workspace, session, text);
				return {
					output: {
						sent: true,
						workspace: workspace.name,
						session: session.title,
					},
					ui: {
						navigate: {
							screen: "workspace",
							workspaceId: workspace.id,
							terminalId: session.terminalId,
						},
					},
				};
			},
		);
		return { output: needsConfirmation(action) };
	},

	async restart_workspace(args, ctx) {
		const workspace = await requireWorkspace(args.workspace, ctx);
		if (workspace.kind !== "cloud") {
			throw new ToolFailure(
				"invalid",
				`${workspace.name} runs on ${workspace.hostName ?? "a machine"}; only cloud workspaces restart.`,
			);
		}
		const action = ctx.pending.propose(
			{
				tool: "restart_workspace",
				summary: `Restart ${workspace.name}`,
				target: workspace.name,
				args: { workspaceId: workspace.id },
			},
			async () => {
				await ctx.data.restartWorkspace(workspace);
				return {
					output: { restarted: true, workspace: workspace.name },
					ui: { navigate: { screen: "workspace", workspaceId: workspace.id } },
				};
			},
		);
		return { output: needsConfirmation(action) };
	},

	async confirm_action(args, ctx) {
		const result = await ctx.pending.confirm(args.token);
		if (!result) {
			throw new ToolFailure(
				"not_found",
				"Nothing is pending for that token; ask again if the user still wants it.",
			);
		}
		return result;
	},

	async cancel_action(args, ctx) {
		return { output: { cancelled: ctx.pending.cancel(args.token) } };
	},
};

/**
 * Runs one of the model's function calls. Never throws: a failure becomes an
 * `error` the model can say out loud, with a `kind` it can act on.
 */
export async function executeTool(
	name: string,
	rawArgs: unknown,
	ctx: ToolContext,
): Promise<VoiceToolResult> {
	if (!isVoiceToolName(name)) {
		return { output: { error: { kind: "unknown_tool", message: name } } };
	}
	const parsed = voiceTool(name).parameters.safeParse(rawArgs ?? {});
	if (!parsed.success) {
		return {
			output: {
				error: { kind: "invalid_arguments", message: parsed.error.message },
			},
		};
	}
	try {
		const handler = handlers[name] as (
			args: unknown,
			ctx: ToolContext,
		) => Promise<VoiceToolResult>;
		return await handler(parsed.data, ctx);
	} catch (error) {
		if (error instanceof ToolFailure) {
			return {
				output: {
					error: { kind: error.kind, message: error.message, ...error.extra },
				},
			};
		}
		if (error instanceof VoiceDataError) {
			return {
				output: { error: { kind: error.kind, message: error.message } },
			};
		}
		return {
			output: {
				error: {
					kind: "failed",
					message: error instanceof Error ? error.message : "Something failed.",
				},
			},
		};
	}
}

/** The thing a tool acted on, for the transcript row; null when it has none. */
export function toolSubject(name: string, rawArgs: unknown): string | null {
	if (typeof rawArgs !== "object" || rawArgs === null) return null;
	const args = rawArgs as Record<string, unknown>;
	const value = args.workspace ?? args.query ?? args.page ?? args.screen;
	return typeof value === "string" ? value : null;
}
