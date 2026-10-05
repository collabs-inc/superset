import { join } from "node:path";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { app, type BrowserWindow } from "electron";
import type { AppRouter } from "lib/trpc/routers";
import { env } from "main/env.main";
import { getHostServiceCoordinator } from "main/lib/host-service-coordinator";
import { WebSocketServer } from "ws";
import { version } from "~/package.json";
import { createBrowserServer } from "./server";

export const browserHostEnabled = process.env.CUBE_SUPERSET_WEB === "1";

export async function startBrowserHost(
	router: AppRouter,
	getWindow: () => BrowserWindow | null,
) {
	const port = Number(process.env.PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Superset web requires PORT between 1 and 65535");
	const createContext = async () => ({ senderWindow: getWindow() });
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: 20 * 1024 * 1024,
	});
	const handler = applyWSSHandler({ wss, router, createContext });
	const service = createBrowserServer({
		rendererDir: join(__dirname, "../renderer"),
		metadata: {
			appVersion: version,
			platform: process.platform,
			username: process.env.USER,
		},
		hostPorts: () =>
			getHostServiceCoordinator()
				.getConnections()
				.map((connection) => connection.port),
		cloudApiUrl: env.NEXT_PUBLIC_API_URL,
		onTrpc: (req, res) =>
			nodeHTTPRequestHandler({
				req,
				res,
				router,
				createContext,
				path: new URL(req.url ?? "/", "http://localhost").pathname.slice(
					"/__cube/trpc/".length,
				),
				maxBodySize: 20 * 1024 * 1024,
			}),
		onTrpcUpgrade: (req, socket, head) =>
			wss.handleUpgrade(req, socket, head, (ws) =>
				wss.emit("connection", ws, req),
			),
	});
	await new Promise<void>((resolve, reject) => {
		service.server.once("error", reject);
		service.server.listen(port, "127.0.0.1", resolve);
	});
	app.once("before-quit", () => {
		handler.broadcastReconnectNotification();
		for (const client of wss.clients) client.terminate();
		wss.close();
		void service.close();
	});
	console.log(`[cube-web] Superset browser UI listening on 127.0.0.1:${port}`);
}
