#!/usr/bin/env bash
# vc-launch.sh — Virtual Company v2 통합 런처
# 사용: claude -company
#
# 흐름:
#   1. 기존 회사 있으면 → 바로 attach
#   2. 없으면 → 인터랙티브 셋업 (에이전트 선택 → 구조 생성 → tmux 시작)

PROJECT_DIR="$(pwd)"
COMPANY_DIR="$PROJECT_DIR/.claude/company"
CONFIG="$COMPANY_DIR/config.json"
ACTIVITY_LOG="$COMPANY_DIR/activity.log"
OUTPUT_DIR="$COMPANY_DIR/agent-output"
DASHBOARD_SERVER="$COMPANY_DIR/dashboard/server.py"
DASHBOARD_PORT="${VC_DASHBOARD_PORT:-7777}"
GLOBAL_AGENTS_DIR="$HOME/.claude/agents"
GLOBAL_WORKFLOWS_DIR="$HOME/.claude/workflows"

# ━━━ 색상 ━━━
_g='\033[32m' _y='\033[33m' _c='\033[36m' _d='\033[2m' _b='\033[1m' _0='\033[0m'

# ━━━ 에이전트 표시 이름 (tmux 윈도우 이름 호환 — 슬래시/특수문자 없음) ━━━
agent_label() {
  case "$1" in
    ceo)                  echo "CEO" ;;
    product-manager)      echo "PM" ;;
    ui-ux-designer)       echo "Designer" ;;
    frontend-engineer)    echo "Frontend" ;;
    backend-engineer)     echo "Backend" ;;
    fe-qa)                echo "FE-QA" ;;
    be-qa)                echo "BE-QA" ;;
    marketing-strategist) echo "Marketing" ;;
    *)                    echo "$1" ;;
  esac
}

# ━━━ 에이전트 전체 이름 (표시용) ━━━
agent_fullname() {
  case "$1" in
    ceo)                  echo "CEO / Orchestrator" ;;
    product-manager)      echo "Product Manager" ;;
    ui-ux-designer)       echo "UI/UX Designer" ;;
    frontend-engineer)    echo "Frontend Engineer" ;;
    backend-engineer)     echo "Backend Engineer" ;;
    fe-qa)                echo "Frontend QA" ;;
    be-qa)                echo "Backend QA" ;;
    marketing-strategist) echo "Marketing Strategist" ;;
    *)                    echo "$1" ;;
  esac
}

# ━━━ 에이전트 설명 추출 ━━━
agent_desc() {
  local file="$1"
  grep '^description:' "$file" 2>/dev/null | head -1 | sed 's/description: *//'
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 0. 다른 vc- 세션 정리 (하나만 유지)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_cleanup_old_sessions() {
  local keep="$1"
  for sess in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^vc-'); do
    if [ "$sess" != "$keep" ]; then
      tmux kill-session -t "$sess" 2>/dev/null
    fi
  done
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 기존 회사가 있으면 바로 실행
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ -f "$CONFIG" ]; then
  PROJECT_NAME=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('project','company'))" 2>/dev/null || basename "$PROJECT_DIR")
  SESSION="vc-$(echo "$PROJECT_NAME" | tr -cd 'a-zA-Z0-9_-')"

  # 기존 tmux 세션 있으면 attach
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    _cleanup_old_sessions "$SESSION"
    echo -e "${_g}▸${_0} 기존 회사 발견: ${_b}$PROJECT_NAME${_0} — attach"
    if ! tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'claude'; then
      tmux new-window -t "$SESSION:" -n claude -c "$PROJECT_DIR" 2>/dev/null || true
      sleep 0.3
      tmux send-keys -t "$SESSION:0" 'command claude' Enter 2>/dev/null || true
    fi
    tmux select-window -t "$SESSION:claude" 2>/dev/null || true
    if [ -n "$TMUX" ]; then tmux switch-client -t "$SESSION"; else tmux attach -t "$SESSION"; fi
    exit 0
  fi

  # 세션 없으면 다시 시작할지 물어봄
  echo -e "${_g}▸${_0} 기존 회사 발견: ${_b}$PROJECT_NAME${_0}"
  AGENTS=$(python3 -c "
import json
agents = json.load(open('$CONFIG')).get('agents', [])
print(' '.join(a for a in agents if a != 'ceo'))
" 2>/dev/null || echo "")
  echo -e "  에이전트: ${_c}CEO${_0} $(for a in $AGENTS; do echo -n "${_c}$(agent_fullname $a)${_0} "; done)"
  echo ""
  echo -e "  ${_b}1)${_0} 이 구성으로 시작"
  echo -e "  ${_b}2)${_0} 에이전트 다시 선택"
  echo -e "  ${_b}3)${_0} 처음부터 새로 만들기"
  echo -ne "\n  선택 [1]: "
  read -r choice
  choice="${choice:-1}"

  case "$choice" in
    1) ;; # 기존 config 그대로 사용 — 아래 tmux 생성으로 진행
    2)
      # 에이전트만 다시 선택
      rm -f "$CONFIG"
      exec bash "$0" "$@"
      ;;
    3)
      # 전부 리셋
      rm -rf "$COMPANY_DIR" "$PROJECT_DIR/.claude/agents" "$PROJECT_DIR/.claude/workflows"
      exec bash "$0" "$@"
      ;;
    *)
      echo "잘못된 선택"; exit 1 ;;
  esac

