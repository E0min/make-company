#!/usr/bin/env bash
# 스킬 자동 탐색 — Python으로 안전하게 인덱싱

COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$COMPANY_DIR/../.." && pwd)"
OUTPUT="$COMPANY_DIR/skill-index.json"

export OUTPUT PROJECT_DIR
python3 << 'PYEOF'
import json, os, re, glob

output_path = os.environ.get("OUTPUT", "")
project_dir = os.environ.get("PROJECT_DIR", ".")

if not output_path:
    import sys; sys.exit(1)

project_skills = os.path.join(project_dir, ".claude", "skills")
global_skills = os.path.expanduser("~/.claude/skills")

skills = []
seen = set()

# 트리거/사용 키워드 추출 패턴
trigger_re = re.compile(r'(?:Use when|trigger|키워드)[:\s]*["\']?(.+?)["\']?\s*$', re.IGNORECASE | re.MULTILINE)

for source, sdir in [("project", project_skills), ("global", global_skills)]:
    if not os.path.isdir(sdir):
        continue
    for skill_dir in sorted(glob.glob(os.path.join(sdir, "*"))):
        if not os.path.isdir(skill_dir):
            continue
        name = os.path.basename(skill_dir)
        if name in seen:
            continue
        seen.add(name)

        skill_file = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_file):
            continue

        try:
            with open(skill_file, "r") as f:
                content = f.read(3000)  # 첫 3KB만
        except:
            continue

        # frontmatter description
        desc = ""
        lines = content.split("\n")
        in_fm = False
        body_lines = []
        for line in lines:
            if line.strip() == "---":
                if in_fm:
                    in_fm = False
                    continue
                else:
                    in_fm = True
                    continue
            if in_fm:
                if line.strip().startswith("description:"):
                    desc = line.split(":", 1)[1].strip().strip('"').strip("'")
            else:
                if line.strip() and not line.startswith("#"):
                    body_lines.append(line.strip())

        # 본문 첫 2줄을 설명으로
        if not desc and body_lines:
            desc = " ".join(body_lines[:2])[:150]

        # 키워드 추출: trigger 패턴 + 본문 주요 단어
        kw = set()

        # 스킬 이름 자체
        kw.add(name)

        # trigger 키워드
        for m in trigger_re.finditer(content):
            words = re.split(r'[,\s"\']+', m.group(1))
            for w in words:
                w = w.strip().lower()
                if len(w) >= 2 and w not in ("when", "the", "this", "that", "with", "for", "use"):
                    kw.add(w)

        # 설명에서 주요 단어
        stop = {"the","and","or","for","with","use","when","this","that","from","into",
                "your","you","are","has","have","can","will","not","but","all","any",
                "was","were","been","does","its","also","each","run","set","get"}
        for w in re.split(r'[\s,.()\[\]{}:;"\']+', desc):
            w = w.strip().lower()
            if len(w) >= 3 and w not in stop:
                kw.add(w)

        skills.append({
            "name": name,
            "source": source,
            "desc": desc[:120],
            "keywords": sorted(kw)
        })

with open(output_path, "w") as f:
    json.dump(skills, f, ensure_ascii=False, indent=2)

print(f"skill-index 생성: {len(skills)}개 스킬 인덱싱 완료")
PYEOF
