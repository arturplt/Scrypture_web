#!/usr/bin/env bash
# Starts the dev server over plain http (the camera in Pushups mode will not work on a phone: use ./start_https.sh for that).
# The port is kept here because stop.sh reads it from this file; the work is done by start_https.sh.
cd "$(dirname "$0")"
PORT=2137
HTTPS=0 exec ./start_https.sh
