#!/bin/bash
# Start gemini-openai-proxy with multi-account rotation
# Usage: ./start.sh [--foreground]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.proxy.pid"
LOG_FILE="$SCRIPT_DIR/proxy.log"
PORT="${PORT:-11434}"

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Proxy already running (PID $OLD_PID) on port $PORT"
    echo "Kill with: kill $OLD_PID"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

# Check accounts
ACCOUNTS=$(cd "$SCRIPT_DIR" && npx ts-node bin/gemini-multi-auth.js status 2>&1)
if echo "$ACCOUNTS" | grep -q "No accounts configured"; then
  echo "⚠ No accounts configured."
  echo "Run: npx ts-node bin/gemini-multi-auth.js login <label>"
  echo ""
  echo "Falling back to single-account mode (~/.gemini/)"
fi

if [ "$1" = "--foreground" ]; then
  echo "Starting proxy in foreground on port $PORT..."
  cd "$SCRIPT_DIR"
  exec npx ts-node src/server.ts
else
  echo "Starting proxy on port $PORT..."
  cd "$SCRIPT_DIR"
  nohup npx ts-node src/server.ts > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2

  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "✓ Proxy started (PID $(cat "$PID_FILE"))"
    echo "  URL: http://localhost:$PORT"
    echo "  Log: $LOG_FILE"
    echo "  Stop: kill $(cat "$PID_FILE")"
  else
    echo "✗ Proxy failed to start. Check $LOG_FILE"
    cat "$LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
  fi
fi
