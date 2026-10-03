import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Alert } from "react-native";
import { errorCopy } from "@/lib/errors";
import { useVoiceSession } from "@/lib/voice/useVoiceSession";

/**
 * `superset://voice`: an entry point, not a screen. Starts the session in the
 * layer above the Stack and gets out of the way.
 */
export function VoiceEntryScreen() {
	const { t } = useLingui();
	const router = useRouter();
	const { start } = useVoiceSession();

	useEffect(() => {
		void start().catch((error: unknown) =>
			Alert.alert(
				t({ message: "Couldn't start voice mode" }),
				errorCopy(error),
			),
		);
		if (router.canGoBack()) router.back();
		else router.replace("/(authenticated)/(home)");
	}, [start, router, t]);

	return null;
}
