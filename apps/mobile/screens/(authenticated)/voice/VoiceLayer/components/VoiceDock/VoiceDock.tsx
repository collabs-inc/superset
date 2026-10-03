import { useLingui } from "@lingui/react/macro";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import type { VoiceStatus } from "@/lib/voice/voiceStore";
import { VoiceOrb } from "../VoiceOrb";
import { useVoiceStatusLabel } from "../VoiceStatusLabel";

/**
 * The session while the user is elsewhere in the app: a pill under the
 * status bar with the orb, what it is doing, and what it is looking at.
 */
export function VoiceDock({
	status,
	muted,
	focusLabel,
	onExpand,
	onEnd,
}: {
	status: VoiceStatus;
	muted: boolean;
	focusLabel: string | null;
	onExpand: () => void;
	onEnd: () => void;
}) {
	const { t } = useLingui();
	const insets = useSafeAreaInsets();
	const statusLabel = useVoiceStatusLabel(status, muted);

	const body = (
		<View className="flex-row items-center gap-2 py-1.5 pl-2 pr-1.5">
			<VoiceOrb status={status} size={20} />
			<Text className="text-[13px] font-semibold">{statusLabel}</Text>
			{focusLabel ? (
				<Text
					className="text-muted-foreground max-w-[140px] text-[13px]"
					numberOfLines={1}
				>
					· {focusLabel}
				</Text>
			) : null}
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t({ message: "End voice session" })}
				hitSlop={8}
				className="size-7 items-center justify-center rounded-full active:opacity-60"
				onPress={() => {
					void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
					onEnd();
				}}
			>
				<Icon as={X} className="text-muted-foreground size-4" />
			</Pressable>
		</View>
	);

	return (
		<Animated.View
			entering={FadeInUp.duration(180)}
			exiting={FadeOutUp.duration(140)}
			pointerEvents="box-none"
			style={{
				position: "absolute",
				// Below the navigation bar rather than over its title.
				top: insets.top + 50,
				left: 0,
				right: 0,
				alignItems: "center",
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t({ message: "Expand voice" })}
				onPress={() => {
					void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
					onExpand();
				}}
			>
				{isLiquidGlassAvailable() ? (
					<GlassView glassEffectStyle="regular" style={{ borderRadius: 999 }}>
						{body}
					</GlassView>
				) : (
					<View className="bg-secondary rounded-full">{body}</View>
				)}
			</Pressable>
		</Animated.View>
	);
}
