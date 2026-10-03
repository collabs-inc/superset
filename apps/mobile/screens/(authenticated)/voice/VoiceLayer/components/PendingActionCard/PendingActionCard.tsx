import { useLingui } from "@lingui/react/macro";
import type { VoicePendingAction } from "@superset/shared/voice";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";

/**
 * A mutation the model proposed and the user has not yet approved. The
 * button and a spoken "yes" run the same pending action, so the model can
 * never skip the question.
 */
export function PendingActionCard({
	action,
	onApprove,
	onCancel,
}: {
	action: VoicePendingAction;
	onApprove: () => void;
	onCancel: () => void;
}) {
	const { t } = useLingui();
	const target = action.target;
	const heading =
		action.tool === "send_message"
			? t({ message: `Send to ${target}` })
			: t({ message: `Restart ${target}` });

	return (
		<View className="bg-card border-border mx-5 mb-3 gap-2.5 rounded-2xl border px-4 py-3.5">
			<Text className="text-[11px] font-semibold uppercase tracking-[0.6px] text-amber-400">
				{t({ message: "Waiting for your OK" })}
			</Text>
			<Text className="text-[14px] font-medium">{heading}</Text>
			{action.tool === "send_message" ? (
				<Text className="text-muted-foreground border-border border-l-2 pl-3 text-[15px] italic leading-[21px]">
					{action.summary}
				</Text>
			) : null}
			<View className="mt-1 flex-row gap-2">
				<Pressable
					accessibilityRole="button"
					className="bg-secondary h-10 flex-1 items-center justify-center rounded-xl active:opacity-70"
					onPress={() => {
						void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
						onCancel();
					}}
				>
					<Text className="text-[15px] font-semibold">
						{t({ message: "Cancel" })}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					className="bg-primary h-10 flex-1 items-center justify-center rounded-xl active:opacity-80"
					onPress={() => {
						void Haptics.notificationAsync(
							Haptics.NotificationFeedbackType.Success,
						);
						onApprove();
					}}
				>
					<Text className="text-primary-foreground text-[15px] font-semibold">
						{t({ message: "Approve" })}
					</Text>
				</Pressable>
			</View>
			<Text className="text-muted-foreground text-center text-[12px]">
				{t({ message: "or just say yes" })}
			</Text>
		</View>
	);
}
