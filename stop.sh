#!/usr/bin/env bash
# Stops the dev server started by start.sh (whatever is listening on its port).
cd "$(dirname "$0")"
PORT="$(grep -m1 '^PORT=' start.sh | cut -d= -f2)"; PORT="${PORT:-2137}"

# PIDs that are LISTENING on the port (matched by port, not by command line, so nothing else can be hit by accident)
pids() { ss -ltnp "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u; }

PIDS="$(pids)"
if [ -z "$PIDS" ]; then echo "Nothing is listening on port $PORT."; exit 0; fi

echo "Stopping dev server on port $PORT (pid: $(echo $PIDS | tr '\n' ' '))..."
for p in $PIDS; do kill "$p" 2>/dev/null; done

# give it a moment to exit cleanly, then force it
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(pids)" ] && break; sleep 0.3; done
if [ -n "$(pids)" ]; then
  echo "Still running, forcing it..."
  for p in $(pids); do kill -9 "$p" 2>/dev/null; done
  sleep 0.5
fi

if [ -z "$(pids)" ]; then echo "Stopped. Port $PORT is free."; else echo "Could not free port $PORT." >&2; exit 1; fi
