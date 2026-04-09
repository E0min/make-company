// Virtual Company v2 Dashboard — SSE 기반 실시간 모니터
// 기존 디자인 시스템 (Linear-leaning Cyber Refined) 적용

let AGENTS = [];
let AGENTS_FULL = [];
let ACTIVITY = [];
let WORKFLOWS = [];
let SELECTED_WORKFLOW = null;
let SSE = null;
let EDITING_AGENT = null;
let SELECTED_COLOR = '';
let AUTH_TOKEN = '';

const AGENT_COLORS = [
  { name: 'Purple',  hex: '#5e6ad2' },
  { name: 'Blue',    hex: '#4ea7e7' },
  { name: 'Cyan',    hex: '#36b5a0' },
  { name: 'Green',   hex: '#4cb782' },
  { name: 'Yellow',  hex: '#f2c94c' },
  { name: 'Orange',  hex: '#e8853d' },
  { name: 'Red',     hex: '#eb5757' },
  { name: 'Pink',    hex: '#d96fbc' },
  { name: 'Indigo',  hex: '#7c5cfc' },
  { name: 'Slate',   hex: '#6b7280' },
];

// ━━━ Init ━━━
async function init() {
  setupTabs();
  const tokenRes = await fetch('/api/token').then(r => r.json());
  AUTH_TOKEN = tokenRes.token;
  await fetchInitialState();
  connectSSE();
  setInterval(updateClock, 1000);
  updateClock();
}

// ━━━ Tabs ━━━
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ━━━ Initial data fetch ━━━
async function fetchInitialState() {
  try {
    const [stateRes, activityRes, wfRes, runRes] = await Promise.all([
      fetch('/api/state').then(r => r.json()),
      fetch('/api/activity').then(r => r.json()),
      fetch('/api/workflows').then(r => r.json()),
      fetch('/api/running').then(r => r.json()),
    ]);

    WORKFLOWS = wfRes.workflows || [];
    renderWorkflows();
    renderRunStatus(runRes);

    document.getElementById('project-name').textContent = stateRes.project || 'Virtual Company';
    AGENTS = stateRes.agents || [];
    ACTIVITY = activityRes.entries || [];

    renderAgentGrid();
    renderKPIs();
    renderActivityLog();
    renderAgentDetails();
  } catch (e) {
    console.error('Initial fetch failed:', e);
  }
}

// ━━━ SSE 연결 ━━━
let sseConnectedOnce = false;
function connectSSE() {
  SSE = new EventSource('/api/sse');

  SSE.onopen = () => {
    const badge = document.getElementById('connection-badge');
    badge.textContent = '연결됨';
    badge.classList.add('connected');
    document.getElementById('status-dot').classList.add('connected');
    document.getElementById('status-text').textContent = 'SSE 연결됨';
    // BUG-R13: 재연결 시 서버 상태 다시 동기화 (첫 연결은 init()에서 이미 호출)
    if (sseConnectedOnce) {
      fetchInitialState();
    }
    sseConnectedOnce = true;
  };

  SSE.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'activity') {
        handleActivityEvent(msg.data);
      } else if (msg.type === 'agent_output') {
        handleAgentOutput(msg.agent, msg.data);
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  SSE.onerror = () => {
    const badge = document.getElementById('connection-badge');
    badge.textContent = '재연결중...';
    badge.classList.remove('connected');
    document.getElementById('status-dot').classList.remove('connected');
    document.getElementById('status-text').textContent = '연결 끊김 — 재연결 시도중';
  };
}

// ━━━ Activity Event Handler ━━━
function handleActivityEvent(line) {
  // 파싱: [timestamp] [agent] emoji message
  const entry = parseLine(line);
  ACTIVITY.push(entry);
  // BUG-006: 무한 증가 방지 — 1000개 초과 시 앞에서 자름
  if (ACTIVITY.length > 1000) {
    ACTIVITY.splice(0, ACTIVITY.length - 1000);
  }

  // 에이전트 상태 업데이트
  if (entry.agent) {
    const agent = AGENTS.find(a => a.id === entry.agent);
    if (agent) {
      if (line.includes('🟢')) agent.state = 'working';
      else if (line.includes('✅')) agent.state = 'done';
      else if (line.includes('❌')) agent.state = 'error';
      agent.last_message = line;
      agent.timestamp = entry.timestamp;
    }
  }

  renderAgentGrid();
  renderKPIs();
  appendActivityLine(entry);
}

