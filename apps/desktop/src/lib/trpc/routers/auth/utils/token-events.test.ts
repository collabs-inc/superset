import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { tokenEvents } from "./token-events";

test("a reconnected browser receives auth changes missed while disconnected", async () => {
	const events = new EventEmitter();
	let current: { token: string | null; expiresAt: string | null } = {
		token: null,
		expiresAt: null,
	};
	const received: unknown[] = [];
	const stream = () =>
		tokenEvents(events, async () => current, true).subscribe({
			next: (value) => received.push(value),
		});
	const first = stream();
	await Promise.resolve();
	expect(received).toEqual([null]);
	first.unsubscribe();
	current = { token: "test-token", expiresAt: "2099-01-01" };
	events.emit("token-saved", current);
	const second = stream();
	await Promise.resolve();
	expect(received.at(-1)).toEqual(current);
	second.unsubscribe();
	current = { token: null, expiresAt: null };
	const third = stream();
	await Promise.resolve();
	expect(received.at(-1)).toBeNull();
	third.unsubscribe();
	expect(events.listenerCount("token-saved")).toBe(0);
});

test("a snapshot cannot overwrite a newer live event or emit after unsubscribe", async () => {
	const events = new EventEmitter();
	let resolve: (value: { token: string; expiresAt: string }) => void = () => {};
	const received: unknown[] = [];
	const subscription = tokenEvents(
		events,
		() =>
			new Promise((done) => {
				resolve = done;
			}),
		true,
	).subscribe({ next: (value) => received.push(value) });
	events.emit("token-cleared");
	resolve({ token: "stale", expiresAt: "2099-01-01" });
	await Promise.resolve();
	expect(received).toEqual([null]);
	subscription.unsubscribe();
	events.emit("token-saved", { token: "later", expiresAt: "2099-01-01" });
	expect(received).toEqual([null]);
});
