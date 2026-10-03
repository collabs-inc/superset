import { agentStatusFromEvent } from "@superset/shared/agent-status";
import type { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { CloudWorkspaceRow } from "@/hooks/useCloudWorkspaces";
import { getCloudWorkspacesQueryKey } from "@/hooks/useCloudWorkspaces";
import {
	getHostWorkspacesQueryKey,
	type HostWorkspaceRow,
} from "@/hooks/useHostWorkspaces";
import type { OrgHostRow } from "@/hooks/useOrgHosts";
import {
	getHostServiceClientByUrl,
	hostServiceUrl,
} from "@/lib/host-service/client";
import { ensureSandboxAccess } from "@/lib/sandbox-access";
import { apiClient } from "@/lib/trpc/client";
import {
	type VoiceData,
	VoiceDataError,
	type VoicePage,
	type VoicePullRequest,
	type VoiceSessionRow,
	type VoiceWorkspace,
} from "./types";

/** A host that has not answered by now is "unreachable" to the model, not "slow". */
const HOST_TIMEOUT_MS = 4_000;
/** Reuse what Home already fetched rather than asking every host again per turn. */
const FRESH_MS = 15_000;
const PAGE_SEARCH_LIMIT = 50;

const toMs = (
	value: Date | number | string | null | undefined,
): number | null => {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number") return value;
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? null : parsed;
};

function withTimeout<Value>(
	promise: Promise<Value>,
	ms: number,
	what: string,
): Promise<Value> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new VoiceDataError("timeout", `${what} did not answer.`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(toDataError(error, what));
			},
		);
	});
}