function handleAgentOutput(agentId, data) {
  // Agent detail 패널에 출력 추가
  const el = document.getElementById('output-' + agentId);
  if (el) {
    el.textContent += data + '\n';
    el.scrollTop = el.scrollHeight;
  }

  // 에이전트 상태를 working으로
  const agent = AGENTS.find(a => a.id === agentId);
  if (agent && agent.state !== 'done') {
    agent.state = 'working';
    renderAgentGrid();
  }
}

// ━━━ Parsers ━━━
function parseLine(line) {
  const m = line.match(/\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*(.*)/);
  if (m) {
    return { timestamp: m[1], agent: m[2] || '', message: m[3], raw: line };
  }
  return { timestamp: '', agent: '', message: line, raw: line };
}

// ━━━ Renderers ━━━

// BUG-R05: 첫 렌더 시 구조 생성, 이후 textContent만 업데이트 (깜빡임 방지)
function renderKPIs() {
  const strip = document.getElementById('kpi-strip');
  const working = AGENTS.filter(a => a.state === 'working').length;
  const done = AGENTS.filter(a => a.state === 'done').length;
  const idle = AGENTS.filter(a => a.state === 'idle').length;
  const total = AGENTS.length;

  if (!strip.querySelector('#kpi-total')) {
    // 첫 렌더: KPI 카드 구조 생성 (각 값에 고유 ID 부여)
    strip.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">총 에이전트</div><div class="kpi-value" id="kpi-total">${total}</div></div>
      <div class="kpi-card"><div class="kpi-label">작업중</div><div class="kpi-value" id="kpi-working" style="color:var(--accent)">${working}</div></div>
      <div class="kpi-card"><div class="kpi-label">완료</div><div class="kpi-value" id="kpi-done" style="color:var(--success)">${done}</div></div>
      <div class="kpi-card"><div class="kpi-label">대기</div><div class="kpi-value" id="kpi-idle" style="color:var(--fg-subtle)">${idle}</div></div>
      <div class="kpi-card"><div class="kpi-label">이벤트</div><div class="kpi-value" id="kpi-events">${ACTIVITY.length}</div></div>`;
  } else {
    // 이후: 값만 업데이트 (innerHTML 전체 교체 없이 textContent로 갱신)
    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-working').textContent = working;
    document.getElementById('kpi-done').textContent = done;
    document.getElementById('kpi-idle').textContent = idle;
    document.getElementById('kpi-events').textContent = ACTIVITY.length;
  }
}

// BUG-009: 상태 변경된 에이전트만 업데이트 (깜빡임 방지)
let _prevAgentState = {};
function renderAgentGrid() {
  const grid = document.getElementById('agent-grid');
  const currentIds = new Set(AGENTS.map(a => a.id));

  // 삭제된 에이전트 제거
  grid.querySelectorAll('.agent-tile').forEach(el => {
    if (!currentIds.has(el.dataset.agentId)) el.remove();
  });

  AGENTS.forEach(a => {
    const key = a.id;
    const newHash = `${a.state}|${a.last_message || ''}|${a.timestamp || ''}`;
    let tile = grid.querySelector(`.agent-tile[data-agent-id="${CSS.escape(key)}"]`);

    if (tile && _prevAgentState[key] === newHash) return; // 변경 없음
    _prevAgentState[key] = newHash;

    const html = `
      <div class="agent-tile-header">
        <span class="agent-name">${escapeHtml(formatAgentName(a.id))}</span>
        <span class="agent-state ${a.state}">${stateLabel(a.state)}</span>
      </div>
      <div class="agent-message">${escapeHtml(a.last_message || '대기중')}</div>
      <div class="agent-time">${escapeHtml(a.timestamp || '—')}</div>`;

    if (tile) {
      tile.className = `agent-tile ${a.state}`;
      tile.innerHTML = html;
    } else {
      tile = document.createElement('div');
      tile.className = `agent-tile ${a.state}`;
      tile.dataset.agentId = a.id;
      tile.innerHTML = html;
      grid.appendChild(tile);
    }
  });

  lucide.createIcons({ node: grid });
}

function renderActivityLog() {
  const container = document.getElementById('activity-log');
  // BUG-015: 빈 상태 안내 메시지
  if (ACTIVITY.length === 0) {
    container.innerHTML = '<div class="activity-empty" style="padding:var(--space-8);text-align:center;color:var(--fg-subtle)">아직 활동 기록이 없습니다. 태스크를 실행하면 여기에 표시됩니다.</div>';
    return;
  }
  container.innerHTML = ACTIVITY.map(e => activityLineHtml(e)).join('');
  container.scrollTop = container.scrollHeight;
}

function appendActivityLine(entry) {
  const container = document.getElementById('activity-log');
  const empty = container.querySelector('.activity-empty');
  if (empty) empty.remove();
  container.insertAdjacentHTML('beforeend', activityLineHtml(entry));
  container.scrollTop = container.scrollHeight;
}

function activityLineHtml(e) {
  return `<div class="activity-line">
    <span class="activity-ts">${escapeHtml(e.timestamp)}</span>
    ${e.agent ? `<span class="activity-agent">[${escapeHtml(e.agent)}]</span>` : ''}
    <span class="activity-msg">${escapeHtml(e.message)}</span>
  </div>`;
}

async function renderAgentDetails() {
  // 풀 에이전트 데이터 로드
  try {
    const res = await fetch('/api/agents').then(r => r.json());
    AGENTS_FULL = res.agents || [];
  } catch (e) {}

  const grid = document.getElementById('agent-detail-grid');
  // BUG-001: data-attribute로 ID 전달 (XSS 방지, onclick에 ID 직접 삽입하지 않음)
  grid.innerHTML = AGENTS_FULL.map(a => {
    const state = AGENTS.find(s => s.id === a.id);
    const stateStr = state ? state.state : 'idle';
    const colorDot = a.color ? `<span class="agent-color-dot" style="background:${escapeHtml(a.color)}"></span>` : '';
    return `
    <div class="agent-detail" ${a.color ? `style="border-top:3px solid ${escapeHtml(a.color)}"` : ''}>
      <div class="agent-detail-header">
        <span class="agent-detail-name">${colorDot}${escapeHtml(a.name)}${a.is_global ? ' <span style="color:var(--fg-subtle);font-size:11px">(글로벌)</span>' : ''}</span>
        <div class="agent-detail-actions">
          <span class="agent-state ${stateStr}">${stateLabel(stateStr)}</span>
          <button class="btn-icon" title="편집" data-action="edit" data-agent-id="${escapeHtml(a.id)}"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          ${a.id !== 'ceo' ? `<button class="btn-icon danger" title="삭제" data-action="delete" data-agent-id="${escapeHtml(a.id)}"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>` : ''}
        </div>
      </div>
      <div style="padding: var(--space-2) var(--space-4); font-size:12px; color:var(--fg-subtle)">${escapeHtml(a.description)}</div>
      <div class="agent-detail-output" id="output-${escapeHtml(a.id)}"></div>
    </div>`;
  }).join('');

  lucide.createIcons({ node: grid });

  // BUG-013: forEach + async → Promise.all + map
  await Promise.all(AGENTS_FULL.map(async a => {
    try {
      const res = await fetch(`/api/agent/${a.id}/output`);
      const data = await res.json();
      const el = document.getElementById('output-' + a.id);
      if (el && data.output) {
        el.textContent = data.output;
        el.scrollTop = el.scrollHeight;
      }
    } catch (e) {}
  }));
}

function postHeaders() {
  return { 'Content-Type': 'application/json', 'X-Token': AUTH_TOKEN || '' };
}

// ━━━ Helpers ━━━

function formatAgentName(id) {
  return id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function stateLabel(state) {
  const labels = {
    idle: '<i data-lucide="clock" class="state-icon"></i> 대기',
    working: '<i data-lucide="loader" class="state-icon spin"></i> 작업중',
    done: '<i data-lucide="check-circle" class="state-icon"></i> 완료',
    error: '<i data-lucide="alert-circle" class="state-icon"></i> 에러',
  };
  return labels[state] || state;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('now-time').textContent = `${hh}:${mm}:${ss}`;
}

// ━━━ Run / Workflow Execution ━━━

function renderWorkflows() {
  const container = document.getElementById('workflow-list');
  if (!container) return;
  // BUG-005: lucide.createIcons()는 render 끝에서만 호출
  container.innerHTML = WORKFLOWS.map(w => `
    <div class="workflow-item ${SELECTED_WORKFLOW === w.name ? 'selected' : ''}"
         data-action="select-workflow" data-workflow-name="${escapeHtml(w.name)}">
      <div class="workflow-item-name">${escapeHtml(w.title)}</div>
      <div class="workflow-item-desc">${escapeHtml(w.description)}</div>
    </div>
  `).join('');
}

function selectWorkflow(name) {
  SELECTED_WORKFLOW = (SELECTED_WORKFLOW === name) ? null : name;
  renderWorkflows();
}

function renderRunStatus(data) {
  const container = document.getElementById('run-status');
  if (!container) return;
  if (data.pid) {
    container.innerHTML = `
      <div class="run-status-bar">
        <span>🔄 실행중: <span class="task-name">${escapeHtml(data.task)}</span></span>
        <span class="task-time">${escapeHtml(data.started || '')}</span>
        <button class="btn-stop" data-action="stop">중지</button>
      </div>`;
    // 실행 중이면 입력 비활성화
    setRunButtonsDisabled(true);
  } else {
    container.innerHTML = '';
    setRunButtonsDisabled(false);
  }
}

function setRunButtonsDisabled(disabled) {
  const btns = document.querySelectorAll('#btn-run, #btn-wf');
  btns.forEach(b => b.disabled = disabled);
}

async function runTask() {
  const input = document.getElementById('run-task-input');
  const task = input.value.trim();
  if (!task) { input.focus(); return; }

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ task }),
    }).then(r => r.json());

    if (res.ok) {
      input.value = '';
      renderRunStatus({ pid: res.pid, task, started: new Date().toLocaleTimeString() });
      // Activity 탭으로 전환
      document.querySelector('[data-tab="activity"]').click();
    } else {
      alert(res.error || '실행 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function runWorkflow() {
  if (!SELECTED_WORKFLOW) { alert('워크플로우를 선택하세요'); return; }
  const input = document.getElementById('wf-input');
  const inputText = input.value.trim();

  try {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ name: SELECTED_WORKFLOW, input: inputText }),
    }).then(r => r.json());

    if (res.ok) {
      input.value = '';
      renderRunStatus({ pid: res.pid, task: `${SELECTED_WORKFLOW}: ${inputText}`, started: new Date().toLocaleTimeString() });
      document.querySelector('[data-tab="activity"]').click();
    } else {
      alert(res.error || '실행 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function stopTask() {
  try {
    await fetch('/api/stop', { method: 'POST', headers: postHeaders() });
    renderRunStatus({});
  } catch (e) {}
}

// Enter 키로 실행
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'run-task-input') runTask();
  if (e.key === 'Enter' && e.target.id === 'wf-input') runWorkflow();
});

// 실행 상태 주기적 확인
setInterval(async () => {
  try {
    const res = await fetch('/api/running').then(r => r.json());
    renderRunStatus(res);
  } catch (e) {}
}, 3000);

// ━━━ Agent Editor ━━━

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  EDITING_AGENT = null;
}

function renderColorPicker(selected) {
  const picker = document.getElementById('color-picker');
  if (!picker) return;
  SELECTED_COLOR = selected || '';
  picker.innerHTML = AGENT_COLORS.map(c => `
    <div class="color-swatch ${SELECTED_COLOR === c.hex ? 'selected' : ''}"
         style="background:${c.hex}"
         title="${c.name}"
         data-action="select-color" data-color="${escapeHtml(c.hex)}"></div>
  `).join('') + `
    <div class="color-swatch ${!SELECTED_COLOR ? 'selected' : ''}"
         style="background:var(--bg-overlay);border:1px dashed var(--border-strong)"
         title="없음"
         data-action="select-color" data-color=""></div>`;
}

function selectColor(hex) {
  SELECTED_COLOR = hex;
  renderColorPicker(hex);
}

function openCreateModal() {
  EDITING_AGENT = null;
  document.getElementById('modal-editor-title').textContent = '새 에이전트 생성';
  document.getElementById('editor-agent-id').value = '';
  document.getElementById('editor-agent-id').disabled = false;
  document.getElementById('editor-agent-content').value = '';
  document.getElementById('editor-scope').value = 'both';
  document.getElementById('ai-gen-bar').style.display = 'flex';
  document.getElementById('ai-role-input').value = '';
  renderColorPicker('');
  document.getElementById('modal-agent-editor').classList.add('open');
  document.getElementById('ai-role-input').focus();
}

async function editAgent(agentId) {
  EDITING_AGENT = agentId;
  document.getElementById('modal-editor-title').textContent = `에이전트 편집: ${agentId}`;
  document.getElementById('editor-agent-id').value = agentId;
  document.getElementById('editor-agent-id').disabled = true;
  document.getElementById('ai-gen-bar').style.display = 'flex';

  try {
    const res = await fetch(`/api/agent/${agentId}/content`).then(r => r.json());
    document.getElementById('editor-agent-content').value = res.content || '';
    // scope: 글로벌에도 있으면 both
    document.getElementById('editor-scope').value = res.is_global ? 'both' : 'local';
    renderColorPicker(res.color || '');
  } catch (e) {
    document.getElementById('editor-agent-content').value = '// 로드 실패';
    renderColorPicker('');
  }

  document.getElementById('modal-agent-editor').classList.add('open');
  document.getElementById('editor-agent-content').focus();
}

async function generateWithAI() {
  const roleInput = document.getElementById('ai-role-input');
  const role = roleInput.value.trim();
  if (!role) { roleInput.focus(); return; }

  const btn = document.getElementById('btn-ai-gen');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<i data-lucide="loader" class="btn-lucide spin"></i> 생성중...';

  // ID 자동생성
  const idInput = document.getElementById('editor-agent-id');
  if (!idInput.value.trim()) {
    idInput.value = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/^-|-$/g, '');
  }

  try {
    const res = await fetch('/api/agents/generate', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ role, id: idInput.value }),
    }).then(r => r.json());

    if (res.ok) {
      document.getElementById('editor-agent-content').value = res.content;
      if (res.id) idInput.value = res.id;
    } else {
      alert(res.error || 'AI 생성 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = '<i data-lucide="sparkles" class="btn-lucide"></i> AI 생성';
    lucide.createIcons();
  }
}

async function saveAgent() {
  const id = document.getElementById('editor-agent-id').value.trim();
  const content = document.getElementById('editor-agent-content').value;
  const scope = document.getElementById('editor-scope').value;
  const color = SELECTED_COLOR;

  if (!id) { alert('ID를 입력하세요'); return; }
  if (!content.trim()) { alert('내용을 입력하세요'); return; }

  try {
    const res = await fetch('/api/agents/save', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ id, content, scope, color }),
    }).then(r => r.json());

    if (res.ok) {
      closeModal();
      await renderAgentDetails();
      await fetchInitialState();
    } else {
      alert(res.error || '저장 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function deleteAgent(agentId) {
  if (!confirm(`"${agentId}" 에이전트를 삭제하시겠습니까?`)) return;

  try {
    const res = await fetch('/api/agents/delete', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ id: agentId }),
    }).then(r => r.json());

    if (res.ok) {
      await renderAgentDetails();
      await fetchInitialState();
    } else {
      alert(res.error || '삭제 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

async function openImportModal() {
  document.getElementById('modal-import').classList.add('open');
  document.getElementById('import-list').innerHTML = '로딩중...';

  try {
    const res = await fetch('/api/agents/global').then(r => r.json());
    const agents = res.agents || [];
    if (agents.length === 0) {
      document.getElementById('import-list').innerHTML = '<p style="color:var(--fg-subtle)">가져올 에이전트가 없습니다 (모두 추가됨)</p>';
      return;
    }
    document.getElementById('import-list').innerHTML = agents.map(a => `
      <div class="import-item">
        <div class="import-item-info">
          <div class="import-item-name">${escapeHtml(a.name)}</div>
          <div class="import-item-desc">${escapeHtml(a.description)}</div>
        </div>
        <button class="btn-sm" data-action="import" data-agent-id="${escapeHtml(a.id)}">추가</button>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('import-list').innerHTML = '<p style="color:var(--danger)">로드 실패</p>';
  }
}

async function importAgent(agentId) {
  try {
    const res = await fetch('/api/agents/import', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ id: agentId }),
    }).then(r => r.json());

    if (res.ok) {
      closeModal();
      await renderAgentDetails();
      await fetchInitialState();
    } else {
      alert(res.error || '가져오기 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

// Escape 키로 모달 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ━━━ Event Delegation (BUG-001: XSS 방지) ━━━
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const agentId = btn.dataset.agentId;

  if (action === 'edit' && agentId) {
    editAgent(agentId);
  } else if (action === 'delete' && agentId) {
    deleteAgent(agentId);
  } else if (action === 'import' && agentId) {
    importAgent(agentId);
  } else if (action === 'select-workflow') {
    selectWorkflow(btn.dataset.workflowName);
  } else if (action === 'select-color') {
    selectColor(btn.dataset.color || '');
  } else if (action === 'stop') {
    // BUG-R02: inline onclick 대신 event delegation으로 중지 처리
    stopTask();
  }
});

// ━━━ Start ━━━
document.addEventListener('DOMContentLoaded', init);
