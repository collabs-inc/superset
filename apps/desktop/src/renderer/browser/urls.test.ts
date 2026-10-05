import { expect, test } from "bun:test";
import { browserSocketUrl, localHostUrl } from "./urls";

test("cloud host connections stay on the app origin including HTTPS WebSockets", () => {
	expect(localHostUrl(41327, "https://superset-12345678.cube.site")).toBe(
		"https://superset-12345678.cube.site/__cube/host/41327",
	);
	expect(browserSocketUrl("https://superset-12345678.cube.site")).toBe(
		"wss://superset-12345678.cube.site/__cube/trpc",
	);
	expect(browserSocketUrl("http://127.0.0.1:3190")).toBe(
		"ws://127.0.0.1:3190/__cube/trpc",
	);
});

test("desktop retains its loopback URL and invalid ports cannot enter proxy paths", () => {
	expect(localHostUrl(41327, null)).toBe("http://127.0.0.1:41327");
	for (const port of [0, -1, 65536, NaN, 1.5])
		expect(() => localHostUrl(port, null)).toThrow();
});
