#!/usr/bin/env bash
# Human Veto: 정지된 watcher 모두 재개 (SIGCONT)

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

_pids=$(pgrep -f "${COMPANY_DIR}/agents/run-(agent|gemini)\.sh" 2>/dev/null)

if [ -z "$_pids" ]; then
  echo "  재개할 watcher 프로세스가 없습니다."
  exit 1
fi

_count=0
for pid in $_pids; do
  if kill -CONT "$pid" 2>/dev/null; then
    _count=$((_count + 1))
  fi
done

# 상태 복구 — paused → idle
for sf in "$COMPANY_DIR/state/"*.state; do
  [ -f "$sf" ] || continue
  state=$(cat "$sf" | awk '{print $1}')
  if [ "$state" = "paused" ]; then
    agent=$(basename "$sf" .state)
    printf 'idle %s' "$(date +%s)" > "${sf}.tmp" && mv "${sf}.tmp" "$sf"
  fi
done

echo "  ▶ Virtual Company 재개 — $_count 프로세스 CONT"
