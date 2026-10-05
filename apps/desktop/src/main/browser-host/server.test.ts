import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createBrowserServer } from "./server";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(ports: number[] = []) {
	const root = await mkdtemp(join(tmpdir(), "superset-web-"));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "index.html"), "<app>Superset workspace</app>");
	const service = createBrowserServer({
		rendererDir: root,
		metadata: { appVersion: "1.35.0", platform: "linux", username: "node" },
		hostPorts: () => ports,
		cloudApiUrl: "https://api.superset.sh",
		onTrpc: (_req, res) => {
			res.end("rpc");
		},
	});
	await new Promise<void>((resolve) =>
		service.server.listen(0, "127.0.0.1", resolve),
	);
	cleanup.push(() => service.close());
	const port = (service.server.address() as { port: number }).port;
	return { base: `http://127.0.0.1:${port}`, service };
}

test("serves real renderer HTML and refuses sibling origins and rebound hosts", async () => {
	const { base } = await fixture();
	expect(await (await fetch(base)).text()).toContain(
		"<app>Superset workspace</app>",
	);
	expect(
		(await fetch(base, { headers: { host: "evil.example" } })).status,
	).toBe(403);
	expect(
		(
			await fetch(`${base}/__superset/trpc/settings.get`, {
				headers: { origin: "https://other-12345678.cube.site" },
			})
		).status,
	).toBe(403);
	expect(
		(await fetch(`${base}/__superset/trpc/settings.set`, { method: "POST" }))
			.status,
	).toBe(403);
	expect(
		await (
			await fetch(`${base}/__superset/trpc/settings.set`, {
				method: "POST",
				headers: { origin: base },
			})
		).text(),
	).toBe("rpc");
});

test("only forwards live Superset host ports and strips Cube cookies", async () => {
	const upstream = createServer((req, res) =>
		res.end(
			JSON.stringify({
				url: req.url,
				cookie: req.headers.cookie ?? null,
				auth: req.headers.authorization,
			}),
		),
	);
	await new Promise<void>((resolve) =>
		upstream.listen(0, "127.0.0.1", resolve),
	);
	cleanup.push(
		() => new Promise<void>((resolve) => upstream.close(() => resolve())),
	);
	const port = (upstream.address() as { port: number }).port;
	const ports: number[] = [];
	const { base } = await fixture(ports);
	const target = `${base}/__superset/host/${port}/trpc/terminal.list?batch=1`;
	expect((await fetch(target)).status).toBe(403);
	ports.push(port);
	const response = await fetch(target, {
		headers: {
			cookie: "cube_session=private",
			authorization: "Bearer host-session",
		},
	});
	expect(await response.json()).toEqual({
		url: "/trpc/terminal.list?batch=1",
		cookie: null,
		auth: "Bearer host-session",
	});
	ports.pop();
	expect((await fetch(target)).status).toBe(403);
});

test("does not serve paths outside renderer assets", async () => {
	const { base } = await fixture();
	expect((await fetch(`${base}/%2e%2e%2fpackage.json`)).status).toBe(404);
	expect((await fetch(`${base}/missing.js`)).status).toBe(404);
});

test("permits service-worker iframe navigation but refuses cross-site fetches", async () => {
	const { base } = await fixture();
	const headers = {
		"sec-fetch-site": "cross-site",
		"sec-fetch-mode": "navigate",
		"sec-fetch-dest": "empty",
	};
	expect((await fetch(base, { headers })).status).toBe(200);
	expect(
		(await fetch(base, { headers: { ...headers, "sec-fetch-mode": "cors" } }))
			.status,
	).toBe(403);
	expect(
		(
			await fetch(base, {
				headers: { ...headers, origin: "https://foreign.example" },
			})
		).status,
	).toBe(403);
});

test("host WebSockets require same origin and only reach active host ports", async () => {
	const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise<void>((resolve) => upstream.once("listening", resolve));
	cleanup.push(
		() =>
			new Promise<void>((resolve) => {
				for (const client of upstream.clients) client.terminate();
				upstream.close(() => resolve());
			}),
	);
	upstream.on("connection", (socket, req) =>
		socket.send(
			JSON.stringify({ cookie: req.headers.cookie ?? null, url: req.url }),
		),
	);
	const port = (upstream.address() as { port: number }).port;
	const { base } = await fixture([port]);
	const url = `${base.replace("http:", "ws:")}/__superset/host/${port}/terminal?token=host-session`;
	const connect = (origin: string) =>
		new WebSocket(url, { headers: { origin, cookie: "cube_session=private" } });
	const denied = connect("https://foreign.example");
	expect(
		await new Promise<string>((resolve) =>
			denied.on("error", (error) => resolve(error.message)),
		),
	).toBeTruthy();
	const client = connect(base);
	const message = await new Promise<string>((resolve, reject) => {
		client.once("message", (data) => resolve(String(data)));
		client.once("error", reject);
	});
	expect(JSON.parse(message)).toEqual({
		cookie: null,
		url: "/terminal?token=host-session",
	});
	client.close();
});
