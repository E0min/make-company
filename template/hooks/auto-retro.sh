#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# auto-retro.sh — PostToolUse 하네스 (자동 회고 트리거)
#
# 에이전트 작업 패턴을 감지하여 회고를 강제합니다.
# CEO가 회고를 잊어도 하네스가 보장합니다.
#
# 감지 패턴:
# - activity.jsonl에 task_end 이벤트 기록됨
# - 그런데 retro_saved 이벤트가 없음
# - → "회고를 실행하세요" 알림
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

# Bash tool 실행 후에만 체크 (너무 자주 실행 방지)
TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

# Bash 또는 Agent tool 사용 후에만 검사
[ "$TOOL_NAME" != "Bash" ] && [ "$TOOL_NAME" != "Agent" ] && exit 0

# company 디렉토리 찾기 (HOME 우선)
COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

JSONL_FILE="$COMPANY_DIR/activity.jsonl"
[ ! -f "$JSONL_FILE" ] && exit 0

# 이미 이 세션에서 알림했는지 체크
WARNED_FILE="/tmp/vc-retro-warned-$$"
[ -f "$WARNED_FILE" ] && exit 0

# 최근 이벤트 분석: task_end 후 retro_saved가 없으면 알림
python3 -c "
import json, sys

jsonl_path = '$JSONL_FILE'
events = []
with open(jsonl_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except:
            continue

if not events:
    sys.exit(0)

# 마지막 task_end 찾기
last_task_end = None
last_retro = None
for e in reversed(events):
    if e.get('event') == 'task_end' and not last_task_end:
        last_task_end = e
    if e.get('event') == 'retro_saved' and not last_retro:
        last_retro = e

if not last_task_end:
    sys.exit(0)

# task_end 이후에 retro_saved가 없으면 경고
if last_retro:
    if last_retro.get('ts', '') >= last_task_end.get('ts', ''):
        sys.exit(0)  # 회고가 이미 task_end 이후에 저장됨

# 경고 필요
task_id = last_task_end.get('task_id', 'unknown')
print(f'[하네스] 태스크 {task_id} 완료 후 회고가 아직 저장되지 않았습니다. skill.md 섹션 2-6에 따라 회고를 수행하세요.')
" 2>/dev/null

# 경고했으면 표시
RESULT=$?
if [ $RESULT -eq 0 ]; then
  touch "$WARNED_FILE" 2>/dev/null
fi

exit 0
