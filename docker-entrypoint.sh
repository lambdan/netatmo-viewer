#!/bin/sh
# Starts as root only to make the data dir writable (bind mounts and old volumes are often
# owned by root), then drops to the unprivileged deno user.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R deno:deno "$DATA_DIR"
  exec setpriv --reuid=deno --regid=deno --init-groups "$@"
fi
exec "$@"
