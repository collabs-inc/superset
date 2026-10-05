import type { EventEmitter } from "node:events";
import { observable } from "@trpc/server/observable";

type Token = { token: string; expiresAt: string };

export function tokenEvents(
	events: EventEmitter,
	load: () => Promise<{ token: string | null; expiresAt: string | null }>,
	initialSnapshot: boolean,
) {
	return observable<Token | null>((emit) => {
		let changed = false;
		let stopped = false;
		const saved = (value: Token) => {
			changed = true;
			emit.next(value);
		};
		const cleared = () => {
			changed = true;
			emit.next(null);
		};
		events.on("token-saved", saved);
		events.on("token-cleared", cleared);
		if (initialSnapshot)
			void load().then(
				(value) => {
					if (!changed && !stopped)
						emit.next(
							value.token && value.expiresAt
								? { token: value.token, expiresAt: value.expiresAt }
								: null,
						);
				},
				(error) => {
					if (!stopped) emit.error(error);
				},
			);
		return () => {
			stopped = true;
			events.off("token-saved", saved);
			events.off("token-cleared", cleared);
		};
	});
}
