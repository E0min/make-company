# Knowledge Base — 회사 공유 메모리

이 디렉토리는 모든 에이전트가 공유하는 누적 지식 저장소입니다.
각 에이전트가 메시지를 받을 때 자동으로 INDEX.md가 컨텍스트로 주입됩니다.

## 구조

- `decisions/` — 의사결정 로그 (예: `20260407_react_version.md`)
- `conventions/` — 코딩/디자인/네이밍 컨벤션
- `glossary.md` — 프로젝트 용어집
- `INDEX.md` — 자동 생성, 모든 항목 한 줄 요약

## 작성 방법

에이전트가 응답에 다음 마커를 포함하면 자동으로 저장됩니다:

```
[KNOWLEDGE-WRITE decisions/topic.md]
# 제목
의사결정 내용...
```

수동 추가:
```bash
echo "# 제목..." > .claude/company/knowledge/decisions/내용.md
bash .claude/company/scripts/update-knowledge-index.sh
```
