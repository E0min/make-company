#!/usr/bin/env bash
# Human Veto: 모든 watcher를 일시 정지 (SIGSTOP)

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

_pids=$(pgrep -f "${COMPANY_DIR}/agents/run-(agent|gemini)\.sh" 2>/dev/null)

if [ -z "$_pids" ]; then
  echo "  정지할 watcher 프로세스를 찾을 수 없습니다."
  exit 1
fi

_count=0
for pid in $_pids; do
  if kill -STOP "$pid" 2>/dev/null; then
    _count=$((_count + 1))
  fi
done

# 상태 표시 — 모든 에이전트를 paused로
for sf in "$COMPANY_DIR/state/"*.state; do
  [ -f "$sf" ] || continue
  agent=$(basename "$sf" .state)
  printf 'paused %s' "$(date +%s)" > "${sf}.tmp" && mv "${sf}.tmp" "$sf"
done

echo "  ⏸ Virtual Company 일시 정지 — $_count 프로세스 STOP"
echo "  사용:"
echo "    bash inject.sh <agent> '메시지'  # 특정 에이전트에 지시 주입"
echo "    bash resume.sh                    # 재개"
