import { StyleSheet, View } from "react-native";
import { useVoiceSession } from "@/lib/voice/useVoiceSession";
import { isVoiceActive, useVoiceStore } from "@/lib/voice/voiceStore";
import { VoiceConversation } from "./components/VoiceConversation";
import { VoiceDock } from "./components/VoiceDock";

/**
 * Sits above the Stack for the whole signed-in lifetime and draws nothing
 * until a session starts; then the full conversation or, once the app is
 * being used underneath, the pill. The session itself lives in the store and
 * controller, so navigating never ends it.
 */
export function VoiceLayer() {
	const session = useVoiceSession();
	const status = useVoiceStore((state) => state.status);
	const expanded = useVoiceStore((state) => state.expanded);
	const muted = useVoiceStore((state) => state.muted);
	const follow = useVoiceStore((state) => state.follow);
	const transcript = useVoiceStore((state) => state.transcript);
	const pendingAction = useVoiceStore((state) => state.pendingAction);
	const focusLabel = useVoiceStore((state) => state.focusLabel);
	const error = useVoiceStore((state) => state.error);
	const setExpanded = useVoiceStore((state) => state.setExpanded);
	const setFollow = useVoiceStore((state) => state.setFollow);

	if (!isVoiceActive(status)) return null;

	return (
		<View style={StyleSheet.absoluteFill} pointerEvents="box-none">
			{expanded ? (
				<VoiceConversation
					status={status}
					muted={muted}
					follow={follow}
					transcript={transcript}
					pendingAction={pendingAction}
					error={error}
					onMinimize={() => setExpanded(false)}
					onToggleMute={session.toggleMute}
					onToggleFollow={() => setFollow(!follow)}
					onInterrupt={session.interrupt}
					onEnd={session.end}
					onApprove={() => void session.confirmPending()}
					onCancel={session.cancelPending}
				/>
			) : (
				<VoiceDock
					status={status}
					muted={muted}
					focusLabel={focusLabel}
					onExpand={() => setExpanded(true)}
					onEnd={session.end}
				/>
			)}
		</View>
	);
}
