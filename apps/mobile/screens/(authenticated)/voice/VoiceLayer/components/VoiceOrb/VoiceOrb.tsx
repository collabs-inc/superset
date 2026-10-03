import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { useVoiceLevelsStore } from "@/lib/voice/voiceLevelsStore";
import type { VoiceStatus } from "@/lib/voice/voiceStore";

const COLORS = ["#6d6cff", "#4fd1ff", "#c08cff"] as const;
const LEVEL_SMOOTHING_MS = 90;

/**
 * The session's face. Breathes while listening, quickens while thinking,
 * swells with the model's voice while speaking, and the halo follows the
 * user's own level so "who is talking" reads without a label.
 */
export function VoiceOrb({
	status,
	size,
}: {
	status: VoiceStatus;
	size: number;
}) {
	const breathe = useSharedValue(0);
	const input = useSharedValue(0);
	const output = useSharedValue(0);

	useEffect(() => {
		return useVoiceLevelsStore.subscribe((levels) => {
			input.value = withTiming(levels.input, { duration: LEVEL_SMOOTHING_MS });
			output.value = withTiming(levels.output, {
				duration: LEVEL_SMOOTHING_MS,
			});
		});
	}, [input, output]);

	useEffect(() => {
		cancelAnimation(breathe);
		const duration =
			status === "thinking" ? 700 : status === "speaking" ? 1_200 : 2_400;
		breathe.value = withRepeat(
			withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
			-1,
			true,
		);
	}, [status, breathe]);

	const dimmed =
		status === "reconnecting" || status === "connecting" || status === "ended";

	const bodyStyle = useAnimatedStyle(() => ({
		transform: [{ scale: 1 + breathe.value * 0.04 + output.value * 0.18 }],
	}));
	const haloStyle = useAnimatedStyle(() => ({
		transform: [{ scale: 1.1 + breathe.value * 0.08 + input.value * 0.45 }],
		opacity: 0.18 + input.value * 0.5,
	}));
	const glowStyle = useAnimatedStyle(() => ({
		opacity: 0.15 + output.value * 0.6,
		transform: [{ scale: 0.55 + output.value * 0.35 }],
	}));

	return (
		<View
			style={{ width: size, height: size, opacity: dimmed ? 0.4 : 1 }}
			accessibilityElementsHidden
		>
			<Animated.View
				style={[
					StyleSheet.absoluteFill,
					{ borderRadius: size / 2, borderWidth: 1, borderColor: COLORS[0] },
					haloStyle,
				]}
			/>
			<Animated.View
				style={[
					StyleSheet.absoluteFill,
					{ borderRadius: size / 2, overflow: "hidden" },
					bodyStyle,
				]}
			>
				<LinearGradient
					colors={[...COLORS]}
					start={{ x: 0.15, y: 0.1 }}
					end={{ x: 0.9, y: 1 }}
					style={StyleSheet.absoluteFill}
				/>
				<View
					style={{
						position: "absolute",
						top: size * 0.14,
						left: size * 0.18,
						width: size * 0.26,
						height: size * 0.26,
						borderRadius: size * 0.13,
						backgroundColor: "rgba(255,255,255,0.55)",
					}}
				/>
				<Animated.View
					style={[
						StyleSheet.absoluteFill,
						{ borderRadius: size / 2, backgroundColor: "#ffffff" },
						glowStyle,
					]}
				/>
			</Animated.View>
		</View>
	);
}