else
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # 2. 새 회사 설정 — 인터랙티브 셋업
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  echo ""
  echo -e "  ${_b}🏢 Virtual Company v2${_0}"
  echo -e "  ${_d}프로젝트: $(basename "$PROJECT_DIR")${_0}"
  echo ""

  # 글로벌 에이전트 목록
  if [ ! -d "$GLOBAL_AGENTS_DIR" ] || [ -z "$(ls "$GLOBAL_AGENTS_DIR"/*.md 2>/dev/null)" ]; then
    echo -e "  ${_y}⚠${_0} 글로벌 에이전트가 없습니다."
    echo "    먼저 에이전트를 설치하세요:"
    echo "    cp ~/make-company/template/agents-v2/*.md ~/.claude/agents/"
    exit 1
  fi

  echo -e "  ${_b}사용 가능한 에이전트:${_0}"
  echo ""

  # 번호 매기기
  _idx=0
  _ids=()
  for f in "$GLOBAL_AGENTS_DIR"/*.md; do
    _idx=$((_idx + 1))
    _id=$(basename "$f" .md)
    _ids+=("$_id")
    _label=$(agent_fullname "$_id")
    _desc=$(agent_desc "$f")
    if [ "$_id" = "ceo" ]; then
      echo -e "    ${_d}${_idx}.${_0} ${_g}${_label}${_0} ${_d}(필수)${_0}"
    else
      echo -e "    ${_d}${_idx}.${_0} ${_c}${_label}${_0}"
    fi
    [ -n "$_desc" ] && echo -e "       ${_d}${_desc}${_0}"
  done

  echo ""
  echo -e "  활성화할 에이전트 번호를 선택하세요"
  echo -e "  ${_d}예: 1,2,4,5  또는  all  (CEO는 자동 포함)${_0}"
  echo -ne "\n  선택: "
  read -r selection

  # 선택 파싱
  SELECTED_IDS=("ceo")  # CEO 필수
  if [ "$selection" = "all" ] || [ "$selection" = "ALL" ]; then
    SELECTED_IDS=("${_ids[@]}")
  else
    IFS=',' read -ra nums <<< "$selection"
    for num in "${nums[@]}"; do
      num=$(echo "$num" | tr -d ' ')
      if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -ge 1 ] && [ "$num" -le "${#_ids[@]}" ]; then
        local_id="${_ids[$((num - 1))]}"
        # 중복 체크
        already=false
        for s in "${SELECTED_IDS[@]}"; do
          [ "$s" = "$local_id" ] && already=true
        done
        $already || SELECTED_IDS+=("$local_id")
      fi
    done
  fi

  # 선택 확인
  echo ""
  echo -e "  ${_b}선택된 팀:${_0}"
  for sid in "${SELECTED_IDS[@]}"; do
    echo -e "    ${_g}✓${_0} $(agent_fullname "$sid")"
  done
  echo ""

  # 디렉토리 구조 생성
  mkdir -p "$COMPANY_DIR/agent-memory" "$COMPANY_DIR/agent-output" \
           "$PROJECT_DIR/.claude/agents" "$PROJECT_DIR/.claude/workflows"
  touch "$ACTIVITY_LOG"

  # 선택된 에이전트만 복사
  for sid in "${SELECTED_IDS[@]}"; do
    src="$GLOBAL_AGENTS_DIR/${sid}.md"
    dst="$PROJECT_DIR/.claude/agents/${sid}.md"
    [ -f "$src" ] && cp -n "$src" "$dst" 2>/dev/null
    touch "$OUTPUT_DIR/${sid}.log" 2>/dev/null
    touch "$COMPANY_DIR/agent-memory/${sid}.md" 2>/dev/null
  done

  # 워크플로우 복사
  if [ -d "$GLOBAL_WORKFLOWS_DIR" ]; then
    for f in "$GLOBAL_WORKFLOWS_DIR"/*.yml; do
      [ -f "$f" ] && cp -n "$f" "$PROJECT_DIR/.claude/workflows/" 2>/dev/null
    done
  fi

  # 대시보드 복사 (있으면)
  GLOBAL_DASHBOARD="$HOME/.claude/company/dashboard"
  if [ -d "$GLOBAL_DASHBOARD" ] && [ ! -d "$COMPANY_DIR/dashboard" ]; then
    cp -R "$GLOBAL_DASHBOARD" "$COMPANY_DIR/dashboard" 2>/dev/null || true
  fi

  # config.json 생성
  _AGENTS_JSON=$(printf '%s\n' "${SELECTED_IDS[@]}" | python3 -c "import sys; print(','.join(['\"'+l.strip()+'\"' for l in sys.stdin if l.strip()]))")
  cat > "$CONFIG" << EOJSON
{
  "project": "$(basename "$PROJECT_DIR")",
  "tech_stack": "auto",
  "agents": [$_AGENTS_JSON],
  "language": "ko"
}
EOJSON

  echo -e "  ${_g}✅${_0} 회사 설정 완료 — ${#SELECTED_IDS[@]}명"

  PROJECT_NAME=$(basename "$PROJECT_DIR")
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. tmux 세션 생성 + 실행
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT_NAME="${PROJECT_NAME:-$(python3 -c "import json; print(json.load(open('$CONFIG')).get('project','company'))" 2>/dev/null || basename "$PROJECT_DIR")}"
SESSION="vc-$(echo "$PROJECT_NAME" | tr -cd 'a-zA-Z0-9_-')"

# 에이전트 목록 (CEO 제외 — CEO는 메인 claude가 담당)
AGENTS=$(python3 -c "
import json
agents = json.load(open('$CONFIG')).get('agents', [])
print(' '.join(a for a in agents if a != 'ceo'))
" 2>/dev/null || echo "")

# 출력 파일 초기화
mkdir -p "$OUTPUT_DIR"
for agent in $AGENTS; do
  touch "$OUTPUT_DIR/${agent}.log" 2>/dev/null
done
touch "$ACTIVITY_LOG"

echo ""
echo -e "  ${_g}▸${_0} ${_b}$PROJECT_NAME${_0} 시작"
echo ""

# 기존 vc- 세션 전부 정리 (새로 만들 거니까)
_cleanup_old_sessions ""

# ── tmux 안 vs 밖 분기 ──
INSIDE_TMUX=false
[ -n "$TMUX" ] && INSIDE_TMUX=true

if $INSIDE_TMUX; then
  # ━━━ tmux 안에서 실행: 현재 세션에 윈도우 추가 ━━━
  CURRENT_SESSION=$(tmux display-message -p '#{session_name}')

  # claude 윈도우 (현재 pane에서 바로 실행)
  tmux rename-window -t "$CURRENT_SESSION" "claude" 2>/dev/null || true

  # 1단계: 윈도우 생성
  tmux new-window -d -t "$CURRENT_SESSION:" -n Monitor -c "$PROJECT_DIR" 2>/dev/null
  for agent in $AGENTS; do
    LABEL=$(agent_label "$agent")
    tmux new-window -d -t "$CURRENT_SESSION:" -n "$LABEL" -c "$PROJECT_DIR" 2>/dev/null
  done

  # 2단계: 대기 + 명령 전송
  sleep 1
  MON_IDX=$(tmux list-windows -t "$CURRENT_SESSION" -F '#{window_index} #{window_name}' 2>/dev/null | grep 'Monitor$' | tail -1 | awk '{print $1}')
  [ -n "$MON_IDX" ] && tmux send-keys -t "$CURRENT_SESSION:$MON_IDX" "tail -f '$ACTIVITY_LOG'" Enter
  for agent in $AGENTS; do
    LABEL=$(agent_label "$agent")
    W_IDX=$(tmux list-windows -t "$CURRENT_SESSION" -F '#{window_index} #{window_name}' 2>/dev/null | grep "${LABEL}$" | tail -1 | awk '{print $1}')
    [ -n "$W_IDX" ] && tmux send-keys -t "$CURRENT_SESSION:$W_IDX" "command claude --agent $agent" Enter
  done

  # claude 윈도우로 돌아감
  tmux select-window -t "$CURRENT_SESSION:claude" 2>/dev/null || true

  SESSION_FOR_LIST="$CURRENT_SESSION"

else
  # ━━━ tmux 밖에서 실행: 새 세션 생성 ━━━

  # 1단계: 모든 윈도우를 먼저 생성 (빈 쉘)
  tmux new-session -d -s "$SESSION" -n claude -c "$PROJECT_DIR" -x 200 -y 55
  tmux new-window -d -t "$SESSION:" -n Monitor -c "$PROJECT_DIR" 2>/dev/null
  idx=1
  for agent in $AGENTS; do
    idx=$((idx + 1))
    LABEL=$(agent_label "$agent")
    tmux new-window -d -t "$SESSION:" -n "$LABEL" -c "$PROJECT_DIR" 2>/dev/null
  done

  # 2단계: 쉘 초기화 대기
  sleep 1

  # 3단계: 각 윈도우에 명령 전송 (인덱스 기반)
  # 윈도우 0: 메인 claude (CEO 모드 — /company run 사용)
  tmux send-keys -t "$SESSION:0" 'command claude' Enter
  # 윈도우 1: activity.log 모니터
  tmux send-keys -t "$SESSION:1" "tail -f '$ACTIVITY_LOG'" Enter
  # 윈도우 2~N: 각 에이전트 독립 claude 세션
  idx=1
  for agent in $AGENTS; do
    idx=$((idx + 1))
    tmux send-keys -t "$SESSION:$idx" "command claude --agent $agent" Enter
  done

  SESSION_FOR_LIST="$SESSION"
fi

# ── 윈도우 목록 ──
echo ""
tmux list-windows -t "$SESSION_FOR_LIST" -F "    #I: #W" 2>/dev/null || true
echo ""
echo -e "  ${_d}/company run <태스크>  — 멀티에이전트 실행${_0}"
echo -e "  ${_d}Ctrl+B → 번호        — 윈도우 전환${_0}"
if ! $INSIDE_TMUX; then
  echo -e "  ${_d}Ctrl+B → d           — detach${_0}"
fi
echo ""

# ── attach (tmux 밖에서만) ──
if $INSIDE_TMUX; then
  # 이미 tmux 안 — claude 윈도우에서 직접 실행
  echo -e "  ${_g}✅${_0} 윈도우 추가 완료 — ${_d}Ctrl+B → 번호${_0}로 전환하세요"
  echo ""
  # claude CLI 실행
  exec command claude
else
  tmux select-window -t "$SESSION:0" 2>/dev/null || true
  tmux attach -t "$SESSION"
fi
