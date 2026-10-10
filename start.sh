#!/usr/bin/env sh
cd "$(dirname "$0")"
( sleep 1; (xdg-open http://localhost:8787 || open http://localhost:8787) >/dev/null 2>&1 ) &
node server.js
