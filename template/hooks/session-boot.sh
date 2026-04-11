#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# session-boot.sh — UserPromptSubmit 하네스 (세션 부팅 시퀀스)
#
# Anthropic 패턴: 세션 시작 시 자동으로 이전 상태를 복원합니다.
#
# 역할:
# 1. /company run 감지 시 세션 부팅 정보 주입
# 2. 이전 세션의 마지막 상태 요약
# 3. 미완료 태스크 알림
# 4. 에이전트 메모리 요약 주입
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

# 현재 프로젝트의 company 디렉토리 찾기 (HOME 우선)
COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

# 프롬프트 추출
PROMPT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('prompt',''))" 2>/dev/null || echo "")

# /company run 감지
if echo "$PROMPT" | grep -qE '/company\s+run'; then
  BOOT_MSG=""

  # 1. 이전 세션 마지막 이벤트 확인
  JSONL_FILE="$COMPANY_DIR/activity.jsonl"
  if [ -f "$JSONL_FILE" ]; then
    LAST_EVENT=$(tail -1 "$JSONL_FILE" 2>/dev/null)
    if [ -n "$LAST_EVENT" ]; then
      LAST_TYPE=$(echo "$LAST_EVENT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('event',''))" 2>/dev/null)
      LAST_TS=$(echo "$LAST_EVENT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ts',''))" 2>/dev/null)
      BOOT_MSG="${BOOT_MSG}[하네스 부팅] 마지막 이벤트: ${LAST_TYPE} (${LAST_TS})\n"
    fi
  fi

  # 2. 최근 회고 action_items 요약
  RETRO_DIR="$COMPANY_DIR/retrospectives"
  if [ -d "$RETRO_DIR" ]; then
    LATEST_RETRO=$(ls -t "$RETRO_DIR"/retro-*.json 2>/dev/null | head -1)
    if [ -n "$LATEST_RETRO" ]; then
      ACTIONS=$(python3 -c "
import json
with open('$LATEST_RETRO') as f:
    r = json.load(f)
items = [fb.get('action_item','') for fb in r.get('feedback',[])]
print(' / '.join(i for i in items if i)[:200])
" 2>/dev/null)
      if [ -n "$ACTIONS" ]; then
        RETRO_ID=$(basename "$LATEST_RETRO" .json)
        BOOT_MSG="${BOOT_MSG}[하네스 부팅] 최근 회고($RETRO_ID) 액션 아이템: ${ACTIONS}\n"
      fi
    fi
  fi

  # 3. 최근 개선 권고 확인
  IMP_DIR="$COMPANY_DIR/improvements"
  if [ -d "$IMP_DIR" ]; then
    LATEST_IMP=$(ls -t "$IMP_DIR"/improve-*.json 2>/dev/null | head -1)
    if [ -n "$LATEST_IMP" ]; then
      IMP_SUMMARY=$(python3 -c "
import json
with open('$LATEST_IMP') as f:
    d = json.load(f)
findings = d.get('findings',[])
if findings:
    print(findings[0].get('description','')[:150])
" 2>/dev/null)
      if [ -n "$IMP_SUMMARY" ]; then
        BOOT_MSG="${BOOT_MSG}[하네스 부팅] 최근 개선 권고: ${IMP_SUMMARY}\n"
      fi
    fi
  fi

  # 4. 에이전트 메모리 통계
  MEM_DIR="$COMPANY_DIR/agent-memory"
  if [ -d "$MEM_DIR" ]; then
    MEM_COUNT=0
    for f in "$MEM_DIR"/*.md; do
      [ -f "$f" ] && [ -s "$f" ] && MEM_COUNT=$((MEM_COUNT + 1))
    done
    if [ "$MEM_COUNT" -gt 0 ]; then
      BOOT_MSG="${BOOT_MSG}[하네스 부팅] 에이전트 메모리: ${MEM_COUNT}개 에이전트에 학습 기록 있음\n"
    fi
  fi

  # 5. 디렉토리 자동 보장 (코드 강제)
  mkdir -p "$COMPANY_DIR/retrospectives" "$COMPANY_DIR/analytics" "$COMPANY_DIR/improvements" 2>/dev/null

  # 6. 세션 시작 JSONL 기록 (코드 강제)
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"event\":\"session_boot\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$COMPANY_DIR/activity.jsonl" 2>/dev/null

  # 부팅 메시지 출력 (Claude에게 주입됨)
  if [ -n "$BOOT_MSG" ]; then
    echo -e "$BOOT_MSG"
  fi
fi

exit 0
