#!/bin/sh
set -e
if [ "$ROLE" = "worker" ]; then
  exec node build/worker.js
fi
if [ "$ROLE" = "matrix" ]; then
  exec node build/matrix.js
fi
exec node build/index.js
