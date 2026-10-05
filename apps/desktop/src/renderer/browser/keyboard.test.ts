import { expect, test } from "bun:test";
import { type BrowserKeyboard, syncBrowserKeyboard } from "./keyboard";

test("supports Chromium keyboard objects without EventTarget methods", async () => {
	const keyboard = {
		getLayoutMap: async () => new Map([["KeyQ", "a"]]),
	} as BrowserKeyboard;
	const received: string[] = [];
	const stop = syncBrowserKeyboard(keyboard, new EventTarget(), (map) =>
		received.push(map.get("KeyQ") ?? ""),
	);
	await Promise.resolve();
	expect(received).toEqual(["a"]);
	expect(stop).not.toThrow();
});

test("reads the client keyboard on focus and stops applying updates after cleanup", async () => {
	const keyboard = new EventTarget() as BrowserKeyboard;
	let resolve: (map: ReadonlyMap<string, string>) => void = () => {};
	keyboard.getLayoutMap = () =>
		new Promise((done) => {
			resolve = done;
		});
	const focus = new EventTarget();
	let value = "";
	const stop = syncBrowserKeyboard(keyboard, focus, (map) => {
		value = map.get("KeyY") ?? "";
	});
	resolve(new Map([["KeyY", "z"]]));
	await Promise.resolve();
	expect(value).toBe("z");
	focus.dispatchEvent(new Event("focus"));
	resolve(new Map([["KeyY", "y"]]));
	await Promise.resolve();
	expect(value).toBe("y");
	focus.dispatchEvent(new Event("focus"));
	stop();
	resolve(new Map([["KeyY", "x"]]));
	await Promise.resolve();
	expect(value).toBe("y");
});
