#!/usr/bin/env bash
# Starts the dev server and prints localhost + LAN links (for viewing on a phone).
cd "$(dirname "$0")"
PORT=2137
[ -d node_modules ] || npm install
IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
[ -z "$IP" ] && IP=$(hostname -I 2>/dev/null | awk '{print $1}')
# Serves over https by default: a phone only lets a page use the camera (Pushups mode) over https or on localhost, not over plain http on the Wi-Fi.
# Makes a self-signed certificate once; the phone's browser warns about it the first time: choose "Advanced", then "Proceed".
# HTTPS=0 ./start.sh serves plain http instead.
SCHEME=http
if [ "${HTTPS:-1}" != 0 ]; then
  export HTTPS=1
  if [ ! -f .certs/cert.pem ] || ! grep -q . .certs/ip 2>/dev/null || [ "$(cat .certs/ip)" != "${IP:-none}" ]; then
    mkdir -p .certs
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout .certs/key.pem -out .certs/cert.pem -subj "/CN=scrypture-dev" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1${IP:+,IP:$IP}" 2>/dev/null && echo "${IP:-none}" > .certs/ip
  fi
  if [ -f .certs/key.pem ] && [ -f .certs/cert.pem ]; then SCHEME=https; else unset HTTPS; echo "  (could not make a certificate: is openssl installed? serving plain http)"; fi
fi
echo
echo "  Local:   $SCHEME://localhost:$PORT"
echo "  Network: $SCHEME://${IP:-<your-ip>}:$PORT   <- open this on your phone (same Wi-Fi)"
[ "$SCHEME" = http ] && echo "  (plain http: the camera will not work on a phone; run ./start.sh without HTTPS=0 for https)"
echo
exec npx vite --host 0.0.0.0 --port "$PORT" --strictPort
