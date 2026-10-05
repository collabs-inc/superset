import crypto from "node:crypto";
import { AUTH_PROVIDERS } from "@superset/shared/constants";
import { getHostId, getHostName } from "@superset/shared/host-info";
import { shell } from "electron";
import { env } from "main/env.main";
import { getHostServiceCoordinator } from "main/lib/host-service-coordinator";
import { PLATFORM, PROTOCOL_SCHEME } from "shared/constants";
import { env as sharedEnv } from "shared/env.shared";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import {
	authEvents,
	clearToken,
	loadToken,
	saveOrganizationIds,
	saveToken,
	stateStore,
} from "./utils/auth-functions";
import { tokenEvents } from "./utils/token-events";
import { writeAuth } from "./utils/write-auth";

export const createAuthRouter = () => {
	return router({
		getStoredToken: publicProcedure.query(() => loadToken()),

		getDeviceInfo: publicProcedure.query(() => ({
			deviceId: getHostId(),
			deviceName: getHostName(),
		})),

		persistToken: publicProcedure
			.input(
				z.object({
					token: z.string(),
					expiresAt: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				await writeAuth(() => saveToken(input));
				return { success: true };
			}),

		persistOrganizationIds: publicProcedure
			.input(
				z.object({
					token: z.string(),
					organizationIds: z.array(z.string()),
					expectedRevision: z.number().int().nonnegative(),
				}),
			)
			.mutation(async ({ input }) => {
				return await writeAuth(() => saveOrganizationIds(input));
			}),

		/**
		 * Subscribe to auth events. Only fires for actual changes:
		 * - New authentication (OAuth callback) -> { token, expiresAt }
		 * - Sign out -> null
		 *
		 * Browser subscriptions also replay current state after a reconnect.
		 * Desktop IPC uses getStoredToken for initial hydration.
		 */
		onTokenChanged: publicProcedure.subscription(() =>
			tokenEvents(authEvents, loadToken, process.env.CUBE_SUPERSET_WEB === "1"),
		),

		/**
		 * Start OAuth sign-in flow.
		 * Opens browser for OAuth, token delivered via deep link on macOS
		 * or localhost callback on Linux (where deep links are unreliable).
		 */
		signIn: publicProcedure
			.input(z.object({ provider: z.enum(AUTH_PROVIDERS) }))
			.mutation(async ({ input }) => {
				try {
					const state = crypto.randomBytes(32).toString("base64url");
					stateStore.set(state, Date.now());

					// Clean up expired states (10 minutes)
					const cutoff = Date.now() - 10 * 60 * 1000;
					for (const [s, ts] of stateStore) {
						if (ts < cutoff) stateStore.delete(s);
					}

					const connectUrl = new URL(
						`${env.NEXT_PUBLIC_API_URL}/api/auth/desktop/connect`,
					);
					connectUrl.searchParams.set("provider", input.provider);
					connectUrl.searchParams.set("state", state);
					connectUrl.searchParams.set("protocol", PROTOCOL_SCHEME);
					// Only send local_callback on Linux where deep links are unreliable
					if (PLATFORM.IS_LINUX) {
						connectUrl.searchParams.set(
							"local_callback",
							`http://127.0.0.1:${sharedEnv.DESKTOP_NOTIFICATIONS_PORT}/auth/callback`,
						);
					}
					if (process.env.CUBE_SUPERSET_WEB === "1") {
						return { success: true, url: connectUrl.toString() };
					}
					await shell.openExternal(connectUrl.toString());
					return { success: true };
				} catch (err) {
					return {
						success: false,
						error:
							err instanceof Error ? err.message : "Failed to open browser",
					};
				}
			}),

		signOut: publicProcedure.mutation(async () => {
			getHostServiceCoordinator().stopAll();
			await writeAuth(() => clearToken());
			return { success: true };
		}),
	});
};

export type AuthRouter = ReturnType<typeof createAuthRouter>;
