import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import type { AppRouter } from "lib/trpc/routers";
import superjson from "superjson";
import { ipcLink } from "trpc-electron/renderer";
import { isBrowserHost } from "../browser/mode";
import { browserNativeLink } from "../browser/native-actions";
import { browserSocketUrl } from "../browser/urls";
import { electronTrpc } from "./electron-trpc";
import { sessionIdLink } from "./session-id-link";

const browserClient = isBrowserHost
	? createWSClient({ url: browserSocketUrl(window.location.origin) })
	: null;
const transport = () =>
	browserClient
		? wsLink<AppRouter>({ client: browserClient, transformer: superjson })
		: ipcLink<AppRouter>({ transformer: superjson });
const links = () => [
	sessionIdLink<AppRouter>(),
	...(browserClient ? [browserNativeLink()] : []),
	transport(),
];

/** Electron tRPC React client for React hooks (used by ElectronTRPCProvider). */
export const electronReactClient = electronTrpc.createClient({
	links: links(),
});

/** Electron tRPC proxy client for imperative calls from stores/utilities. */
export const electronTrpcClient = createTRPCProxyClient<AppRouter>({
	links: links(),
});
