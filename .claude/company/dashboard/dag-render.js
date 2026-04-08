// DAG SVG Renderer (vanilla)
function renderDAG(container, wf) {
  const nodes = wf.nodes || [];
  if (nodes.length === 0) {
    container.innerHTML = '<p style="color: var(--fg-subtle); font-size: 12px; padding: 12px;">노드 없음</p>';
    return;
  }

  // 단순 레이아웃: 의존성 깊이 기반 좌→우 배치
  const depths = computeDepths(nodes);
  const maxDepth = Math.max(...Object.values(depths));
  const colWidth = 180;
  const nodeWidth = 140;
  const nodeHeight = 60;
  const rowHeight = 80;
  const padding = 20;

  // 같은 depth의 노드를 세로로 쌓기
  const byDepth = {};
  for (const n of nodes) {
    const d = depths[n.id];
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(n);
  }
  const maxRow = Math.max(...Object.values(byDepth).map(arr => arr.length));

  const svgWidth = (maxDepth + 1) * colWidth + padding * 2;
  const svgHeight = maxRow * rowHeight + padding * 2;

  const positions = {};
  for (const d of Object.keys(byDepth)) {
    const arr = byDepth[d];
    arr.forEach((n, i) => {
      positions[n.id] = {
        x: padding + parseInt(d) * colWidth,
        y: padding + i * rowHeight
      };
    });
  }

  // DESIGN.md tokens
  const colors = {
    pending: '#2e2e36',  // border-strong
    running: '#5e6ad2',  // accent (Linear purple)
    done:    '#4cb782',  // success
    failed:  '#eb5757',  // danger
    waiting: '#f2c94c',  // warning
  };
  const edgeColor = '#2e2e36';
  const nodeBg    = '#0d0d10';
  const fgColor   = '#ededed';
  const fgMuted   = '#9ca3af';

  let svg = `<svg class="dag-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;
  // 마커 정의 (화살표)
  svg += `<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${fgMuted}"/>
    </marker>
  </defs>`;

  // 엣지 (의존성 화살표)
  for (const n of nodes) {
    const to = positions[n.id];
    if (!to) continue;
    for (const dep of (n.depends_on || [])) {
      const from = positions[dep];
      if (!from) continue;
      const x1 = from.x + nodeWidth;
      const y1 = from.y + nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + nodeHeight / 2;
      // 곡선
      const mx = (x1 + x2) / 2;
      svg += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"
              stroke="${fgMuted}" stroke-width="1.25" fill="none" marker-end="url(#arrow)" opacity="0.6"/>`;
    }
  }

  // 노드
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p) continue;
    const color = colors[n.status] || colors.pending;
    const statusIcon = {
      done: '✓', running: '●', failed: '✗', pending: '○', waiting: '◔'
    }[n.status] || '?';
    svg += `<g transform="translate(${p.x}, ${p.y})">
      <rect width="${nodeWidth}" height="${nodeHeight}" rx="8"
            fill="${nodeBg}" stroke="${color}" stroke-width="1"/>
      <rect x="0" y="0" width="3" height="${nodeHeight}" rx="1.5" fill="${color}"/>
      <text x="14" y="24" fill="${fgColor}" font-size="13" font-weight="600" font-family="Geist, system-ui, sans-serif" letter-spacing="-0.005em">
        ${statusIcon}  ${escapeXml(n.id)}
      </text>
      <text x="14" y="44" fill="${fgMuted}" font-size="11" font-family="Geist Mono, ui-monospace, monospace">
        ${escapeXml(n.agent)}
      </text>
    </g>`;
  }
  svg += '</svg>';
  container.innerHTML = svg;
}

function computeDepths(nodes) {
  const depths = {};
  function getDepth(id, visiting = new Set()) {
    if (depths[id] !== undefined) return depths[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) return 0;
    const deps = node.depends_on || [];
    if (deps.length === 0) {
      depths[id] = 0;
    } else {
      depths[id] = Math.max(...deps.map(d => getDepth(d, visiting))) + 1;
    }
    visiting.delete(id);
    return depths[id];
  }
  for (const n of nodes) getDepth(n.id);
  return depths;
}

function escapeXml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}
