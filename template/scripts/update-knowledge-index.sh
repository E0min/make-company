#!/usr/bin/env bash
# knowledge/ 디렉토리를 스캔하여 INDEX.md 자동 생성

KNOWLEDGE_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/knowledge}"

if [ ! -d "$KNOWLEDGE_DIR" ]; then
  exit 0
fi

INDEX="$KNOWLEDGE_DIR/INDEX.md"

{
  echo "# Knowledge Index"
  echo ""
  echo "_자동 생성됨 ($(date '+%Y-%m-%d %H:%M:%S'))_"
  echo ""

  # 카테고리별로 정리
  for category in decisions conventions; do
    catdir="$KNOWLEDGE_DIR/$category"
    if [ -d "$catdir" ]; then
      _count=$(find "$catdir" -type f -name "*.md" | wc -l | tr -d ' ')
      if [ "$_count" -gt 0 ] 2>/dev/null; then
        echo "## $category ($_count)"
        echo ""
        for f in "$catdir"/*.md; do
          [ -f "$f" ] || continue
          # 첫 번째 헤딩 또는 첫 줄 추출
          _title=$(head -10 "$f" | grep -m1 '^#' | sed 's/^#* *//' || basename "$f" .md)
          [ -z "$_title" ] && _title=$(basename "$f" .md)
          echo "- **$(basename "$f" .md)**: $_title"
        done
        echo ""
      fi
    fi
  done

  # glossary.md
  if [ -f "$KNOWLEDGE_DIR/glossary.md" ]; then
    _terms=$(grep -c '^- ' "$KNOWLEDGE_DIR/glossary.md" 2>/dev/null || echo 0)
    echo "## glossary"
    echo ""
    echo "- $_terms 개 용어 정의됨"
    echo ""
  fi
} > "$INDEX"

echo "  knowledge index 업데이트: $(wc -l < "$INDEX" | tr -d ' ') 줄"
