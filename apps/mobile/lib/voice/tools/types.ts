import type { ActiveAgentStatus } from "@superset/shared/agent-status";

export type VoiceAttention = ActiveAgentStatus;

export interface VoiceWorkspace {
	id: string;
	name: string;
	kind: "cloud" | "host";
	organizationId: string;
	/** The machine id, or the cloud workspace's own id (its sandbox is its host). */
	hostId: string;
	hostName: string | null;
	branch: string | null;
	/** `owner/repo` or the host project's name. */
	project: string | null;
	/** Cloud lifecycle: provisioning, ready, failed… Hosts are always "ready". */
	status: string;
	attention: VoiceAttention | null;
	attentionAt: number | null;
	lastActivityAt: number | null;
	createdByMe: boolean;
}

export interface VoiceSessionRow {
	terminalId: string;
	workspaceId: string;
	title: string;
	agentId: string | null;
	attention: VoiceAttention | null;
	lastEventAt: number | null;
	createdAt: number;
}

export interface VoicePullRequest {
	number: number;
	title: string;
	state: "open" | "draft" | "merged" | "closed" | "queued";
	url: string;
	isCurrent: boolean;
}

export interface VoicePage {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	updatedAt: number;
}

export class VoiceDataError extends Error {
	constructor(
		public readonly kind: "unreachable" | "timeout" | "not_found" | "forbidden",
		message: string,
	) {
		super(message);
		this.name = "VoiceDataError";
	}
}

/** Everything a tool can ask the phone for. Real clients behind it in `data.ts`. */
export interface VoiceData {
	listWorkspaces(): Promise<VoiceWorkspace[]>;
	listSessions(workspace: VoiceWorkspace): Promise<VoiceSessionRow[]>;
	readTranscript(
		workspace: VoiceWorkspace,
		session: VoiceSessionRow,
		maxChars: number,
	): Promise<string>;
	sendMessage(
		workspace: VoiceWorkspace,
		session: VoiceSessionRow,
		text: string,
	): Promise<void>;
	listPullRequests(workspace: VoiceWorkspace): Promise<VoicePullRequest[]>;
	listPages(workspaceId: string | null, limit: number): Promise<VoicePage[]>;
	findPage(query: string): Promise<VoicePage | null>;
	restartWorkspace(workspace: VoiceWorkspace): Promise<void>;
}
