import { isBrowserHost } from "./mode";

export function localHostUrl(
	port: number,
	origin: string | null = isBrowserHost ? window.location.origin : null,
): string {
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Invalid Superset host port");
	return origin ? `${origin}/__cube/host/${port}` : `http://127.0.0.1:${port}`;
}

export function browserSocketUrl(origin: string): string {
	const url = new URL("/__cube/trpc", origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.href;
}
