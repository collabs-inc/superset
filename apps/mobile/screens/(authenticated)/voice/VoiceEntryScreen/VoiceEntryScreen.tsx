import { useRouter } from "expo-router";
import { useEffect } from "react";
import { useVoiceSession } from "@/lib/voice/useVoiceSession";

/**
 * `superset://voice`: an entry point, not a screen. Starts the session in the
 * layer above the Stack and gets out of the way.
 */
export function VoiceEntryScreen() {
	const router = useRouter();
	const { start } = useVoiceSession();

	useEffect(() => {
		void start().catch(() => {});
		if (router.canGoBack()) router.back();
		else router.replace("/(authenticated)/(home)");
	}, [start, router]);

	return null;
}
