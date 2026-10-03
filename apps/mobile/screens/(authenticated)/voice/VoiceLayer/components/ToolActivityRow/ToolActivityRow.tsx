import { useLingui } from "@lingui/react/macro";
import { Check, X } from "lucide-react-native";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/hooks/useTheme";
import type { ToolActivityStatus } from "@/lib/voice/voiceStore";
import { WaveSpinner } from "@/screens/(authenticated)/components/WaveSpinner";

function useToolLabel(name: string, subject: string | null): string {
	const { t } = useLingui();
	const what = subject ?? "";
	switch (name) {
		case "list_workspaces":
			return t({ message: "Checking workspaces" });
		case "get_workspace":
			return subject
				? t({ message: `Looking at ${what}` })
				: t({ message: "Looking up a workspace" });
		case "list_sessions":
			return t({ message: `Listing sessions in ${what}` });
		case "read_session":
			return t({ message: `Reading ${what}` });
		case "list_pull_requests":
			return t({ message: `Checking pull requests in ${what}` });
		case "list_pages":
			return t({ message: "Looking for pages" });
		case "open_page":
		case "show":
			return t({ message: `Opening ${what}` });
		case "set_follow":
			return t({ message: "Follow mode" });
		case "send_message":
			return t({ message: `Preparing a message for ${what}` });
		case "restart_workspace":
			return t({ message: `Preparing to restart ${what}` });
		case "confirm_action":
			return t({ message: "Doing it" });
		case "cancel_action":
			return t({ message: "Never mind" });
		default:
			return name;
	}
}

/** One function call in the transcript: what it is doing, then whether it worked. */
export function ToolActivityRow({
	name,
	subject,
	status,
}: {
	name: string;
	subject: string | null;
	status: ToolActivityStatus;
}) {
	const label = useToolLabel(name, subject);
	const theme = useTheme();
	return (
		<View className="bg-secondary/70 flex-row items-center gap-2 self-start rounded-full py-1.5 pl-2.5 pr-3">
			{status === "running" ? (
				<WaveSpinner color={theme.mutedForeground} />
			) : status === "done" ? (
				<Icon as={Check} className="text-muted-foreground size-3.5" />
			) : (
				<Icon as={X} className="text-destructive size-3.5" />
			)}
			<Text className="text-muted-foreground text-[13px]">{label}</Text>
		</View>
	);
}
