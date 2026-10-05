export interface BrowserKeyboard {
	getLayoutMap(): Promise<ReadonlyMap<string, string>>;
}

export function syncBrowserKeyboard(
	keyboard: BrowserKeyboard | undefined,
	focusTarget: EventTarget,
	apply: (map: ReadonlyMap<string, string>) => void,
): () => void {
	let stopped = false;
	let generation = 0;
	const refresh = async () => {
		const current = ++generation;
		try {
			const map = await keyboard?.getLayoutMap();
			if (!stopped && current === generation && map) apply(map);
		} catch {
			/* Restricted browsers retain the standard keyboard fallback. */
		}
	};
	void refresh();
	focusTarget.addEventListener("focus", refresh);
	return () => {
		stopped = true;
		focusTarget.removeEventListener("focus", refresh);
	};
}
