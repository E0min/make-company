// Virtual Company Dashboard - Main App
const POLL_INTERVAL = 2000;
let TOKEN = null;
let CURRENT_AGENT_FOR_SKILLS = null;
let CURRENT_WORKFLOW_FILE = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.method && opts.method !== 'GET' && TOKEN) headers['X-Token'] = TOKEN;
  const res = await fetch(path, { ...opts, headers });
  return res.json();
}

async function init() {
  const t = await api('/api/token');
  TOKEN = t.token;
  setupTabs();
  setupModalHandlers();
  poll();
  setInterval(poll, POLL_INTERVAL);
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

async function poll() {
  try {
    const [state, channel, workflows, tasks, knowledge] = await Promise.all([
      api('/api/state'),
      api('/api/channel'),
      api('/api/workflows'),
      api('/api/tasks'),
      api('/api/knowledge'),
    ]);
    renderState(state);
    renderChannel(channel);
    renderWorkflows(workflows);
    renderTasks(tasks);
    renderKnowledge(knowledge);
    renderAgentsTab(state);
  } catch (e) {
    console.error('poll error:', e);
  }
}

// ━━━ Renderers ━━━
function renderState(state) {
  document.getElementById('project-name').textContent = state.project + ' Virtual Company';
  document.getElementById('session-name').textContent = state.session_name;
  document.getElementById('total-tokens').textContent = formatTokens(state.total_tokens);
  document.getElementById('cost-limit').textContent = '/ ' + formatTokens(state.cost_limit);
  document.getElementById('now-time').textContent = new Date(state.now * 1000).toLocaleTimeString('ko-KR');

  const grid = document.getElementById('agents-grid');
  grid.innerHTML = '';
  for (const a of state.agents) {
    const tile = document.createElement('div');
    tile.className = 'agent-tile state-' + a.state;
    const elapsed = a.elapsed > 0 ? formatDuration(a.elapsed) : '';
    const inboxBadge = a.inbox_size > 0 ? '<span class="badge-inbox">📨</span>' : '';
    tile.innerHTML = `
      ${inboxBadge}
      <div class="agent-name">${escape(a.label)}</div>
      <div class="agent-engine">${escape(a.engine)}</div>
      <div class="agent-state">${stateLabel(a.state)}</div>
      <div class="agent-meta">
        <span>${elapsed}</span>
        ${a.tokens > 0 ? `<span>💰 ${formatTokens(a.tokens)}</span>` : ''}
      </div>
    `;
    grid.appendChild(tile);
  }
}

function renderChannel(channel) {
  const lines = channel.lines || [];
  document.getElementById('channel-preview').textContent = lines.slice(-10).join('\n');
  document.getElementById('channel-full').textContent = lines.join('\n');
}

function renderWorkflows(data) {
  const active = data.active || [];
  const templates = data.templates || [];

  // 활성 워크플로
  const activeEl = document.getElementById('workflows-active');
  activeEl.innerHTML = '';
  if (active.length === 0) {
    activeEl.innerHTML = '<p style="color: var(--fg-dim);">활성 워크플로 없음</p>';
  } else {
    for (const wf of active) {
      const card = document.createElement('div');
      card.className = 'workflow-card';
      card.innerHTML = `
        <div class="workflow-card-header">
          <span class="workflow-title">${escape(wf.title || wf.workflow_id)}</span>
          <span class="workflow-status ${wf.status}">${wf.status}</span>
        </div>
        <div class="dag-container" data-wf='${JSON.stringify(wf).replace(/'/g, '&apos;')}'></div>
      `;
      activeEl.appendChild(card);
      // DAG 렌더
      const container = card.querySelector('.dag-container');
      renderDAG(container, wf);
    }
  }

  // 갤러리
  const gallery = document.getElementById('workflows-gallery');
  gallery.innerHTML = '';
  for (const t of templates) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.innerHTML = `
      <h4>${escape(t.title || t.id)}</h4>
      <div class="gallery-id">${escape(t.file)}</div>
      <button class="btn-primary" data-file="${escape(t.file)}">▶ 실행</button>
    `;
    item.querySelector('button').addEventListener('click', () => openRunModal(t.file, t.title));
    gallery.appendChild(item);
  }
}

function renderTasks(data) {
  const list = document.getElementById('tasks-list');
  list.innerHTML = '';
  for (const t of (data.tasks || []).slice(0, 5)) {
    const li = document.createElement('li');
    const status = t.status || 'unknown';
    li.innerHTML = `<span class="task-status ${status}">${status}</span>${escape((t.task || '').substring(0, 50))}`;
    list.appendChild(li);
  }
}

function renderKnowledge(data) {
  document.getElementById('knowledge-content').textContent = data.index || '(knowledge 없음)';
}

function renderAgentsTab(state) {
  const cards = document.getElementById('agents-cards');
  cards.innerHTML = '';
  for (const a of state.agents) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    const skillsHtml = (a.assigned_skills && a.assigned_skills.length > 0)
      ? a.assigned_skills.map(s => `<span>${escape(s)}</span>`).join('')
      : '<em style="color: var(--fg-dim);">스킬 없음</em>';
    const protectedBadge = a.protected ? '<span class="protected-badge">🔒 보호됨</span>' : '';
    card.innerHTML = `
      <div class="agent-card-header">
        <strong>${escape(a.label)}${protectedBadge}</strong>
        <span class="agent-engine">${escape(a.engine)}</span>
      </div>
      <div class="agent-meta">id: ${escape(a.id)} | file: ${escape(a.agent_file)}</div>
      <div class="skills-list">${skillsHtml}</div>
      <div class="agent-actions">
        <button data-action="skills" data-id="${escape(a.id)}">스킬 할당</button>
        ${!a.protected ? `<button class="btn-danger" data-action="delete" data-id="${escape(a.id)}">삭제</button>` : ''}
      </div>
    `;
    cards.querySelectorAll && card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => handleAgentAction(e.target.dataset.action, e.target.dataset.id));
    });
    cards.appendChild(card);
  }
}

