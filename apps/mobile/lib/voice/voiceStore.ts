import AsyncStorage from "@react-native-async-storage/async-storage";
import type { VoicePendingAction } from "@superset/shared/voice";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type VoiceStatus =
	| "idle"
	| "connecting"
	| "listening"
	| "thinking"
	| "speaking"
	| "reconnecting"
	| "ended";

export type ToolActivityStatus = "running" | "done" | "failed";

export type TranscriptEntry =
	| { id: string; role: "user" | "assistant"; text: string; final: boolean }
	| {
			id: string;
			role: "tool";
			name: string;
			/** What it acted on, e.g. a workspace name; the UI words the rest. */
			subject: string | null;
			status: ToolActivityStatus;
	  };

const MAX_TRANSCRIPT = 200;

export interface VoiceState {
	status: VoiceStatus;
	expanded: boolean;
	muted: boolean;
	/** The phone navigates to whatever the conversation is about. */
	follow: boolean;
	/** The model may speak up when an agent's status changes. */
	proactive: boolean;
	transcript: TranscriptEntry[];
	pendingAction: VoicePendingAction | null;
	/** What the model is looking at, for the docked pill. */
	focusLabel: string | null;
	error: string | null;
	startedAt: number | null;

	setStatus: (status: VoiceStatus) => void;
	setExpanded: (expanded: boolean) => void;
	setMuted: (muted: boolean) => void;
	setFollow: (follow: boolean) => void;
	setProactive: (proactive: boolean) => void;
	upsertSpeech: (
		id: string,
		role: "user" | "assistant",
		text: string,
		final: boolean,
	) => void;
	addTool: (id: string, name: string, subject: string | null) => void;
	settleTool: (
		id: string,
		status: Exclude<ToolActivityStatus, "running">,
	) => void;
	setPendingAction: (action: VoicePendingAction | null) => void;
	setFocusLabel: (label: string | null) => void;
	setError: (error: string | null) => void;
	begin: (startedAt: number) => void;
	reset: () => void;
}

const SESSION_DEFAULTS = {
	status: "idle" as VoiceStatus,
	expanded: false,
	muted: false,
	transcript: [] as TranscriptEntry[],
	pendingAction: null,
	focusLabel: null,
	error: null,
	startedAt: null,
};

export const useVoiceStore = create<VoiceState>()(
	persist(
		(set) => ({
			...SESSION_DEFAULTS,
			follow: true,
			proactive: false,

			setStatus: (status) => set({ status }),
			setExpanded: (expanded) => set({ expanded }),
			setMuted: (muted) => set({ muted }),
			setFollow: (follow) => set({ follow }),
			setProactive: (proactive) => set({ proactive }),
			upsertSpeech: (id, role, text, final) =>
				set((state) => {
					const index = state.transcript.findIndex((entry) => entry.id === id);
					const entry = { id, role, text, final };
					if (index === -1) {
						return {
							transcript: [...state.transcript, entry].slice(-MAX_TRANSCRIPT),
						};
					}
					const transcript = state.transcript.slice();
					transcript[index] = entry;
					return { transcript };
				}),
			addTool: (id, name, subject) =>
				set((state) => {
					const entry: TranscriptEntry = {
						id,
						role: "tool",
						name,
						subject,
						status: "running",
					};
					return {
						transcript: [...state.transcript, entry].slice(-MAX_TRANSCRIPT),
					};
				}),
			settleTool: (id, status) =>
				set((state) => ({
					transcript: state.transcript.map((entry) =>
						entry.id === id && entry.role === "tool"
							? { ...entry, status }
							: entry,
					),
				})),
			setPendingAction: (pendingAction) => set({ pendingAction }),
			setFocusLabel: (focusLabel) => set({ focusLabel }),
			setError: (error) => set({ error }),
			begin: (startedAt) =>
				set({
					...SESSION_DEFAULTS,
					status: "connecting",
					expanded: true,
					startedAt,
				}),
			reset: () => set({ ...SESSION_DEFAULTS }),
		}),
		{
			name: "voice-v1",
			storage: createJSONStorage(() => AsyncStorage),
			partialize: (state) => ({
				follow: state.follow,
				proactive: state.proactive,
			}),
		},
	),
);

export type VoiceStoreApi = typeof useVoiceStore;

export function isVoiceActive(status: VoiceStatus): boolean {
	return status !== "idle" && status !== "ended";
}
