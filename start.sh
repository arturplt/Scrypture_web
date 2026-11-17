#!/usr/bin/env bash
# Starts the dev server and prints localhost + LAN links (for viewing on a phone).
cd "$(dirname "$0")"
PORT=2137
[ -d node_modules ] || npm install
IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
[ -z "$IP" ] && IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "  Local:   http://localhost:$PORT"
echo "  Network: http://${IP:-<your-ip>}:$PORT   <- open this on your phone (same Wi-Fi)"
echo
exec npx vite --host 0.0.0.0 --port "$PORT" --strictPort
