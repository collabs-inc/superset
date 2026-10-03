import { describe, expect, test } from "bun:test";
import type { VoicePendingAction } from "@superset/shared/voice";
import { PendingActions } from "./confirmations";
import { executeTool, type ToolContext } from "./executeTool";
import {
	type VoiceData,
	VoiceDataError,
	type VoiceSessionRow,
	type VoiceWorkspace,
} from "./types";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

const workspaces: VoiceWorkspace[] = [
	{
		id: "ws-auth",
		name: "auth-refactor",
		kind: "cloud",
		organizationId: "org",
		hostId: "ws-auth",
		hostName: null,
		branch: "auth-refactor",
		project: "superset/superset",
		status: "ready",
		attention: "review",
		attentionAt: NOW - 3 * MIN,
		lastActivityAt: NOW - 3 * MIN,
		createdByMe: true,
	},
	{
		id: "ws-dash",
		name: "dashboard-v2",
		kind: "host",
		organizationId: "org",
		hostId: "mac",
		hostName: "Satya's Mac",
		branch: "dash",
		project: "superset",
		status: "ready",
		attention: "working",
		attentionAt: NOW - 10 * MIN,
		lastActivityAt: NOW - 10 * MIN,
		createdByMe: true,
	},
	{
		id: "ws-old",
		name: "old-experiment",
		kind: "host",
		organizationId: "org",
		hostId: "mac",
		hostName: "Satya's Mac",
		branch: "old",
		project: "superset",
		status: "ready",
		attention: null,
		attentionAt: null,
		lastActivityAt: NOW - 3 * 24 * 60 * MIN,
		createdByMe: true,
	},
];

const sessions: VoiceSessionRow[] = [
	{
		terminalId: "t-claude",
		workspaceId: "ws-auth",
		title: "claude",
		agentId: "claude",
		attention: "review",
		lastEventAt: NOW - 3 * MIN,
		createdAt: NOW - 60 * MIN,
	},
];

function fakeData(overrides: Partial<VoiceData> = {}): VoiceData & {
	sent: string[];
} {
	const sent: string[] = [];
	return {
		sent,
		listWorkspaces: async () => workspaces,
		listSessions: async (workspace) =>
			workspace.id === "ws-auth" ? sessions : [],
		readTranscript: async () => "● Opened PR #8102\n\nWhich do you prefer?",
		sendMessage: async (_workspace, session, text) => {
			sent.push(`${session.terminalId}:${text}`);
		},
		listPullRequests: async () => [
			{
				number: 8102,
				title: "refactor(auth)",
				state: "open",
				url: "u",
				isCurrent: true,
			},
		],
		listPages: async () => [],
		findPage: async (query) =>
			query.includes("usage")
				? {
						id: "p1",
						slug: "usage-v2",
						title: "Usage dashboard v2",
						description: null,
						updatedAt: NOW - 9 * MIN,
					}
				: null,
		restartWorkspace: async () => {},
		...overrides,
	};
}

function context(data: VoiceData) {
	let follow = true;
	let pendingSeen: VoicePendingAction | null = null;
	let counter = 0;
	const pending = new PendingActions(
		() => `tok-${++counter}`,
		() => NOW,
		(action) => {
			pendingSeen = action;
		},
	);
	const ctx: ToolContext = {
		data,
		pending,
		now: () => NOW,
		follow: {
			get: () => follow,
			set: (on) => {
				follow = on;
			},
		},
	};
	return { ctx, pendingSeen: () => pendingSeen, follow: () => follow };
}

