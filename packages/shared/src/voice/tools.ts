import { z } from "zod";
import type { VoiceUiDirective } from "./directives";

export const VOICE_REALTIME_MODEL = "gpt-realtime-2.1";
export const VOICE_DEFAULT_VOICE = "marin";
export const VOICE_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
/** The Realtime API ends a session at 60 minutes whatever the client does. */
export const VOICE_MAX_SESSION_SECONDS = 60 * 60;
/** How long the minted secret can sit unused before connecting. */
export const VOICE_SECRET_TTL_SECONDS = 120;

export const VOICE_SHOW_SCREENS = [
	"home",
	"workspace",
	"sessions",
	"pull_requests",
	"page",
] as const;
export type VoiceShowScreen = (typeof VOICE_SHOW_SCREENS)[number];

/** Which client on the phone executes the call. */
export type VoiceToolExecutor = "api" | "host" | "local";

export interface VoiceToolDefinition<
	Name extends string = string,
	Schema extends z.ZodObject = z.ZodObject,
	Gated extends boolean = boolean,
> {
	name: Name;
	description: string;
	parameters: Schema;
	executor: VoiceToolExecutor;
	/** Changes state: the first call answers `needs_confirmation`. */
	gated: Gated;
}

function defineTool<
	const Name extends string,
	Schema extends z.ZodObject,
	const Gated extends boolean,
>(tool: VoiceToolDefinition<Name, Schema, Gated>) {
	return tool;
}

const workspaceQuery = z
	.string()
	.min(1)
	.describe(
		"The workspace, as the user said it: a name, part of a name, or an id.",
	);

export const VOICE_TOOLS = [
	defineTool({
		name: "list_workspaces",
		description:
			"The user's workspaces with what each agent is doing. Call this for 'what are my agents up to' or when a name needs matching.",
		parameters: z.object({
			filter: z
				.enum(["active", "all"])
				.default("active")
				.describe(
					"active: workspaces with a live agent session or recent activity. all: every workspace.",
				),
			limit: z.number().int().min(1).max(20).default(10),
		}),
		executor: "api",
		gated: false,
	}),
	defineTool({
		name: "get_workspace",
		description:
			"One workspace in detail: agent status, sessions, pull request, last activity. Resolves a spoken name; ask the user if it returns several candidates.",
		parameters: z.object({ query: workspaceQuery }),
		executor: "api",
		gated: false,
	}),
	defineTool({
		name: "list_sessions",
		description:
			"The agent and terminal sessions running in a workspace, with what each needs from the user.",
		parameters: z.object({ workspace: workspaceQuery }),
		executor: "host",
		gated: false,
	}),
	defineTool({
		name: "read_session",
		description:
			"The tail of an agent session's terminal output, as text. Use it to say what the agent did last and what it is waiting on.",
		parameters: z.object({
			workspace: workspaceQuery,
			session: z
				.string()
				.optional()
				.describe(
					"Session name or agent, e.g. 'claude'. Omit for the most recently active one.",
				),
			maxChars: z.number().int().min(500).max(8000).default(2500),
		}),
		executor: "host",
		gated: false,
	}),
	defineTool({
		name: "list_pull_requests",
		description:
			"Pull requests opened from a workspace: number, title, checks, review state.",
		parameters: z.object({ workspace: workspaceQuery }),
		executor: "api",
		gated: false,
	}),
	defineTool({
		name: "list_pages",
		description:
			"Pages agents have published: dashboards, reports, previews. Optionally only one workspace's.",
		parameters: z.object({
			workspace: workspaceQuery.optional(),
			limit: z.number().int().min(1).max(20).default(10),
		}),
		executor: "api",
		gated: false,
	}),
	defineTool({
		name: "open_page",
		description:
			"Open a published page on the phone. Accepts a page id, slug, or title fragment.",
		parameters: z.object({ page: z.string().min(1) }),
		executor: "api",
		gated: false,
	}),
	defineTool({
		name: "show",
		description:
			"Navigate the phone to a screen because the user asked to see it. Ignores follow mode.",
		parameters: z.object({
			screen: z.enum(VOICE_SHOW_SCREENS),
			workspace: workspaceQuery.optional(),
			page: z
				.string()
				.optional()
				.describe("For screen=page: id, slug, or title."),
		}),
		executor: "local",
		gated: false,
	}),
	defineTool({
		name: "set_follow",
		description:
			"Turn follow mode on or off. When on, the phone navigates to whatever the conversation is about.",
		parameters: z.object({ on: z.boolean() }),
		executor: "local",
		gated: false,
	}),
	defineTool({
		name: "send_message",
		description:
			"Send a message to an agent session, as if the user typed it into that terminal. Returns needs_confirmation first.",
		parameters: z.object({
			workspace: workspaceQuery,
			session: z
				.string()
				.optional()
				.describe(
					"Session name or agent. Omit for the most recently active one.",
				),
			text: z.string().min(1).max(4000),
		}),
		executor: "host",
		gated: true,
	}),
	defineTool({
		name: "restart_workspace",
		description:
			"Restart a cloud workspace's sandbox. Returns needs_confirmation first.",
		parameters: z.object({ workspace: workspaceQuery }),
		executor: "api",
		gated: true,
	}),
	defineTool({
		name: "confirm_action",
		description:
			"Run a pending action after the user said yes. The token came from the needs_confirmation answer.",
		parameters: z.object({ token: z.string().min(1) }),
		executor: "local",
		gated: false,
	}),
	defineTool({
		name: "cancel_action",
		description: "Drop a pending action because the user said no.",
		parameters: z.object({ token: z.string().min(1) }),
		executor: "local",
		gated: false,
	}),
] as const;