// ━━━ Modal Handlers ━━━
function setupModalHandlers() {
  document.getElementById('btn-new-agent').addEventListener('click', openNewAgentModal);
  document.getElementById('btn-cancel-agent').addEventListener('click', () => closeModal('modal-agent'));
  document.getElementById('btn-create-agent').addEventListener('click', createAgent);

  document.getElementById('btn-cancel-skills').addEventListener('click', () => closeModal('modal-skills'));
  document.getElementById('btn-save-skills').addEventListener('click', saveSkills);

  document.getElementById('btn-run-cancel').addEventListener('click', () => closeModal('modal-run-workflow'));
  document.getElementById('btn-run-confirm').addEventListener('click', runWorkflow);

  document.getElementById('btn-pause').addEventListener('click', () => api('/api/pause', { method: 'POST' }));
  document.getElementById('btn-resume').addEventListener('click', () => api('/api/resume', { method: 'POST' }));
}

async function openNewAgentModal() {
  const skills = (await api('/api/skills')).skills || [];
  const container = document.getElementById('agent-skills-checkboxes');
  container.innerHTML = '<h4>할당할 스킬 (선택)</h4>';
  const grid = document.createElement('div');
  grid.className = 'skills-checkboxes';
  for (const s of skills) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${escape(s.name)}"> ${escape(s.name)}`;
    grid.appendChild(lbl);
  }
  container.appendChild(grid);
  document.getElementById('modal-agent').classList.add('show');
}

async function createAgent() {
  const skills = Array.from(
    document.querySelectorAll('#agent-skills-checkboxes input:checked')
  ).map(i => i.value);
  const body = {
    id: document.getElementById('agent-id').value.trim(),
    label: document.getElementById('agent-label').value.trim(),
    engine: document.getElementById('agent-engine').value,
    agent_file: document.getElementById('agent-id').value.trim(),
    description: document.getElementById('agent-description').value.trim(),
    role_body: document.getElementById('agent-role-body').value.trim(),
    skills: skills,
  };
  if (!body.id || !body.label) {
    alert('id와 label은 필수입니다');
    return;
  }
  const res = await api('/api/agents/create', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) {
    closeModal('modal-agent');
    poll();
    alert('에이전트 생성 완료: ' + body.id);
  } else {
    alert('실패: ' + (res.result || 'unknown error'));
  }
}

async function handleAgentAction(action, aid) {
  if (action === 'delete') {
    if (!confirm(`에이전트 ${aid}를 삭제하시겠습니까?`)) return;
    const res = await api(`/api/agents/${aid}/delete`, { method: 'POST', body: '{}' });
    if (res.ok) poll();
    else alert('삭제 실패: ' + res.result);
  } else if (action === 'skills') {
    openSkillsModal(aid);
  }
}

async function openSkillsModal(aid) {
  CURRENT_AGENT_FOR_SKILLS = aid;
  const state = await api('/api/state');
  const agent = state.agents.find(a => a.id === aid);
  const skills = (await api('/api/skills')).skills || [];
  const assigned = new Set(agent.assigned_skills || []);

  document.getElementById('skills-modal-title').textContent = `${agent.label} 스킬 할당`;
  const list = document.getElementById('skills-modal-list');
  list.innerHTML = '';
  for (const s of skills) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${escape(s.name)}" ${assigned.has(s.name) ? 'checked' : ''}> ${escape(s.name)}`;
    list.appendChild(lbl);
  }
  document.getElementById('modal-skills').classList.add('show');
}

async function saveSkills() {
  const skills = Array.from(
    document.querySelectorAll('#skills-modal-list input:checked')
  ).map(i => i.value);
  const res = await api(`/api/agents/${CURRENT_AGENT_FOR_SKILLS}/skills`, {
    method: 'POST', body: JSON.stringify({ skills })
  });
  if (res.ok) {
    closeModal('modal-skills');
    poll();
  } else {
    alert('실패: ' + res.result);
  }
}

function openRunModal(file, title) {
  CURRENT_WORKFLOW_FILE = file;
  document.getElementById('run-modal-title').textContent = `실행: ${title}`;
  document.getElementById('run-user-request').value = '';
  document.getElementById('modal-run-workflow').classList.add('show');
}

async function runWorkflow() {
  const userRequest = document.getElementById('run-user-request').value.trim();
  if (!userRequest) {
    alert('user request 입력 필요');
    return;
  }
  const res = await api(`/api/workflows/${CURRENT_WORKFLOW_FILE}/run`, {
    method: 'POST', body: JSON.stringify({ user_request: userRequest })
  });
  if (res.ok) {
    closeModal('modal-run-workflow');
    poll();
  } else {
    alert('실행 실패: ' + res.result);
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ━━━ Helpers ━━━
function escape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}

function stateLabel(state) {
  const labels = {
    idle: '○ 대기',
    working: '● 작업중',
    done: '✓ 완료',
    error: '✗ 오류',
    timeout: '⏱ 타임아웃',
    dead: '💀 죽음',
    booting: '⏳ 부팅',
    stopped: '■ 종료',
    compacting: '♻ compact',
    'cost-paused': '💰 비용한도',
    'paused': '⏸ 일시정지',
    'permanently-failed': '☠ 영구실패',
    'rate-limited': '⏳ 리밋',
  };
  return labels[state] || state;
}

init();
