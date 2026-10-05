import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserServer } from "../src/main/browser-host/server";
import { browserSocketUrl } from "../src/renderer/browser/urls";

const checkout = process.env.CUBE_CHECKOUT;
if (!checkout) throw new Error("Set CUBE_CHECKOUT to the Cube source checkout");
const { AppGate } = await import(
	pathToFileURL(resolve(checkout, "src/main/cubed/apps/gate.ts")).href
);
const directory = await mkdtemp(join(tmpdir(), "superset-gate-"));
await writeFile(
	join(directory, "index.html"),
	"<title>Superset fixture</title>",
);
const upstream = createBrowserServer({
	rendererDir: directory,
	metadata: { appVersion: "qa", platform: "linux" },
	hostPorts: () => [],
	cloudApiUrl: "https://api.superset.sh",
	onTrpc: (_req, res) => {
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ trpc: true }));
	},
});
await new Promise<void>((resolve) =>
	upstream.server.listen(0, "127.0.0.1", resolve),
);
const port = (upstream.server.address() as { port: number }).port;
const gate = new AppGate({
	targetFor: () => ({ kind: "server", port }),
	log: () => {},
});
try {
	const gatePort = await gate.openListener("superset-qa");
	const base = `http://127.0.0.1:${gatePort}`;
	const path = new URL(browserSocketUrl(base)).pathname;
	const response = await fetch(`${base}${path}/qa`, {
		method: "POST",
		headers: { origin: base, "content-type": "application/json" },
		body: "{}",
	});
	assert.equal(response.status, 200, `${path} must pass the actual Cube gate`);
	assert.deepEqual(await response.json(), { trpc: true });
	console.log(JSON.stringify({ realCubeGate: true, rpcPath: path }));
} finally {
	await gate.closeAll();
	await upstream.close();
	await rm(directory, { recursive: true, force: true });
}
