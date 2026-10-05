import { readFile, realpath } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import httpProxy from "http-proxy";

interface BrowserServerOptions {
	rendererDir: string;
	metadata: { appVersion: string; platform: string; username?: string };
	hostPorts: () => number[];
	cloudApiUrl: string;
	onTrpc: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
	onTrpcUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

function allowed(req: IncomingMessage, upgrade = false): boolean {
	if (
		!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
			req.socket.remoteAddress ?? "",
		)
	)
		return false;
	const host = req.headers.host;
	if (!host || /[\s/@?#\\]/.test(host)) return false;
	let parsed: URL;
	try {
		parsed = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (
		!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
		!/^[a-z0-9][a-z0-9-]*-[a-z0-9]{8}(?:-stg)?\.cube\.site$/.test(
			parsed.hostname,
		)
	)
		return false;
	const protocol =
		req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
	if (
		upgrade ||
		req.headers.origin ||
		!["GET", "HEAD"].includes(req.method ?? "")
	) {
		if (req.headers.origin !== `${protocol}://${host}`) return false;
	}
	const site = req.headers["sec-fetch-site"];
	if (site && !["same-origin", "none"].includes(String(site))) {
		const workerNavigation =
			req.method === "GET" &&
			req.headers["sec-fetch-mode"] === "navigate" &&
			req.headers["sec-fetch-dest"] === "empty";
		if (
			upgrade ||
			(!["document", "iframe"].includes(
				String(req.headers["sec-fetch-dest"]),
			) &&
				!workerNavigation)
		)
			return false;
	}
	return true;
}

const types: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
};

export function createBrowserServer(options: BrowserServerOptions) {
	const sockets = new Set<Duplex>();
	const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true });
	const removePrivateHeaders = (request: http.ClientRequest) => {
		for (const name of [
			"cookie",
			"origin",
			"referer",
			"x-forwarded-host",
			"x-forwarded-for",
			"x-forwarded-proto",
		])
			request.removeHeader(name);
	};
	proxy.on("proxyReq", removePrivateHeaders);
	proxy.on("proxyReqWs", removePrivateHeaders);
	proxy.on("proxyRes", (response) => {
		delete response.headers["set-cookie"];
		delete response.headers["access-control-allow-origin"];
	});
	proxy.on("error", (_error, _req, response) => {
		if ("writeHead" in response && !response.headersSent)
			response.writeHead(502);
		response.end();
	});

	function proxyTarget(req: IncomingMessage): string | null {
		const host = /^\/__cube\/host\/(\d+)(\/.*)$/.exec(req.url ?? "");
		if (host && options.hostPorts().includes(Number(host[1]))) {
			req.url = host[2];
			return `http://127.0.0.1:${Number(host[1])}`;
		}
		if (req.url?.startsWith("/__cube/cloud/")) {
			req.url = req.url.slice("/__cube/cloud".length);
			return options.cloudApiUrl;
		}
		return null;
	}

	const server = http.createServer(async (req, res) => {
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Cache-Control", "no-store");
		if (!allowed(req)) {
			res.writeHead(403).end("Forbidden");
			return;
		}
		try {
			if (req.url?.startsWith("/__cube/trpc/")) {
				await options.onTrpc(req, res);
				return;
			}
			if (
				req.url?.startsWith("/__cube/host/") ||
				req.url?.startsWith("/__cube/cloud/")
			) {
				const target = proxyTarget(req);
				if (!target) {
					res.writeHead(403).end("Unavailable host");
					return;
				}
				proxy.web(req, res, { target });
				return;
			}
			if (!["GET", "HEAD"].includes(req.method ?? "")) {
				res.writeHead(405).end();
				return;
			}
			if (req.url === "/__cube/config") {
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(options.metadata));
				return;
			}
			const route = decodeURIComponent(
				new URL(req.url ?? "/", "http://localhost").pathname,
			);
			const base = await realpath(options.rendererDir);
			const file = await realpath(
				path.join(base, route === "/" ? "index.html" : route),
			);
			if (
				!file.startsWith(`${base}${path.sep}`) ||
				route.split("/").some((part) => part.startsWith("."))
			)
				throw new Error("Outside renderer");
			res.setHeader(
				"Content-Type",
				types[path.extname(file)] ?? "application/octet-stream",
			);
			res.end(req.method === "HEAD" ? undefined : await readFile(file));
		} catch {
			if (!res.headersSent) res.writeHead(404);
			res.end("Not found");
		}
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	server.on("upgrade", (req, socket, head) => {
		if (!allowed(req, true)) {
			socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		if (req.url === "/__cube/trpc" && options.onTrpcUpgrade) {
			options.onTrpcUpgrade(req, socket, head);
			return;
		}
		if (req.url?.startsWith("/__cube/host/")) {
			const target = proxyTarget(req);
			if (target) {
				proxy.ws(req, socket, head, { target });
				return;
			}
		}
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
	});
	return {
		server,
		async close() {
			proxy.close();
			for (const socket of sockets) socket.destroy();
			if (server.listening)
				await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
