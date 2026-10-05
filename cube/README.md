# Superset in Cube

Install `https://github.com/collabs-inc/superset` in Cube. The default `cube-app`
branch adds a manifest around the unmodified upstream Linux desktop 1.35.0.
`install.sh` verifies the published Debian package's SHA-256, extracts it into
`~/.cache/cube-superset`, and installs the pinned noVNC client. It disables the
extracted package's independent auto-updater; Cube owns package updates.

The machine needs Linux x64, Node 22+, and the packages listed in
[`desktop/README.md`](desktop/README.md). `start.mjs` runs a private display and
the native application, then exposes that display on loopback `$PORT` behind
Cube's authenticated app gate. Chromium's sandbox remains enabled.

Profiles and native state persist at
`${XDG_DATA_HOME:-$HOME/.local/share}/cube-superset` (override with
`CUBE_SUPERSET_DATA_DIR`). Some upstream terminal services also use `~/.superset`.
The machine's HOME, existing repositories and Claude/Codex sign-ins are retained.
The upstream application requires its own GitHub or Google sign-in before use.
This integration does not create that account or bypass authentication.

Use the displayed external-link banner to open sign-in in your browser.
Upstream Linux authentication returns to `http://127.0.0.1:51741/auth/callback`;
that cloud port must be forwarded to the same port on your local computer while
signing in. Cube's localhost forwarding can supply this, or run
`ssh -N -L 127.0.0.1:51741:127.0.0.1:51741 <your-cube-ssh-host>`.
Custom `superset://` links alone target your local OS, not the cloud desktop.
The upstream callback validates its pending OAuth state. Never share its URL.

The bridge scales a 1440×900 display to the viewport. Show app restores a
minimized window; Paste transfers text into its clipboard. Audio, native file
transfer, and local OS notifications are not forwarded. A private native
keyring can ask you to create or unlock its password; no password is preset.

Validation: `sh -n cube/install.sh`, `node --check cube/start.mjs`, and
`node --test cube/desktop/*.test.mjs`. Cloud browser QA renders the real upstream
sign-in screen through a sandboxed iframe. Completing account sign-in and a
live model request require user setup and are not claimed by that check.
