import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

export function BrowserLinkPane({ initialUrl }: { initialUrl: string }) {
	const { t } = useLingui();
	const [url, setUrl] = useState(
		initialUrl === "about:blank" ? "" : initialUrl,
	);
	let destination: string | undefined;
	try {
		const parsed = new URL(url);
		if (
			["https:", "http:"].includes(parsed.protocol) &&
			!parsed.username &&
			!parsed.password
		)
			destination = parsed.href;
	} catch {}
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm text-muted-foreground">
			<p>
				<Trans>
					Open websites in your browser while using Superset in Cube.
				</Trans>
			</p>
			<input
				className="w-full max-w-lg rounded border bg-background p-2 text-foreground"
				aria-label={t({ message: "Website URL" })}
				value={url}
				onChange={(event) => setUrl(event.target.value)}
			/>
			{destination && (
				<a
					className="underline text-foreground"
					href={destination}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Trans>Open in browser</Trans>
				</a>
			)}
		</div>
	);
}
