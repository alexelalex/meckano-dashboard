#!/usr/bin/env bash

PORT=${PORT:-3333}
DASHBOARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PID=$(lsof -ti :$PORT 2>/dev/null || ss -tlpn 2>/dev/null | grep ":$PORT" | awk -F'pid=' '{print $2}' | awk -F',' '{print $1}')

if [ -n "$PID" ]; then
  echo "Meckano Dashboard is already running on port $PORT (PID $PID)."
else
  echo "Starting Meckano Dashboard on http://localhost:$PORT ..."
  setsid nohup node "$DASHBOARD_DIR/server.js" > "$DASHBOARD_DIR/server.log" 2>&1 &
  sleep 1.5
fi

echo "==================================================="
echo "📱 Meckano Attendance Assistant is ready!"
echo "👉 Open in your browser: http://localhost:$PORT"
echo "==================================================="

if command -v termux-open >/dev/null 2>&1; then
  termux-open "http://localhost:$PORT" 2>/dev/null &
fi