export type VoiceTool = (typeof VOICE_TOOLS)[number];
export type VoiceToolName = VoiceTool["name"];
export type VoiceToolInput<Name extends VoiceToolName> = z.infer<
	Extract<VoiceTool, { name: Name }>["parameters"]
>;

export const VOICE_TOOL_NAMES = VOICE_TOOLS.map(
	(tool) => tool.name,
) as readonly VoiceToolName[];

export function voiceTool<Name extends VoiceToolName>(
	name: Name,
): Extract<VoiceTool, { name: Name }> {
	const tool = VOICE_TOOLS.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Unknown voice tool: ${name}`);
	return tool as Extract<VoiceTool, { name: Name }>;
}

export function isVoiceToolName(value: unknown): value is VoiceToolName {
	return (
		typeof value === "string" &&
		(VOICE_TOOL_NAMES as readonly string[]).includes(value)
	);
}

/** A function tool as the Realtime session config wants it. */
export interface RealtimeFunctionTool {
	type: "function";
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export function realtimeToolDefinitions(): RealtimeFunctionTool[] {
	return VOICE_TOOLS.map((tool) => {
		const { $schema: _schema, ...parameters } = z.toJSONSchema(
			tool.parameters,
			{ target: "draft-7" },
		);
		return {
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters,
		};
	});
}

/** What an executor hands back: the model reads `output`, the phone applies `ui`. */
export interface VoiceToolResult {
	output: unknown;
	ui?: VoiceUiDirective;
}

export type VoiceGatedToolName = Extract<VoiceTool, { gated: true }>["name"];

export interface VoicePendingAction {
	token: string;
	tool: VoiceGatedToolName;
	/** One sentence, in the user's words, for the card and for the model to read back. */
	summary: string;
	/** Where it lands, e.g. "auth-refactor › claude". */
	target: string;
	args: Record<string, unknown>;
	createdAt: number;
}

export interface VoiceNeedsConfirmation {
	status: "needs_confirmation";
	token: string;
	summary: string;
	target: string;
}

export function needsConfirmation(
	action: VoicePendingAction,
): VoiceNeedsConfirmation {
	return {
		status: "needs_confirmation",
		token: action.token,
		summary: action.summary,
		target: action.target,
	};
}
