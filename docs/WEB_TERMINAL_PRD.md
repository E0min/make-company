# 웹 터미널 (xterm.js) PRD

## 아키텍처: HTTP 폴링 (의존성 0 유지)
xterm.js ↔ GET /terminal/{agent}/read (폴링) ↔ Python ↔ tmux capture-pane/pipe-pane

## tmux 제어: capture-pane + pipe-pane + send-keys 하이브리드

## 로드맵
- Phase 1: Start/Stop ✅ 완료
- Phase 2: 읽기 전용 터미널 (pipe-pane + xterm.js)
- Phase 3: 양방향 터미널 (send-keys)
- Phase 3.5: WebSocket 업그레이드 (선택)
