# Session Progress

## Plan
- [x] 14.5차: UX Patterns 레이어 (⌘K, Status Bar, KPI Strip, Toast, Keyboard Shortcuts)
- [x] 14.5차: Agent Library 카드 강화 (category 그룹핑 + skill 칩)
- [x] 15차 WIP: Next.js + shadcn 대시보드 마이그레이션 (스캐폴드 + 5개 탭 + 다이얼로그 + Command Palette)
- [x] 15차: Next.js 정적 export + Python 서버 통합 (USE_NEXT 분기, install.sh 복사)
- [x] `claude -company` 통합 런처 (zsh wrapper + vc-launch.sh)
- [x] GitHub 공개: E0min/make-company (영문+한글 README, MIT, banner SVG, CI 4잡, v0.1.0 release, topics 10개)
- [x] npm 패키지화 (package.json + bin/cli.js + .npmignore) — publish-ready 상태
- [x] tmux 시스템 클립보드 통합 (~/.tmux.conf, pbcopy 자동 파이프)
- [ ] **npm publish (보류)** — 사용자가 명시 요청 시까지 시도 X. 2FA OTP 단계에서 멈춤. memory에 기록됨.
- [ ] 회귀 테스트 — 새 Next.js 대시보드를 실제 가동 회사 데이터로 검증
- [ ] DAG 시각화 — Workflows 탭 노드 리스트를 그래프로
- [ ] 워크플로 builder clone-from-template 기능
- [ ] dev 워크플로 문서화

## Current Status
Last updated: 2026-04-09
Working on: (paused)
Next: 사용자가 다음 단계 지시하면 회귀 테스트부터 시작 추천

## Failed Attempts
- npm publish (1차): 403 — 2FA OTP 필요. 사용자가 OTP 입력 단계에서 publish 보류 결정.
- gh auth login (1차): 사용자가 inspirelab777로 재로그인되어 E0min 추가 안 됨. 2차에서 성공.
- create-next-app with npm: npm cache permission error. pnpm으로 우회 성공.
- shadcn init non-interactive: stdin 전달 실패. `--defaults` 플래그로 우회 성공.

## Completed Work
- 2026-04-08: 14.5차 UX Patterns 레이어 (commit `a95eff9`)
- 2026-04-08: Agent Library 카드 강화 (commit `1c2f569`)
- 2026-04-08: Next.js 마이그레이션 1차 — 5개 탭 + 다이얼로그 전체 + Command Palette (commit `f60eaff`)
- 2026-04-08: 정적 export + Python 통합, server.py에 USE_NEXT 분기 (commit `dcf24fd`)
- 2026-04-08: vc-launch.sh + zsh wrapper (commit `26d733a`)
- 2026-04-08: README 영문+한글 + MIT LICENSE (commit `bb6d4e8`)
- 2026-04-08: GitHub presence — banner SVG + CI 워크플로 (commit `fd9c230`, push to E0min/make-company)
- 2026-04-08: GitHub release v0.1.0 + topics 10개
- 2026-04-08: npm packaging — package.json, bin/cli.js, .npmignore (commit `e0b2240`)
- 2026-04-09: ~/.tmux.conf 시스템 클립보드 통합 (pbcopy auto-pipe)

## Key Artifacts
- **GitHub:** https://github.com/E0min/make-company
- **Release:** https://github.com/E0min/make-company/releases/tag/v0.1.0
- **CI:** https://github.com/E0min/make-company/actions (그린, 4잡 통과)
- **npm:** publish-ready, 미배포. `npm whoami` = `e0min`. 다음 시도 시 `--otp=<6digit>` 필요.

## Persistent Memory
- `memory/npm_publish_deferred.md` — npm 배포는 사용자 명시 요청 시까지 보류
