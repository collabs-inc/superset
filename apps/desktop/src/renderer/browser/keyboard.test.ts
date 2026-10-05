import { expect, test } from "bun:test";
import { type BrowserKeyboard, syncBrowserKeyboard } from "./keyboard";

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
	keyboard.dispatchEvent(new Event("layoutchange"));
	stop();
	resolve(new Map([["KeyY", "x"]]));
	await Promise.resolve();
	expect(value).toBe("y");
});
