import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPersistentMachineId } from "./persistent-machine-id";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("retains the encryption identity when the host identity changes after reboot", () => {
	const directory = mkdtempSync(join(tmpdir(), "superset identity "));
	directories.push(directory);
	const state = join(directory, "native");
	expect(getPersistentMachineId(state, () => "original-host-id")).toBe(
		"original-host-id",
	);
	expect(getPersistentMachineId(state, () => "replacement-host-id")).toBe(
		"original-host-id",
	);
	expect(readFileSync(join(state, "machine-id"), "utf8")).toBe(
		"original-host-id",
	);
	expect(statSync(join(state, "machine-id")).mode & 0o777).toBe(0o600);
});

test("a failed identity lookup leaves no partial identity behind", () => {
	const directory = mkdtempSync(join(tmpdir(), "superset identity failure "));
	directories.push(directory);
	expect(() =>
		getPersistentMachineId(directory, () => {
			throw new Error("unavailable");
		}),
	).toThrow("unavailable");
	expect(getPersistentMachineId(directory, () => "available-host-id")).toBe(
		"available-host-id",
	);
});

test("only the Cube browser host uses the persisted identity", () => {
	const directory = mkdtempSync(join(tmpdir(), "superset browser identity "));
	directories.push(directory);
	writeFileSync(join(directory, "machine-id"), "saved-browser-identity", {
		mode: 0o600,
	});
	const script = `import { getMachineId } from ${JSON.stringify(new URL("./host-info.ts", import.meta.url).pathname)}; process.stdout.write(String(getMachineId() === "saved-browser-identity"));`;
	for (const [browserMode, expected] of [
		["1", "true"],
		["0", "false"],
	] as const) {
		expect(
			execFileSync(process.execPath, ["-e", script], {
				env: {
					...process.env,
					CUBE_SUPERSET_WEB: browserMode,
					SUPERSET_HOME_DIR: directory,
				},
				encoding: "utf8",
			}),
		).toBe(expected);
	}
});
