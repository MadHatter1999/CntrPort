#!/usr/bin/env bash
# Broadcast European New Market to your local network (Wi-Fi / LAN).
# Other devices on the SAME network can open the "Network" URL printed below-
# handy for testing the PWA on a real phone.
#
#   Usage:   ./serve-lan.sh             # dev server with hot reload
#            ./serve-lan.sh --preview   # serve the built production app
#
set -euo pipefail
cd "$(dirname "$0")"

PREVIEW=0
[ "${1:-}" = "--preview" ] && PREVIEW=1

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)..."
  npm install
fi

if [ "$PREVIEW" -eq 1 ]; then PORT=4180; else PORT=5180; fi

# Best-effort LAN IPv4 across Linux and macOS.
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${IP:-}" ] && IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "${IP:-}" ] && IP="$(ipconfig getifaddr en1 2>/dev/null || true)"

echo ""
echo "  European New Market"
echo "  Local:   http://localhost:$PORT"
[ -n "${IP:-}" ] && echo "  Network: http://$IP:$PORT   <-- open this on your phone (same Wi-Fi)"
echo ""

if [ "$PREVIEW" -eq 1 ]; then
  npm run build
  npm run preview:lan
else
  npm run dev:lan
fi
