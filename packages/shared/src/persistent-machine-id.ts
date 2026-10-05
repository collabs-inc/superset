import { randomUUID } from "node:crypto";
import {
	linkSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function getPersistentMachineId(
	directory: string,
	resolveInitialId: () => string,
): string {
	const file = join(directory, "machine-id");
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const initialId = resolveInitialId();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.machine-id-${randomUUID()}`);
	writeFileSync(temporary, initialId, { mode: 0o600, flag: "wx" });
	try {
		try {
			linkSync(temporary, file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		return readFileSync(file, "utf8");
	} finally {
		unlinkSync(temporary);
	}
}
