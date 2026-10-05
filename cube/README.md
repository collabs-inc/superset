# Superset in Cube

Install `https://github.com/collabs-inc/superset` in Cube. The `cube-app` branch
serves Superset's renderer as real browser HTML, CSS and JavaScript. HTTP and
WebSocket connections carry application data and terminal bytes. No display
streaming participates in the interface. The former `cube/desktop` bridge is
retained as historical code and is not imported or installed by the manifest.

The first port retains Electron as an invisible backend because upstream
services still depend on it. Electron runs with the headless Ozone backend and
an empty backend window; no display server is started. The browser
host binds to loopback `$PORT` behind Cube's app gate. Chromium's sandbox remains
enabled. The launcher owns its private D-Bus, keyring and backend processes.

The machine needs Linux x64 and Node 22+. On Debian 12, install:

```sh
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates \
  libgtk-3-0 libnss3 libgbm1 libasound2 libsecret-1-0 \
  dbus gnome-keyring
```

If an Electron platform issue requires an X server, install `xvfb xauth` and set
`CUBE_SUPERSET_VIRTUAL_DISPLAY=1`. This optional fallback uses a private invisible
display and still serves the real browser UI without any display transport.

`install.sh` verifies both the upstream 1.35.0 Debian package and the browser
overlay using SHA-256 pins in `runtime.json`. It extracts the original Linux
native dependencies, replaces the compiled application and renderer, and writes
an immutable cache under `~/.cache/cube-superset/browser-<sha256>`. Cube owns
updates; the independent upstream updater is disabled. Installation neither
starts the app nor modifies existing profiles.

Profiles and native state persist at
`${XDG_DATA_HOME:-$HOME/.local/share}/cube-superset` (override with
`CUBE_SUPERSET_DATA_DIR`). Some upstream terminal services also use `~/.superset`.
The machine's HOME, existing repositories and Claude/Codex sign-ins are retained.
The upstream application requires its own GitHub or Google sign-in before use.
This integration does not create that account or bypass authentication.

Upstream Linux authentication returns to `http://127.0.0.1:51741/auth/callback`;
that cloud port must be forwarded to the same port on your local computer while
signing in. Cube's localhost forwarding can supply this, or run
`ssh -N -L 127.0.0.1:51741:127.0.0.1:51741 <your-cube-ssh-host>`.
Custom `superset://` links alone target your local OS, not the cloud desktop.
The upstream callback validates its pending OAuth state. Never share its URL.

Localhost preview links also need Cube's localhost forwarding to reach servers
on the cloud computer. Embedded website panes open their target in an external
browser tab in this port. They do not embed an Electron browser view in the
browser interface.

The optional native ringtone picker, native download controls and native zoom
controls have not been ported or tested in the browser interface.

The private keyring stays in `bridge/data/keyrings`. Fresh browser installations
create a random keyring password at `bridge/keyring-password` with mode 0600;
back up both along with the profile. Existing keyrings are never replaced. For
an existing keyring without this managed password file, set
`CUBE_SUPERSET_KEYRING_PASSWORD_FILE` to a private file containing its existing
password. The launcher cannot show a native unlock prompt in the browser.

To build a release overlay after compiling `apps/desktop/dist`:

```sh
node cube/package.mjs cube/out/superset-browser.tar.gz
```

This bundles the lockfile's ASAR extractor and its licenses, strips source maps and normalizes
archive timestamps and ownership. Identical built inputs and source metadata
produce identical archives. Upload the archive as a fork release asset, then
set `overlay.url` and `overlay.sha256` in `runtime.json`. Packaging uses Bun and
Python 3; installation uses only the prebuilt archive and Node. Production
builds must use the intended public Superset endpoints, not local development
environment files. Archive metadata records the last commit affecting the
application, packages or dependency lockfile, so the subsequent packaging/pin
commit does not change the recorded source revision.

For an isolated development install before uploading an asset:

```sh
CUBE_SUPERSET_OVERLAY_FILE=/absolute/path/superset-browser.tar.gz \
CUBE_SUPERSET_OVERLAY_SHA256=<archive-sha256> sh cube/install.sh
PORT=45951 CUBE_SUPERSET_DATA_DIR=/absolute/path/disposable-data \
CUBE_SUPERSET_RUNTIME_DIR="$HOME/.cache/cube-superset/browser-<archive-sha256>" \
node cube/start.mjs
```

The runtime override selects an already verified installation; it does not
change the manifest pin. Keep all application data outside this checkout.
SIGTERM, SIGINT and SIGHUP stop only launcher-owned processes. Saved state is
retained. App shutdown can end terminals created by that backend; browser
refresh/reconnect is handled by the application without restarting the backend.

Validation: `sh -n cube/install.sh`, `node --check cube/start.mjs`, and
`node --test cube/*.test.mjs`. Launcher tests exercise real HTTP startup,
restart persistence, paths with spaces, occupied ports, repeated shutdown
signals, reparented helpers and isolation from unrelated processes. Installation
also runs `native-smoke.cjs` inside Electron to verify SQLite, a real PTY shell
and filesystem watch events in a temporary directory. Authenticated workspaces and
agent requests still require the user's normal Superset account setup.

Cloud validation on Debian 12 confirmed the actual sign-in DOM, headless HTTP
startup with no X server, the native smoke checks, and stop/start with byte-for-
byte preservation of the encrypted keyring. All eight launcher/package tests
passed on Linux and macOS. The stop check confirmed the backend, its terminal
host, D-Bus and keyring exited while unrelated live app processes stayed alive.
These checks do not establish authenticated workspace or model-provider flows.
