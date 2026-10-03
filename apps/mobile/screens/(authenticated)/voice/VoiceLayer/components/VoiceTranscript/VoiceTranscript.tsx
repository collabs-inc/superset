import { useRef } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { TranscriptEntry } from "@/lib/voice/voiceStore";
import { ToolActivityRow } from "../ToolActivityRow";

/**
 * The conversation as messages: what the user said on the right, the model's
 * words full width, tool calls as rows between them. Words still being
 * transcribed are dimmed until they settle.
 */
export function VoiceTranscript({ entries }: { entries: TranscriptEntry[] }) {
	const scrollRef = useRef<ScrollView>(null);

	return (
		<ScrollView
			ref={scrollRef}
			className="flex-1"
			contentContainerClassName="gap-3 px-5 pb-4 pt-2"
			showsVerticalScrollIndicator={false}
			onContentSizeChange={() =>
				scrollRef.current?.scrollToEnd({ animated: true })
			}
		>
			{entries.map((entry) => {
				if (entry.role === "tool") {
					return (
						<ToolActivityRow
							key={entry.id}
							name={entry.name}
							subject={entry.subject}
							status={entry.status}
						/>
					);
				}
				if (entry.role === "user") {
					return (
						<View
							key={entry.id}
							className={cn(
								"bg-secondary max-w-[82%] self-end rounded-2xl rounded-br-md px-3.5 py-2",
								!entry.final && "opacity-60",
							)}
						>
							<Text className="text-[16px] leading-[22px]">{entry.text}</Text>
						</View>
					);
				}
				return (
					<Text
						key={entry.id}
						className={cn(
							"max-w-[92%] text-[16px] leading-[23px]",
							!entry.final && "text-muted-foreground",
						)}
					>
						{entry.text}
					</Text>
				);
			})}
		</ScrollView>
	);
}
