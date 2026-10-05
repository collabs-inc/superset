# Superset browser entry for Cube

The user wants a minimally different Superset running in Cube with an actual browser UI and no display streaming. Preserve the existing renderer, terminal/agent workflows, repository/worktree model, files, and review surfaces. The previous noVNC integration is not acceptable.

## Architecture

Add an opt-in browser host to the existing desktop backend. Keep Electron as a backend runtime for this first port because the desktop router, settings, authentication, and host-service coordinator still import it. Run its window invisibly with no workspace renderer; serve the existing renderer assets to Cube over HTTP. The browser exchanges structured tRPC requests, subscriptions, and terminal bytes with the backend. No VNC, video frames, screenshots, or input forwarding to a remote desktop participate in the UI.

A pure Node extraction of every desktop service would be substantially broader. Building a replacement UI around host-service would change the product. The browser-host adapter preserves the most upstream behavior while making the actual UI browser-rendered. Backend runtime extraction can follow independently.

The server binds only to loopback at Cube's assigned PORT. Cube's existing app gate remains the access boundary. Validate Host and Origin for HTTP and WebSockets, reject sibling origins and DNS rebinding, and never expose a generic arbitrary-port proxy. Only Superset's active coordinator-owned host-service ports may be forwarded. Cloud API proxying targets a fixed configured Superset origin, strips Cube cookies, and preserves Superset authentication and authorization.

## Browser adaptations

Use a browser bootstrap to provide app metadata and low-level event subscriptions. Switch desktop tRPC transport to HTTP/WebSocket only in browser mode. Translate host-service loopback addresses to same-origin routes so terminal, files, events, and Git requests reach the cloud machine. Preserve the existing Superset sign-in and account requirements by default; do not invent memberships or unlock hosted features. The upstream OAuth loopback restriction may require the existing Cube localhost forwarding for initial sign-in; surface that limitation honestly if needed.

Directory selection must refer to the cloud filesystem, using an HTML picker or validated path entry. Clipboard and external links run in the user's browser. Native window controls and desktop updater do not act on an invisible backend. Electron-only embedded browser surfaces need a browser equivalent or an explicit unsupported state, never a streamed view.

## Lifecycle and data

Keep the existing persistent Superset data directory. Development and QA use a separate data directory and test checkout. Do not stop the installed Superset or any of its terminals while developing. Before replacing the installed integration, check for live sessions and preserve them; never kill Cube's cubed or ptyd. The manifest starts the browser service. Existing desktop bridge files must no longer be used by the manifest path.

## Acceptance

Prove the browser shows real Superset DOM and contains no noVNC client. Test opening a disposable repository/workspace, shell input/output, a real installed agent CLI, file editing and Git diff display, resizing, browser refresh/reconnect, and app stop/start persistence. Record sign-in-dependent checks separately from fixture checks. Tests cover ingress rejection, proxy target restriction, subscriptions/reconnect, paths with spaces, and cleanup of only owned processes. Build and package reproducibly, commit/push the fork, update the installed app after verifying safe lifecycle behavior, and record limitations in cube/README.md and the Cube handoff.
