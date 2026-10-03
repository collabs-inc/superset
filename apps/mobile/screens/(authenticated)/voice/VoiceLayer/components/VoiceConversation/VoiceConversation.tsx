import { useLingui } from "@lingui/react/macro";
import type { VoicePendingAction } from "@superset/shared/voice";
import * as Haptics from "expo-haptics";
import { ChevronDown, Mic, MicOff, Navigation, X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	SlideInDown,
	SlideOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { TranscriptEntry, VoiceStatus } from "@/lib/voice/voiceStore";
import { PendingActionCard } from "../PendingActionCard";
import { VoiceOrb } from "../VoiceOrb";
import { useVoiceStatusLabel } from "../VoiceStatusLabel";
import { VoiceTranscript } from "../VoiceTranscript";

const ORB_SIZE = 72;

/**
 * The session, expanded: transcript as messages, the orb low where a thumb
 * can reach it, mute and end beside it. Tapping the orb while the model is
 * speaking cuts it off, like talking over it would.
 */
export function VoiceConversation({
	status,
	muted,
	follow,
	transcript,
	pendingAction,
	error,
	onMinimize,
	onToggleMute,
	onToggleFollow,
	onInterrupt,
	onEnd,
	onApprove,
	onCancel,
}: {
	status: VoiceStatus;
	muted: boolean;
	follow: boolean;
	transcript: TranscriptEntry[];
	pendingAction: VoicePendingAction | null;
	error: string | null;
	onMinimize: () => void;
	onToggleMute: () => void;
	onToggleFollow: () => void;
	onInterrupt: () => void;
	onEnd: () => void;
	onApprove: () => void;
	onCancel: () => void;
}) {
	const { t } = useLingui();
	const insets = useSafeAreaInsets();
	const statusLabel = useVoiceStatusLabel(status, muted);
	const reconnecting = status === "reconnecting";

	return (
		<Animated.View
			entering={SlideInDown.duration(260)}
			exiting={SlideOutDown.duration(200)}
			className="bg-background absolute inset-0"
			style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
		>
			<View className="flex-row items-center justify-between px-4 pb-2 pt-2">
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t({ message: "Minimize voice" })}
					hitSlop={8}
					className="size-9 items-center justify-center rounded-full active:opacity-60"
					onPress={() => {
						void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
						onMinimize();
					}}
				>
					<Icon as={ChevronDown} className="text-muted-foreground size-5" />
				</Pressable>
				<Text className="text-muted-foreground text-[13px] font-semibold">
					{t({ message: "Voice" })}
				</Text>
				<Pressable
					accessibilityRole="switch"
					accessibilityState={{ checked: follow }}
					accessibilityLabel={t({ message: "Follow the conversation" })}
					hitSlop={6}
					className={cn(
						"flex-row items-center gap-1.5 rounded-full py-1.5 pl-2.5 pr-3",
						follow ? "bg-primary" : "bg-secondary",
					)}
					onPress={() => {
						void Haptics.selectionAsync();
						onToggleFollow();
					}}
				>
					<Icon
						as={Navigation}
						className={cn(
							"size-3.5",
							follow ? "text-primary-foreground" : "text-muted-foreground",
						)}
					/>
					<Text
						className={cn(
							"text-[12px] font-semibold",
							follow ? "text-primary-foreground" : "text-muted-foreground",
						)}
					>
						{t({ message: "Follow" })}
					</Text>
				</Pressable>
			</View>

			{reconnecting || error ? (
				<Animated.View
					entering={FadeIn}
					exiting={FadeOut}
					className={cn(
						"mx-5 mb-2 rounded-xl px-3 py-2",
						error && !reconnecting ? "bg-destructive/15" : "bg-secondary",
					)}
				>
					<Text className="text-muted-foreground text-center text-[13px]">
						{reconnecting
							? t({ message: "Reconnecting… your conversation is kept." })
							: error}
					</Text>
				</Animated.View>
			) : null}

			{transcript.length === 0 ? (
				<View className="flex-1 items-center justify-center px-10">
					<Text className="text-muted-foreground text-center text-[15px] leading-[22px]">
						{status === "connecting"
							? t({ message: "Connecting…" })
							: t({
									message:
										"Ask what your agents are up to, or tell one what to do next.",
								})}
					</Text>
				</View>
			) : (
				<VoiceTranscript entries={transcript} />
			)}

			{pendingAction ? (
				<PendingActionCard
					action={pendingAction}
					onApprove={onApprove}
					onCancel={onCancel}
				/>
			) : null}

			<View className="items-center gap-3 pb-2 pt-1">
				<Text className="text-muted-foreground text-[12px] font-semibold uppercase tracking-[0.8px]">
					{statusLabel}
				</Text>
				<View className="flex-row items-center justify-center gap-7">
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={
							muted ? t({ message: "Unmute" }) : t({ message: "Mute" })
						}
						className={cn(
							"size-14 items-center justify-center rounded-full active:opacity-70",
							muted ? "bg-primary" : "bg-secondary",
						)}
						onPress={() => {
							void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
							onToggleMute();
						}}
					>
						<Icon
							as={muted ? MicOff : Mic}
							className={cn(
								"size-5",
								muted ? "text-primary-foreground" : "text-foreground",
							)}
						/>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t({ message: "Interrupt" })}
						disabled={status !== "speaking"}
						onPress={() => {
							void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
							onInterrupt();
						}}
					>
						<VoiceOrb status={status} size={ORB_SIZE} />
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t({ message: "End voice session" })}
						className="bg-destructive size-14 items-center justify-center rounded-full active:opacity-80"
						onPress={() => {
							void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
							onEnd();
						}}
					>
						<Icon as={X} className="size-5 text-white" />
					</Pressable>
				</View>
			</View>
		</Animated.View>
	);
}