function toDataError(error: unknown, what: string): Error {
	if (error instanceof VoiceDataError) return error;
	if (error instanceof TRPCClientError) {
		const code = error.data?.code;
		if (code === "FORBIDDEN" || code === "UNAUTHORIZED") {
			return new VoiceDataError("forbidden", `${what}: not allowed.`);
		}
		if (code === "NOT_FOUND") {
			return new VoiceDataError("not_found", `${what}: not found.`);
		}
		if (!code)
			return new VoiceDataError("unreachable", `${what} is unreachable.`);
		return new VoiceDataError("unreachable", `${what}: ${error.message}`);
	}
	return error instanceof Error ? error : new Error(String(error));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes begin with ESC
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export interface VoiceDataDeps {
	organizationId: string;
	userId: string;
	queryClient: QueryClient;
}

export function createVoiceData({
	organizationId,
	userId,
	queryClient,
}: VoiceDataDeps): VoiceData {
	const cloudList = () =>
		queryClient
			.fetchQuery({
				queryKey: getCloudWorkspacesQueryKey(organizationId),
				staleTime: FRESH_MS,
				queryFn: () => apiClient.cloudWorkspace.list.query({ organizationId }),
			})
			.catch((error: unknown) => {
				// Cloud is gated by account; "no cloud workspaces" is the answer.
				if (
					error instanceof TRPCClientError &&
					error.data?.code === "FORBIDDEN"
				) {
					return [] as CloudWorkspaceRow[];
				}
				throw error;
			});

	const cloudRepos = () =>
		queryClient
			.fetchQuery({
				queryKey: ["cloud", "cloudWorkspace", "repositories", organizationId],
				staleTime: 5 * 60_000,
				queryFn: () =>
					apiClient.cloudWorkspace.repositories.query({ organizationId }),
			})
			.then(
				(rows) =>
					new Map(
						rows
							.filter((row) => row.primary)
							.map((row) => [row.cloudWorkspaceId, row.fullName]),
					),
			)
			.catch(() => new Map<string, string>());

	const roster = (): Promise<OrgHostRow[]> =>
		queryClient.fetchQuery({
			queryKey: ["cloud", "host", "roster", organizationId],
			staleTime: 30_000,
			queryFn: () => apiClient.host.roster.query({ organizationId }),
		});

	const hostWorkspaces = (host: OrgHostRow) => {
		const hostUrl = hostServiceUrl(organizationId, host.machineId);
		return withTimeout(
			queryClient.fetchQuery({
				queryKey: getHostWorkspacesQueryKey(host.machineId, hostUrl),
				staleTime: FRESH_MS,
				queryFn: (): Promise<HostWorkspaceRow[]> =>
					getHostServiceClientByUrl(hostUrl).workspace.list.query(),
			}),
			HOST_TIMEOUT_MS,
			host.name,
		);
	};

	const hostAttention = (host: OrgHostRow) => {
		const hostUrl = hostServiceUrl(organizationId, host.machineId);
		return withTimeout(
			queryClient.fetchQuery({
				queryKey: ["host-terminals", "list", host.machineId],
				staleTime: FRESH_MS,
				queryFn: async () => {
					const client = getHostServiceClientByUrl(hostUrl);
					const [listed, bindings] = await Promise.all([
						client.terminal.list.query({}),
						client.terminalAgents.list.query(),
					]);
					return { sessions: listed.sessions, bindings };
				},
			}),
			HOST_TIMEOUT_MS,
			host.name,
		);
	};

	const hostUrlFor = async (workspace: VoiceWorkspace): Promise<string> => {
		if (workspace.kind === "cloud") {
			if (workspace.status !== "ready") {
				throw new VoiceDataError(
					"unreachable",
					`${workspace.name} is ${workspace.status}; its sandbox is not up.`,
				);
			}
			const access = await withTimeout(
				ensureSandboxAccess(workspace.id),
				HOST_TIMEOUT_MS * 2,
				`${workspace.name}'s sandbox`,
			);
			return access.url;
		}
		return hostServiceUrl(organizationId, workspace.hostId);
	};

	const sessionsFor = async (
		workspace: VoiceWorkspace,
	): Promise<VoiceSessionRow[]> => {
		const client = getHostServiceClientByUrl(await hostUrlFor(workspace));
		const [listed, bindings] = await withTimeout(
			Promise.all([
				client.terminal.list.query({ workspaceId: workspace.id }),
				client.terminalAgents.list.query(),
			]),
			HOST_TIMEOUT_MS,
			workspace.name,
		);
		const bindingByTerminal = new Map(
			bindings.map((binding) => [binding.terminalId, binding]),
		);
		return listed.sessions
			.filter((session) => !session.exited)
			.map((session) => {
				const binding = bindingByTerminal.get(session.terminalId);
				return {
					terminalId: session.terminalId,
					workspaceId: session.workspaceId,
					title: session.title ?? binding?.agentId ?? "Terminal",
					agentId: binding?.agentId ?? null,
					attention: binding
						? agentStatusFromEvent(binding.lastEventType)
						: null,
					lastEventAt: binding?.lastEventAt ?? null,
					createdAt: session.createdAt,
				};
			});
	};

	return {
		async listWorkspaces() {
			const [cloud, repos, hosts] = await Promise.all([
				cloudList(),
				cloudRepos(),
				roster().catch(() => [] as OrgHostRow[]),
			]);
			const fromCloud: VoiceWorkspace[] = cloud
				.filter((row) => row.status !== "deleted")
				.map((row) => ({
					id: row.id,
					name: row.name,
					kind: "cloud",
					organizationId,
					hostId: row.id,
					hostName: null,
					branch: row.branch,
					project: repos.get(row.id) ?? null,
					status: row.status,
					attention: row.agentStatus ?? null,
					attentionAt: toMs(row.agentStatusAt),
					lastActivityAt: toMs(row.agentStatusAt) ?? toMs(row.updatedAt),
					createdByMe: row.createdByUserId === userId,
				}));

			const perHost = await Promise.all(
				hosts.map(async (host) => {
					const [workspaces, attention] = await Promise.all([
						hostWorkspaces(host).catch(() => null),
						hostAttention(host).catch(() => null),
					]);
					if (!workspaces) return [];
					const bindingByTerminal = new Map(
						(attention?.bindings ?? []).map((binding) => [
							binding.terminalId,
							binding,
						]),
					);
					const attentionByWorkspace = new Map<
						string,
						{ status: VoiceWorkspace["attention"]; at: number }
					>();
					for (const session of attention?.sessions ?? []) {
						if (session.exited) continue;
						const binding = bindingByTerminal.get(session.terminalId);
						if (!binding) continue;
						const status = agentStatusFromEvent(binding.lastEventType);
						const existing = attentionByWorkspace.get(session.workspaceId);
						if (!existing || binding.lastEventAt > existing.at) {
							attentionByWorkspace.set(session.workspaceId, {
								status,
								at: binding.lastEventAt,
							});
						}
					}
					return workspaces
						.filter((row) => row.archivedAt == null && row.worktreeExists)
						.map((row): VoiceWorkspace => {
							const attention = attentionByWorkspace.get(row.id);
							return {
								id: row.id,
								name: row.name,
								kind: "host",
								organizationId,
								hostId: host.machineId,
								hostName: host.name,
								branch: row.branch,
								project: row.projectName,
								status: "ready",
								attention: attention?.status ?? null,
								attentionAt: attention?.at ?? null,
								lastActivityAt: toMs(row.lastActivityAt) ?? toMs(row.updatedAt),
								createdByMe:
									row.createdByUserId === null ||
									row.createdByUserId === userId,
							};
						});
				}),
			);
			return [...fromCloud, ...perHost.flat()];
		},

		listSessions: sessionsFor,

		async readTranscript(workspace, session, maxChars) {
			const client = getHostServiceClientByUrl(await hostUrlFor(workspace));
			const result = await withTimeout(
				client.terminal.transcript.query({
					terminalId: session.terminalId,
					workspaceId: workspace.id,
					maxChars,
				}),
				HOST_TIMEOUT_MS,
				workspace.name,
			);
			return result.text.replace(ANSI, "").trim();
		},

		async sendMessage(workspace, session, text) {
			const client = getHostServiceClientByUrl(await hostUrlFor(workspace));
			await withTimeout(
				client.terminal.send.mutate({
					terminalId: session.terminalId,
					workspaceId: workspace.id,
					text,
				}),
				HOST_TIMEOUT_MS,
				workspace.name,
			);
		},

		async listPullRequests(workspace) {
			const client = getHostServiceClientByUrl(await hostUrlFor(workspace));
			const result = await withTimeout(
				client.pullRequests.historyByWorkspaces.query({
					workspaceIds: [workspace.id],
				}),
				HOST_TIMEOUT_MS,
				workspace.name,
			);
			const rows = result.workspaces[0]?.pullRequests ?? [];
			return rows.map(
				(row): VoicePullRequest => ({
					number: row.number,
					title: row.title,
					state: row.state,
					url: row.url,
					isCurrent: row.isCurrent,
				}),
			);
		},

		async listPages(workspaceId, limit) {
			const result = await withTimeout(
				apiClient.page.listPaginated.query({
					limit,
					...(workspaceId ? { workspaceId } : {}),
				}),
				HOST_TIMEOUT_MS,
				"Pages",
			);
			return result.items.map(toVoicePage);
		},

		async findPage(query) {
			const result = await withTimeout(
				apiClient.page.listPaginated.query({ limit: PAGE_SEARCH_LIMIT }),
				HOST_TIMEOUT_MS,
				"Pages",
			);
			const pages = result.items.map(toVoicePage);
			const q = query.trim().toLowerCase();
			return (
				pages.find((page) => page.id === query || page.slug === query) ??
				pages.find((page) => page.title.toLowerCase() === q) ??
				pages.find((page) => page.title.toLowerCase().includes(q)) ??
				pages.find((page) => page.slug.toLowerCase().includes(q)) ??
				null
			);
		},

		async restartWorkspace(workspace) {
			await withTimeout(
				apiClient.cloudWorkspace.restart.mutate({ id: workspace.id }),
				HOST_TIMEOUT_MS * 2,
				workspace.name,
			);
		},
	};
}

function toVoicePage(item: {
	id: string;
	slug: string;
	title: string | null;
	description: string | null;
	updatedAt: Date | string;
}): VoicePage {
	return {
		id: item.id,
		slug: item.slug,
		title: item.title ?? item.slug,
		description: item.description,
		updatedAt: toMs(item.updatedAt) ?? 0,
	};
}
