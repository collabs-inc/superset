import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { useSession } from "@/lib/auth/client";
import { onRealtimeNudge } from "@/lib/realtime/nudgeBus";
import { apiClient } from "@/lib/trpc/client";
import { VoiceSessionController } from "../session/VoiceSessionController";
import { createVoiceData } from "../tools/data";
import { WebRtcTransport } from "../transport/WebRtcTransport";
import { useVoiceLevelsStore } from "../voiceLevelsStore";
import { isVoiceActive, useVoiceStore } from "../voiceStore";

/** One session at a time, shared by the layer, the pill, and whatever starts it. */
let current: VoiceSessionController | null = null;
let currentPathname = "/";

export interface VoiceSessionHandle {
	start: () => Promise<void>;
	end: () => void;
	toggleMute: () => void;
	interrupt: () => void;
	confirmPending: () => Promise<void>;
	cancelPending: () => void;
}

export function useVoiceSession(): VoiceSessionHandle {
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const organizationId = session?.session?.activeOrganizationId ?? null;
	const userId = session?.user.id ?? null;
	const pathname = usePathname();
	const pathnameRef = useRef(pathname);
	pathnameRef.current = pathname;
	currentPathname = pathname;

	useEffect(() => {
		current?.noteScreen(pathname);
	}, [pathname]);

	const start = useCallback(async () => {
		if (!organizationId || !userId) return;
		if (current && isVoiceActive(useVoiceStore.getState().status)) {
			useVoiceStore.getState().setExpanded(true);
			return;
		}
		const controller = new VoiceSessionController({
			store: useVoiceStore,
			levels: useVoiceLevelsStore,
			data: createVoiceData({ organizationId, userId, queryClient }),
			mint: () => apiClient.voice.createSession.mutate(),
			createTransport: () => new WebRtcTransport(),
			router: {
				push: (href) => router.push(href as never),
				dismissTo: (href) => router.dismissTo(href as never),
				dismiss: () => router.dismiss(),
			},
			getPathname: () => currentPathname,
			onRealtimeNudge,
			newId: randomUUID,
			now: Date.now,
		});
		current = controller;
		await controller.start();
	}, [organizationId, userId, queryClient]);

	const end = useCallback(() => {
		current?.end();
		current = null;
	}, []);

	const toggleMute = useCallback(() => {
		current?.setMuted(!useVoiceStore.getState().muted);
	}, []);

	const interrupt = useCallback(() => current?.interrupt(), []);
	const confirmPending = useCallback(
		() => current?.confirmPending() ?? Promise.resolve(),
		[],
	);
	const cancelPending = useCallback(() => current?.cancelPending(), []);

	return { start, end, toggleMute, interrupt, confirmPending, cancelPending };
}