describe("executeTool", () => {
	test("list_workspaces shapes active rows for speech and points home", async () => {
		const { ctx } = context(fakeData());
		const result = await executeTool("list_workspaces", {}, ctx);
		const output = result.output as {
			workspaces: Array<{
				name: string;
				agent: string;
				since: string;
				where: string;
			}>;
			matching: number;
			total: number;
		};
		expect(output.workspaces.map((w) => w.name)).toEqual([
			"auth-refactor",
			"dashboard-v2",
		]);
		expect(output.workspaces[0]).toMatchObject({
			agent: "finished, waiting for the user to look",
			since: "3 minutes ago",
			where: "cloud",
		});
		expect(output.workspaces[1]?.where).toBe("Satya's Mac");
		expect(output.matching).toBe(2);
		expect(output.total).toBe(3);
		expect(result.ui?.navigate).toEqual({ screen: "home" });
	});

	test("get_workspace resolves a fragment and navigates to it", async () => {
		const { ctx } = context(fakeData());
		const result = await executeTool(
			"get_workspace",
			{ query: "the auth one" },
			ctx,
		);
		expect(result.output).toMatchObject({
			workspace: { name: "auth-refactor" },
			sessions: [{ name: "claude", agent: "claude" }],
			pullRequests: [{ number: 8102, state: "open" }],
		});
		expect(result.ui?.navigate).toEqual({
			screen: "workspace",
			workspaceId: "ws-auth",
		});
	});

	test("an unknown workspace is a typed error, not a throw", async () => {
		const { ctx } = context(fakeData());
		const result = await executeTool(
			"get_workspace",
			{ query: "marketing" },
			ctx,
		);
		expect(result.output).toEqual({
			error: {
				kind: "not_found",
				message: 'No workspace matches "marketing".',
			},
		});
		expect(result.ui).toBeUndefined();
	});

	test("read_session hands back the transcript and selects the tab", async () => {
		const { ctx } = context(fakeData());
		const result = await executeTool(
			"read_session",
			{ workspace: "auth-refactor" },
			ctx,
		);
		expect(result.output).toMatchObject({
			session: { name: "claude" },
			transcript: expect.stringContaining("Which do you prefer?"),
		});
		expect(result.ui?.navigate).toEqual({
			screen: "workspace",
			workspaceId: "ws-auth",
			terminalId: "t-claude",
		});
	});

	test("an unreachable host surfaces as unreachable", async () => {
		const { ctx } = context(
			fakeData({
				listSessions: async () => {
					throw new VoiceDataError("unreachable", "Could not reach the host.");
				},
			}),
		);
		const result = await executeTool(
			"list_sessions",
			{ workspace: "auth" },
			ctx,
		);
		expect(result.output).toEqual({
			error: { kind: "unreachable", message: "Could not reach the host." },
		});
	});

	test("send_message asks first, then sends on confirm", async () => {
		const data = fakeData();
		const { ctx, pendingSeen } = context(data);
		const first = await executeTool(
			"send_message",
			{ workspace: "auth", text: "Yes, migrate it too." },
			ctx,
		);
		expect(first.output).toEqual({
			status: "needs_confirmation",
			token: "tok-1",
			summary: "Yes, migrate it too.",
			target: "auth-refactor › claude",
		});
		expect(pendingSeen()?.token).toBe("tok-1");
		expect(data.sent).toEqual([]);

		const wrong = await executeTool("confirm_action", { token: "nope" }, ctx);
		expect((wrong.output as { error: { kind: string } }).error.kind).toBe(
			"not_found",
		);
		expect(data.sent).toEqual([]);

		const confirmed = await executeTool(
			"confirm_action",
			{ token: "tok-1" },
			ctx,
		);
		expect(confirmed.output).toMatchObject({ sent: true, session: "claude" });
		expect(data.sent).toEqual(["t-claude:Yes, migrate it too."]);
		expect(pendingSeen()).toBeNull();
	});

	test("cancel_action drops the pending action", async () => {
		const data = fakeData();
		const { ctx, pendingSeen } = context(data);
		await executeTool("send_message", { workspace: "auth", text: "go" }, ctx);
		const cancelled = await executeTool(
			"cancel_action",
			{ token: "tok-1" },
			ctx,
		);
		expect(cancelled.output).toEqual({ cancelled: true });
		expect(pendingSeen()).toBeNull();
		expect(data.sent).toEqual([]);
	});

	test("restart refuses a host workspace without asking", async () => {
		const { ctx, pendingSeen } = context(fakeData());
		const result = await executeTool(
			"restart_workspace",
			{ workspace: "dashboard" },
			ctx,
		);
		expect((result.output as { error: { kind: string } }).error.kind).toBe(
			"invalid",
		);
		expect(pendingSeen()).toBeNull();
	});

	test("show resolves pages and workspaces into directives", async () => {
		const { ctx } = context(fakeData());
		const page = await executeTool(
			"show",
			{ screen: "page", page: "usage" },
			ctx,
		);
		expect(page.ui?.navigate).toEqual({ screen: "page", slug: "usage-v2" });
		const sessions = await executeTool(
			"show",
			{ screen: "sessions", workspace: "dashboard" },
			ctx,
		);
		expect(sessions.ui?.navigate).toEqual({
			screen: "sessions",
			workspaceId: "ws-dash",
		});
	});

	test("set_follow flips the flag", async () => {
		const { ctx, follow } = context(fakeData());
		await executeTool("set_follow", { on: false }, ctx);
		expect(follow()).toBe(false);
	});

	test("bad arguments and unknown tools answer with an error", async () => {
		const { ctx } = context(fakeData());
		const bad = await executeTool("read_session", { maxChars: 10 }, ctx);
		expect((bad.output as { error: { kind: string } }).error.kind).toBe(
			"invalid_arguments",
		);
		const unknown = await executeTool("delete_everything", {}, ctx);
		expect((unknown.output as { error: { kind: string } }).error.kind).toBe(
			"unknown_tool",
		);
	});
});
