import { afterEach, expect, mock, test } from "bun:test";
import { createTRPCProxyClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "lib/trpc/routers";
import { browserNativeLink } from "./native-actions";

const originalWindow = globalThis.window;
const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);
afterEach(() => {
	globalThis.window = originalWindow;
	if (originalClipboard)
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	else Reflect.deleteProperty(navigator, "clipboard");
});

test("copy and external-link actions run in the user's browser", async () => {
	const writeText = mock(async (_value: string) => {});
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true,
	});
	const open = mock(() => null);
	globalThis.window = { open } as unknown as Window & typeof globalThis;
	const remote = mock(() =>
		observable((observer) => {
			observer.next({ result: { data: "backend" } });
			observer.complete();
		}),
	);
	const client = createTRPCProxyClient<AppRouter>({
		links: [browserNativeLink(), () => remote],
	});
	await client.external.copyText.mutate("cloud output");
	expect(writeText).toHaveBeenCalledWith("cloud output");
	await client.external.openUrl.mutate(
		"https://github.com/superset-sh/superset",
	);
	expect(open).toHaveBeenCalledWith(
		"https://github.com/superset-sh/superset",
		"_blank",
		"noopener,noreferrer",
	);
	await expect(
		client.external.openUrl.mutate("javascript:alert(1)"),
	).rejects.toThrow("Unsupported URL");
	await expect(
		client.external.openUrl.mutate("https://user:password@example.com"),
	).rejects.toThrow("Unsupported URL");
	expect(remote).not.toHaveBeenCalled();
	expect(await client.window.getHomeDir.query()).toBe("backend");
	expect(remote).toHaveBeenCalledTimes(1);
});
