#!/bin/sh
set -eu
umask 077
[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo 'Superset for Cube requires Linux x64.' >&2; exit 1; }
version=1.35.0
digest=f94552fe68df301e8d432eb34c576ae8c12eed957f40d18b3d52c38e4c053a05
cache="${XDG_CACHE_HOME:-$HOME/.cache}/cube-superset"
runtime="$cache/$version-linux-x64"
if [ ! -x "$runtime/opt/Superset/superset" ] || [ ! -f "$runtime/.cube-sha256" ] || [ "$(cat "$runtime/.cube-sha256")" != "$digest" ]; then
  mkdir -p "$cache"
  stage=$(mktemp -d "$cache/.install-XXXXXX")
  trap 'rm -rf "$stage"' EXIT HUP INT TERM
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
  rm -rf "$runtime"
  mv "$stage/runtime" "$runtime"
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$script_dir/desktop/install.sh"
echo "Superset $version is installed."
