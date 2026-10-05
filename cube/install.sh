#!/bin/sh
set -eu
umask 077
[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo 'Superset for Cube requires Linux x64.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for command in node curl tar dpkg-deb sha256sum flock glib-compile-schemas; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing $command. Install the packages documented in cube/README.md." >&2; exit 1; }
done
json_value() { node -e 'const fs=require("node:fs"); let value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for(const key of process.argv[2].split(".")) value=value[key]; console.log(value)' "$script_dir/runtime.json" "$1"; }
version=$(json_value version)
digest=$(json_value runtimeSha256)
overlay_digest=${CUBE_SUPERSET_OVERLAY_SHA256:-$(json_value overlay.sha256)}
overlay_url=$(json_value overlay.url)
printf '%s' "$overlay_digest" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$' || { echo 'Browser release checksum is missing or invalid.' >&2; exit 1; }
cache="${XDG_CACHE_HOME:-$HOME/.cache}/cube-superset"
runtime="$cache/$version-linux-x64"
browser_runtime="$cache/browser-$overlay_digest"
mkdir -p "$cache"
exec 9>"$cache/.browser-install.lock"
flock -x 9
node "$script_dir/system-runtime.mjs" install "$cache"
private_libraries=$(node "$script_dir/system-runtime.mjs" library-path "$cache")
export LD_LIBRARY_PATH="$private_libraries${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ -x "$browser_runtime/opt/Superset/superset" ] && [ -f "$browser_runtime/.cube-sha256" ] && [ "$(cat "$browser_runtime/.cube-sha256")" = "$overlay_digest" ]; then
  echo 'Superset browser runtime is already installed.'
  exit 0
fi
stage=$(mktemp -d "$cache/.browser-install-XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
if [ ! -x "$runtime/opt/Superset/superset" ] || [ ! -f "$runtime/.cube-sha256" ] || [ "$(cat "$runtime/.cube-sha256")" != "$digest" ]; then
  curl --fail --location --retry 3 --silent --show-error \
    "https://github.com/superset-sh/superset/releases/download/desktop-v$version/superset-$version-amd64.deb" \
    --output "$stage/runtime.deb"
  actual=$(sha256sum "$stage/runtime.deb" | cut -d ' ' -f 1)
  [ "$actual" = "$digest" ] || { echo 'Superset archive checksum mismatch.' >&2; exit 1; }
  mkdir "$stage/runtime"
  dpkg-deb --extract "$stage/runtime.deb" "$stage/runtime"
  [ -x "$stage/runtime/opt/Superset/superset" ] || { echo 'Superset executable missing from release package.' >&2; exit 1; }
  rm -f "$stage/runtime/opt/Superset/resources/app-update.yml"
  printf '%s\n' "$digest" > "$stage/runtime/.cube-sha256"
  if [ -e "$runtime" ]; then echo 'Existing upstream runtime failed verification; move it aside before reinstalling.' >&2; exit 1; fi
  mv "$stage/runtime" "$runtime"
fi
if [ -n "${CUBE_SUPERSET_OVERLAY_FILE:-}" ]; then
  cp "$CUBE_SUPERSET_OVERLAY_FILE" "$stage/browser.tar.gz"
else
  [ -n "$overlay_url" ] || { echo 'Browser release URL is missing.' >&2; exit 1; }
  curl --fail --location --retry 3 --silent --show-error "$overlay_url" --output "$stage/browser.tar.gz"
fi
actual=$(sha256sum "$stage/browser.tar.gz" | cut -d ' ' -f 1)
[ "$actual" = "$overlay_digest" ] || { echo 'Superset browser archive checksum mismatch.' >&2; exit 1; }
mkdir "$stage/overlay" "$stage/browser"
tar -xzf "$stage/browser.tar.gz" -C "$stage/overlay"
node -e 'const fs=require("node:fs");const meta=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(meta.version!==process.argv[2]||meta.runtimeSha256!==process.argv[3]) throw Error("Browser archive targets a different upstream runtime")' "$stage/overlay/build.json" "$version" "$digest"
cp -a --reflink=auto "$runtime/." "$stage/browser/"
resources="$stage/browser/opt/Superset/resources"
node "$stage/overlay/extract-runtime.cjs" "$runtime/opt/Superset/resources/app.asar" "$resources/app"
rm -rf "$resources/app.asar" "$resources/app.asar.unpacked" "$resources/app/dist"
rm -f "$resources/app-update.yml"
mv "$stage/overlay/dist" "$resources/app/dist"
for migrations in migrations host-migrations chat-migrations; do
  rm -rf "$resources/resources/$migrations"
  cp -a "$resources/app/dist/resources/$migrations" "$resources/resources/$migrations"
done
cp "$stage/overlay/build.json" "$stage/browser/.cube-build.json"
cp -a "$stage/overlay/licenses" "$stage/browser/cube-licenses"
printf '%s\n' "$overlay_digest" > "$stage/browser/.cube-sha256"
[ -f "$resources/app/dist/main/index.js" ] && [ -f "$resources/app/dist/renderer/index.html" ] || { echo 'Browser archive is incomplete.' >&2; exit 1; }
missing=$(ldd "$stage/browser/opt/Superset/superset" | grep 'not found' || true)
[ -z "$missing" ] || { printf 'Missing system libraries:\n%s\nSee cube/README.md.\n' "$missing" >&2; exit 1; }
ELECTRON_RUN_AS_NODE=1 "$stage/browser/opt/Superset/superset" "$script_dir/native-smoke.cjs" "$resources/app"
[ ! -e "$browser_runtime" ] || { echo 'Existing browser runtime is incomplete; move it aside before reinstalling.' >&2; exit 1; }
mv "$stage/browser" "$browser_runtime"
echo "Superset browser runtime installed at $browser_runtime."
