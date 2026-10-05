# Cube Linux desktop bridge

`sh cube/desktop/install.sh` installs the SHA-256-pinned `@novnc/novnc` 1.7.0 npm
archive into `${XDG_CACHE_HOME:-$HOME/.cache}/cube-desktop/novnc-1.7.0`. A `flock`
lock serializes installations. The downloaded package retains its MPL-2.0 license
and third-party notices. The original package is available at
https://registry.npmjs.org/@novnc/novnc/-/novnc-1.7.0.tgz.

The wrapper calls `await runDesktop({name, executable, args, dataDir, env})` from
`desktop/start.mjs`. `executable` and the persistent application root `dataDir`
must be absolute. The wrapper supplies Electron's persistent profile arguments;
the bridge writes its own data below `dataDir/bridge`. `env` overlays the existing
environment; `undefined` removes a variable. HOME, PATH and existing agent sign-ins
are retained. Electron development variables are removed and NODE_ENV is production.
The bridge does not inject `--no-sandbox`.

Host prerequisites (Debian): Node 22+, curl, tar, util-linux, xvfb, openbox,
x11vnc, websockify, dbus-x11, gnome-keyring, gcr, libsecret-1-0, libgtk-3-0,
libnss3, libasound2, libgbm1, libxss1, libatk-bridge2.0-0, libdrm2,
libxkbcommon0, fonts-liberation, xauth, x11-xserver-utils, x11-utils, xdotool. dpkg-deb is needed
by wrappers installing upstream Debian packages. xterm is useful for smoke tests.

The foreground Node server binds only 127.0.0.1:$PORT and accepts loopback/Cube
app hosts. HTTP and WebSocket requests with an Origin must match the exact host
and forwarded scheme. WebSocket Origin is mandatory. Cube supplies authentication
at its outer gate. Internal VNC and WebSocket transports bind loopback; X11 has
a random cookie and TCP disabled. Processes run under the Cube user, so this is
not isolation from other processes owned by that user.

Each session gets private D-Bus and a private Secret Service. Keyring storage
persists in `dataDir/bridge/data`; there is no preset or plaintext password.
If an app stores new secrets, the user may need to create/unlock the keyring in
the displayed native dialog. The app's original XDG directories remain intact
for CLI authentication; only display/keyring services use private XDG roots.

The native display is 1440×900 and scales to the browser pane. Keyboard and
pointer input pass through noVNC. Show app restores a minimized native window via
a same-origin POST and targets only the owned application PID on its private display.
The Paste control transfers browser text to
the remote clipboard; use the native app's paste shortcut afterward. Audio,
native file transfer and OS notifications are not forwarded. Browser links
opened through xdg-open/BROWSER appear in a visible HTTPS/HTTP link banner.
Some OAuth flows require a callback to server-local localhost or a custom URI;
those flows may still require an existing CLI login or explicit callback setup.

SIGHUP, SIGTERM and SIGINT reap only owned processes, including descendants.
TERM-resistant children are killed after 900ms, within Cube ptyd's grace period.
Run `node --test cube/desktop/*.test.mjs` for origin/proxy/link/lifecycle tests.
Cloud smoke also verified a rendered xterm, exact keyboard input, external-link
banner, private Secret Service registration and Node 22 compatibility.
