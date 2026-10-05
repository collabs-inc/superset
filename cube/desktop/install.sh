#!/bin/sh
set -eu
umask 077
version=1.7.0
digest=32689f18d6abe96bc6530828a6bd0b9ae33bda07c083a6575ed255b5a8f2e903
cache="${XDG_CACHE_HOME:-$HOME/.cache}/cube-desktop"
runtime="$cache/novnc-$version"
mkdir -p "$cache"
# Several desktop apps share the pinned client. Serialize cache replacement.
exec 9>"$cache/.install.lock"
flock -x 9
if [ -f "$runtime/core/rfb.js" ] && [ -f "$runtime/.cube-sha256" ] && [ "$(cat "$runtime/.cube-sha256")" = "$digest" ]; then exit 0; fi
stage=$(mktemp -d "$cache/.novnc-XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl --fail --location --retry 3 --silent --show-error "https://registry.npmjs.org/@novnc/novnc/-/novnc-$version.tgz" --output "$stage/novnc.tgz"
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$stage/novnc.tgz" | cut -d ' ' -f 1); else actual=$(shasum -a 256 "$stage/novnc.tgz" | cut -d ' ' -f 1); fi
[ "$actual" = "$digest" ] || { echo 'noVNC checksum mismatch.' >&2; exit 1; }
tar -xzf "$stage/novnc.tgz" -C "$stage"
printf '%s\n' "$digest" > "$stage/package/.cube-sha256"
rm -rf "$runtime"
mv "$stage/package" "$runtime"
[ -f "$runtime/core/rfb.js" ] || { echo 'noVNC installation is incomplete.' >&2; exit 1; }
