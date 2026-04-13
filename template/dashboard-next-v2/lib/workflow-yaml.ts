// Custom YAML parser/serializer for workflow definitions.
// Workflow YAML has a fixed schema, so a full YAML library is unnecessary.

import type { WorkflowDefinition, WorkflowStep } from "./types";

// ━━━ Parser ━━━

/**
 * 워크플로우 YAML 문자열을 WorkflowDefinition으로 파싱한다.
 *
 * 지원하는 구조:
 *   name: <string>
 *   description: <string>
 *   steps:
 *     - id: ...
 *       agent: ...
 *       prompt: |
 *         multi-line block scalar
 *       depends_on: [a, b]
 *       output: ...
 */
export function parseWorkflowYaml(raw: string): WorkflowDefinition {
  const lines = raw.split("\n");

  let name = "";
  let description = "";
  const steps: WorkflowStep[] = [];

  let i = 0;

  // --- 최상위 name / description 추출 ---
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("name:")) {
      name = extractScalar(line, "name:");
      i++;
      continue;
    }

    if (line.startsWith("description:")) {
      description = extractScalar(line, "description:");
      i++;
      continue;
    }

    // steps: 시작
    if (line.trimStart().startsWith("steps:")) {
      i++;
      break;
    }

    i++;
  }

  // --- steps 파싱 ---
  // 각 스텝은 "  - id:" 로 시작 (인덴트 2 + 대시)
  while (i < lines.length) {
    const line = lines[i];

    // 빈 줄 스킵
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 새 스텝 감지: "  - id:" 패턴
    const stepMatch = line.match(/^(\s*)- id:\s*(.+)/);
    if (!stepMatch) {
      i++;
      continue;
    }

    const step: WorkflowStep = {
      id: stepMatch[2].trim(),
      agent: "",
      prompt: "",
      depends_on: [],
      output: "",
    };

    i++;

    // 스텝 내부 필드 파싱 (다음 "  -" 또는 파일 끝까지)
    while (i < lines.length) {
      const cur = lines[i];

      // 빈 줄은 스킵하되, 블록 스칼라 내부가 아니면 계속
      if (cur.trim() === "") {
        i++;
        continue;
      }

      // 다음 스텝 시작이면 break
      if (cur.match(/^\s*- id:/)) break;

      // agent:
      const agentMatch = cur.match(/^\s+agent:\s*(.+)/);
      if (agentMatch) {
        step.agent = agentMatch[1].trim();
        i++;
        continue;
      }

      // prompt: | (블록 스칼라)
      const promptMatch = cur.match(/^\s+prompt:\s*\|?\s*$/);
      if (promptMatch) {
        i++;
        const promptLines: string[] = [];
        // 블록 스칼라: 다음 줄부터 인덴트가 더 깊은 줄들을 수집
        // 첫 번째 콘텐츠 줄의 인덴트를 기준으로 삼음
        let blockIndent = -1;
        while (i < lines.length) {
          const bl = lines[i];
          // 빈 줄은 블록 내부로 포함
          if (bl.trim() === "") {
            promptLines.push("");
            i++;
            continue;
          }
          const leadingSpaces = bl.match(/^(\s*)/)?.[1].length ?? 0;
          // 첫 콘텐츠 줄에서 인덴트 기준 설정
          if (blockIndent === -1) {
            blockIndent = leadingSpaces;
          }
          // 인덴트가 기준보다 작으면 블록 끝
          if (leadingSpaces < blockIndent) break;
          promptLines.push(bl.slice(blockIndent));
          i++;
        }
        // 후행 빈 줄 제거
        while (promptLines.length > 0 && promptLines[promptLines.length - 1].trim() === "") {
          promptLines.pop();
        }
        step.prompt = promptLines.join("\n");
        continue;
      }

      // prompt: 인라인 값 (| 없이 한 줄)
      const promptInline = cur.match(/^\s+prompt:\s*(.+)/);
      if (promptInline) {
        step.prompt = promptInline[1].trim();
        i++;
        continue;
      }

      // depends_on: [a, b]
      const depsMatch = cur.match(/^\s+depends_on:\s*\[([^\]]*)\]/);
      if (depsMatch) {
        step.depends_on = depsMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        i++;
        continue;
      }

      // skills: [a, b]
      const skillsMatch = cur.match(/^\s+skills:\s*\[([^\]]*)\]/);
      if (skillsMatch) {
        step.skills = skillsMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        i++;
        continue;
      }

      // output:
      const outputMatch = cur.match(/^\s+output:\s*(.+)/);
      if (outputMatch) {
        step.output = outputMatch[1].trim();
        i++;
        continue;
      }

      // 인식 불가한 필드 → 스킵
      i++;
    }

    steps.push(step);
  }

  return { name, description, steps };
}

// ━━━ Serializer ━━━

/**
 * WorkflowDefinition을 YAML 문자열로 직렬화한다.
 * prompt는 | 블록 스칼라, depends_on은 [a, b] 플로우 시퀀스.
 */
export function serializeWorkflowYaml(def: WorkflowDefinition): string {
  const lines: string[] = [];

  lines.push(`name: ${def.name}`);
  lines.push(`description: ${def.description}`);
  lines.push("");
  lines.push("steps:");

  for (const step of def.steps) {
    lines.push(`  - id: ${step.id}`);
    lines.push(`    agent: ${step.agent}`);

    // prompt → | 블록 스칼라 (6칸 인덴트)
    lines.push(`    prompt: |`);
    const promptLines = step.prompt.split("\n");
    for (const pl of promptLines) {
      lines.push(`      ${pl}`);
    }

    // depends_on → 플로우 시퀀스 (비어있으면 생략)
    if (step.depends_on.length > 0) {
      lines.push(`    depends_on: [${step.depends_on.join(", ")}]`);
    }

    lines.push(`    output: ${step.output}`);

    // skills → 플로우 시퀀스 (비어있으면 생략)
    if (step.skills && step.skills.length > 0) {
      lines.push(`    skills: [${step.skills.join(", ")}]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ━━━ Helpers ━━━

/** "key: value" 에서 value 추출 */
function extractScalar(line: string, prefix: string): string {
  return line.slice(prefix.length).trim();
}
