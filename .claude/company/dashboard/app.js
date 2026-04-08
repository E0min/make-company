// Virtual Company Dashboard — UX Patterns layer applied
// See DESIGN.md §UX Patterns for the spec.

const POLL_INTERVAL = 2000;
let TOKEN = null;
let CURRENT_AGENT_FOR_SKILLS = null;
let CURRENT_WORKFLOW_FILE = null;
let WORKFLOW_TEMPLATES = [];
let BUILDER_NODES = [];
let BUILDER_EDIT_FILE = null;
let CACHED_AGENTS = [];
let CACHED_WORKFLOWS = { active: [], templates: [] };
let CACHED_SKILLS = [];
let CONFIG_ETAG = null;
let LAST_POLL_AT = 0;
let POLL_HEALTHY = true;
let CHANNEL_USER_SCROLLED = false;
let LAST_AGENT_STATES = {};  // for change-detection toasts

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.method && opts.method !== 'GET' && TOKEN) {
    headers['X-Token'] = TOKEN;
    if (CONFIG_ETAG) headers['X-If-Match'] = CONFIG_ETAG;
  }
  const res = await fetch(path, { ...opts, headers });
  const newEtag = res.headers.get('ETag');
  if (newEtag) CONFIG_ETAG = newEtag;
  if (res.status === 409) {
    const data = await res.json();
    toast('danger', '충돌', data.result || '다른 곳에서 수정됨');
    poll();
    return { ok: false, conflict: true, result: data.result };
  }
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Init
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function init() {
  const t = await api('/api/token');
  TOKEN = t.token;
  setupTabs();
  setupModalHandlers();
  setupKeyboardShortcuts();
  setupCommandPalette();
  setupStatusBar();
  setupChannelScroll();
  poll();
  setInterval(poll, POLL_INTERVAL);
  setInterval(updateStatusBarTick, 1000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Polling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function poll() {
  try {
    const [state, channel, workflows, tasks, knowledge, skillsRes] = await Promise.all([
      api('/api/state'),
      api('/api/channel'),
      api('/api/workflows'),
      api('/api/tasks'),
      api('/api/knowledge'),
      CACHED_SKILLS.length === 0 ? api('/api/skills') : Promise.resolve({ skills: CACHED_SKILLS }),
    ]);
    if (skillsRes.skills) CACHED_SKILLS = skillsRes.skills;
    LAST_POLL_AT = Date.now();
    POLL_HEALTHY = true;
    detectAgentChanges(state.agents);
    renderState(state);
    renderKPIs(state, workflows);
    renderChannel(channel);
    renderWorkflows(workflows);
    renderTasks(tasks);
    renderKnowledge(knowledge);
    renderAgentsTab(state);
    updateStatusBarHealth();
  } catch (e) {
    console.error('poll error:', e);
    POLL_HEALTHY = false;
    updateStatusBarHealth();
  }
}

function detectAgentChanges(agents) {
  for (const a of agents) {
    const prev = LAST_AGENT_STATES[a.id];
    if (prev && prev !== a.state) {
      if (a.state === 'error' || a.state === 'permanently-failed' || a.state === 'dead') {
        toast('danger', `${a.label} 오류`, `상태: ${a.state}`);
      } else if (a.state === 'done' && prev === 'working') {
        toast('success', `${a.label} 완료`, '작업 종료됨');
      } else if (a.state === 'rate-limited' || a.state === 'cost-paused') {
        toast('warning', `${a.label}`, a.state);
      }
    }
    LAST_AGENT_STATES[a.id] = a.state;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Renderers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderState(state) {
  CACHED_AGENTS = state.agents;
  document.getElementById('project-name').textContent = (state.project || 'Virtual') + ' Company';
  document.getElementById('session-name').textContent = state.session_name || '';
  document.getElementById('total-tokens').textContent = formatTokens(state.total_tokens);
  document.getElementById('cost-limit').textContent = '/ ' + formatTokens(state.cost_limit);
  document.getElementById('now-time').textContent = new Date(state.now * 1000).toLocaleTimeString('ko-KR');

  // header cost bar
  const pct = state.cost_limit > 0 ? Math.min(100, (state.total_tokens / state.cost_limit) * 100) : 0;
  const bar = document.getElementById('cost-bar-fill');
  bar.style.width = pct + '%';
  bar.classList.toggle('warn', pct >= 80 && pct < 95);
  bar.classList.toggle('danger', pct >= 95);

  // grid
  const grid = document.getElementById('agents-grid');
  grid.innerHTML = '';
  if (!state.agents || state.agents.length === 0) {
    grid.innerHTML = emptyState('No agents yet', 'Agents will appear once the company starts.');
    return;
  }
  // working first, then idle, then errored last
  const sorted = [...state.agents].sort((a, b) => stateRank(a.state) - stateRank(b.state));
  for (const a of sorted) {
    const tile = document.createElement('div');
    tile.className = 'agent-tile state-' + a.state;
    const elapsed = a.elapsed > 0 ? formatDuration(a.elapsed) : '';
    const inboxBadge = a.inbox_size > 0 ? `<span class="badge-inbox">${a.inbox_size}</span>` : '';
    tile.innerHTML = `
      ${inboxBadge}
      <div class="agent-name">${escape(a.label)}</div>
      <div class="agent-engine">${escape(a.engine)}</div>
      <div class="agent-state">${stateLabel(a.state)}</div>
      <div class="agent-meta">
        ${elapsed ? `<span>${elapsed}</span>` : ''}
        ${a.tokens > 0 ? `<span>${formatTokens(a.tokens)} tok</span>` : ''}
      </div>
    `;
    grid.appendChild(tile);
  }
}

function stateRank(s) {
  return ({ working: 0, compacting: 1, booting: 2, idle: 3, done: 4,
            paused: 5, 'cost-paused': 5, 'rate-limited': 5,
            error: 6, 'permanently-failed': 6, dead: 6, stopped: 7 })[s] ?? 9;
}

function renderKPIs(state, workflows) {
  const agents = state.agents || [];
  const working = agents.filter(a => a.state === 'working').length;
  const active = agents.length;
  const wfActive = (workflows.active || []).length;

  document.getElementById('kpi-active').textContent = active;
  document.getElementById('kpi-working').textContent = working;
  document.getElementById('kpi-tokens').textContent = formatTokens(state.total_tokens);
  document.getElementById('kpi-workflows').textContent = wfActive;

  const pct = state.cost_limit > 0 ? Math.min(100, (state.total_tokens / state.cost_limit) * 100) : 0;
  const bar = document.getElementById('kpi-tokens-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('warn', pct >= 80 && pct < 95);
  bar.classList.toggle('danger', pct >= 95);

  // tab badges
  setBadge('badge-workflows', wfActive);
  setBadge('badge-agents', active);
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.classList.add('has-count');
  } else {
    el.classList.remove('has-count');
  }
}

function renderChannel(channel) {
  const lines = channel.lines || [];
  const previewEl = document.getElementById('channel-preview');
  const fullEl = document.getElementById('channel-full');
  previewEl.innerHTML = renderMessages(lines.slice(-10));
  fullEl.innerHTML = renderMessages(lines);
  if (!CHANNEL_USER_SCROLLED) {
    fullEl.scrollTop = fullEl.scrollHeight;
  }
}

function renderMessages(lines) {
  if (!lines || lines.length === 0) {
    return '<div class="empty-state"><div class="empty-title">메시지 없음</div></div>';
  }
  const out = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    // [from→to] body  or  [from->to] body  or  from: body
    let m = line.match(/^\[([^\]→>-]+)[→\->]+([^\]]+)\]\s*(.*)$/);
    if (m) {
      out.push(`<div class="msg-row"><span class="msg-from">${escape(m[1].trim())}</span><span class="msg-arrow">→</span><span class="msg-to">${escape(m[2].trim())}</span><span class="msg-body">${escape(m[3])}</span></div>`);
      continue;
    }
    m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) {
      out.push(`<div class="msg-row"><span class="msg-from">${escape(m[1])}</span><span class="msg-arrow">·</span><span class="msg-body">${escape(m[2])}</span></div>`);
      continue;
    }
    out.push(`<div class="msg-row system"><span class="msg-body">${escape(line)}</span></div>`);
  }
  return out.join('');
}

function setupChannelScroll() {
  const fullEl = document.getElementById('channel-full');
  fullEl.addEventListener('scroll', () => {
    const atBottom = fullEl.scrollHeight - fullEl.scrollTop - fullEl.clientHeight < 20;
    CHANNEL_USER_SCROLLED = !atBottom;
  });
}

function renderWorkflows(data) {
  CACHED_WORKFLOWS = data;
  const active = data.active || [];
  const templates = data.templates || [];
  WORKFLOW_TEMPLATES = templates;

  const activeEl = document.getElementById('workflows-active');
  activeEl.innerHTML = '';
  if (active.length === 0) {
    activeEl.innerHTML = emptyState('No active workflows', 'Run a template from the gallery below.');
  } else {
    for (const wf of active) {
      const card = document.createElement('div');
      card.className = 'workflow-card';
      card.innerHTML = `
        <div class="workflow-card-header">
          <span class="workflow-title">${escape(wf.title || wf.workflow_id)}</span>
          <span class="workflow-status ${wf.status}">${wf.status}</span>
        </div>
        <div class="dag-container"></div>
      `;
      activeEl.appendChild(card);
      renderDAG(card.querySelector('.dag-container'), wf);
    }
  }

  const gallery = document.getElementById('workflows-gallery');
  gallery.innerHTML = '';
  if (templates.length === 0) {
    gallery.innerHTML = emptyState('No templates yet',
      'Click "+ New Workflow" to create your first template.',
      'btn-new-workflow');
  } else {
    for (const t of templates) {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.innerHTML = `
        <h4>${escape(t.title || t.id)}</h4>
        <div class="gallery-id">${escape(t.file)}</div>
        <div class="gallery-item-actions">
          <button class="btn-primary" data-act="run">Run</button>
          <button data-act="edit">Edit</button>
          <button class="btn-danger" data-act="delete">Delete</button>
        </div>
      `;
      item.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => handleWorkflowAction(btn.dataset.act, t.file, t.title));
      });
      gallery.appendChild(item);
    }
  }
}

async function handleWorkflowAction(action, file, title) {
  if (action === 'run') openRunModal(file, title);
  else if (action === 'edit') openBuilderModal(file);
  else if (action === 'delete') {
    const ok = await confirmModal(`워크플로 삭제`, `${file}을(를) 영구 삭제합니다. 되돌릴 수 없습니다.`);
    if (!ok) return;
    const res = await api(`/api/workflows/${file}/delete`, { method: 'POST', body: '{}' });
    if (res.ok) { toast('success', '삭제 완료', file); poll(); }
    else if (!res.conflict) toast('danger', '삭제 실패', res.result);
  }
}

function renderTasks(data) {
  const list = document.getElementById('tasks-list');
  list.innerHTML = '';
  const tasks = (data.tasks || []).slice(0, 5);
  if (tasks.length === 0) {
    list.innerHTML = '<li><span class="task-status">empty</span>최근 태스크 없음</li>';
    return;
  }
  for (const t of tasks) {
    const li = document.createElement('li');
    const status = t.status || 'unknown';
    li.innerHTML = `<span class="task-status ${status}">${status}</span>${escape((t.task || '').substring(0, 60))}`;
    list.appendChild(li);
  }
}

function renderKnowledge(data) {
  const el = document.getElementById('knowledge-content');
  const text = data.index || '';
  if (!text.trim()) {
    el.innerHTML = emptyState('Knowledge base empty', 'Agents will populate this as they learn.');
    return;
  }
  el.innerHTML = renderMiniMarkdown(text);
}

function renderMiniMarkdown(src) {
  // h2/h3, code, list, paragraphs only
  const lines = src.split('\n');
  const out = [];
  let inList = false;
  for (let line of lines) {
    if (/^##\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${escape(line.replace(/^##\s+/, ''))}</h2>`);
    } else if (/^###\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${escape(line.replace(/^###\s+/, ''))}</h3>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function inlineMd(s) {
  return escape(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderAgentsTab(state) {
  const cards = document.getElementById('agents-cards');
  cards.innerHTML = '';
  if (!state.agents || state.agents.length === 0) {
    cards.innerHTML = emptyState('No agents', 'Add an agent from the library or create a custom one.', 'btn-new-agent');
    return;
  }
  for (const a of state.agents) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    const skillsHtml = (a.assigned_skills && a.assigned_skills.length > 0)
      ? a.assigned_skills.map(s => `<span>${escape(s)}</span>`).join('')
      : '<em style="color: var(--fg-subtle); font-size: 11px;">no skills assigned</em>';
    const protectedBadge = a.protected ? '<span class="protected-badge">protected</span>' : '';
    card.innerHTML = `
      <div class="agent-card-header">
        <strong>${escape(a.label)}${protectedBadge}</strong>
        <span class="agent-engine">${escape(a.engine)}</span>
      </div>
      <div class="agent-meta">id: ${escape(a.id)} · file: ${escape(a.agent_file)}</div>
      <div class="skills-list">${skillsHtml}</div>
      <div class="agent-actions">
        <button data-action="skills" data-id="${escape(a.id)}">Skills</button>
        ${!a.protected ? `<button class="btn-danger" data-action="delete" data-id="${escape(a.id)}">Delete</button>` : ''}
      </div>
    `;
    card.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => handleAgentAction(e.target.dataset.action, e.target.dataset.id));
    });
    cards.appendChild(card);
  }
}

function emptyState(title, body, actionId) {
  const action = actionId
    ? `<button class="btn-primary" onclick="document.getElementById('${actionId}').click()">Get started</button>`
    : '';
  return `
    <div class="empty-state">
      <div class="empty-icon">∅</div>
      <div class="empty-title">${escape(title)}</div>
      <div style="font-size:11px; color:var(--fg-subtle); margin-bottom:8px;">${escape(body)}</div>
      ${action}
    </div>
  `;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Modal hygiene
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  // KPI card jumps
  document.querySelectorAll('.kpi-card[data-jump]').forEach(card => {
    card.addEventListener('click', () => switchTab(card.dataset.jump));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

function setupModalHandlers() {
  document.getElementById('btn-new-agent').addEventListener('click', openNewAgentModal);
  document.getElementById('btn-create-agent').addEventListener('click', createAgent);
  document.getElementById('btn-save-skills').addEventListener('click', saveSkills);
  document.getElementById('btn-run-confirm').addEventListener('click', runWorkflow);
  document.getElementById('btn-pause').addEventListener('click', async () => {
    await api('/api/pause', { method: 'POST' });
    toast('warning', '일시정지', '모든 에이전트 일시정지됨');
  });
  document.getElementById('btn-resume').addEventListener('click', async () => {
    await api('/api/resume', { method: 'POST' });
    toast('success', '재개', '모든 에이전트 재개됨');
  });
  document.getElementById('btn-export-preset').addEventListener('click', openExportPresetModal);
  document.getElementById('btn-save-preset').addEventListener('click', saveCurrentAsPreset);
  document.getElementById('btn-new-workflow').addEventListener('click', () => openBuilderModal(null));
  document.getElementById('btn-add-node').addEventListener('click', addBuilderNode);
  document.getElementById('btn-save-workflow').addEventListener('click', () => saveWorkflow(false));
  document.getElementById('btn-save-and-run').addEventListener('click', () => saveWorkflow(true));
  document.getElementById('builder-clone-from').addEventListener('change', cloneFromTemplate);

  // Universal modal hygiene: ESC, backdrop click, [data-modal-close]
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.closest('.modal');
      if (m) closeModal(m.id);
    });
  });
}

function openModal(id) {
  const m = document.getElementById(id);
  m.classList.add('show');
  // autofocus first input
  setTimeout(() => {
    const input = m.querySelector('input, textarea, select');
    if (input) input.focus();
  }, 50);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

function closeAllModals() {
  document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
  document.getElementById('cmdk').classList.remove('show');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Confirm modal (replaces native confirm)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function confirmModal(title, body) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent = body;
    const yesBtn = document.getElementById('confirm-yes');
    const noBtn = document.getElementById('confirm-no');
    const cleanup = (result) => {
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      closeModal('modal-confirm');
      resolve(result);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    openModal('modal-confirm');
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Toast
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toast(type, title, body) {
  const cont = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-title">${escape(title)}</div>
    ${body ? `<div class="toast-body">${escape(body)}</div>` : ''}
  `;
  cont.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 220);
  }, 4000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status Bar
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupStatusBar() {
  updateStatusBarTick();
}

function updateStatusBarTick() {
  if (LAST_POLL_AT === 0) return;
  const ago = Math.floor((Date.now() - LAST_POLL_AT) / 1000);
  document.getElementById('status-updated').textContent = `updated ${ago}s ago`;
  // health degrades if no poll for >5s
  const dot = document.getElementById('status-dot');
  const live = document.getElementById('status-live');
  if (!POLL_HEALTHY || ago > 10) {
    dot.classList.remove('warn'); dot.classList.add('danger');
    live.textContent = 'Disconnected';
  } else if (ago > 5) {
    dot.classList.remove('danger'); dot.classList.add('warn');
    live.textContent = 'Slow';
  } else {
    dot.classList.remove('warn', 'danger');
    live.textContent = 'Live';
  }
}

function updateStatusBarHealth() {
  const counts = `${CACHED_AGENTS.length} agents · ${(CACHED_WORKFLOWS.active || []).length} workflows`;
  document.getElementById('status-counts').textContent = counts;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Command Palette (⌘K)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let CMDK_ITEMS = [];
let CMDK_FILTERED = [];
let CMDK_INDEX = 0;

function setupCommandPalette() {
  document.getElementById('btn-cmdk').addEventListener('click', openCmdK);
  const input = document.getElementById('cmdk-input');
  input.addEventListener('input', () => { CMDK_INDEX = 0; renderCmdK(); });
  input.addEventListener('keydown', handleCmdKKey);
  document.getElementById('cmdk').addEventListener('click', (e) => {
    if (e.target.id === 'cmdk') closeCmdK();
  });
}

function buildCmdKItems() {
  const items = [];
  // Tabs
  for (const t of ['overview', 'workflows', 'agents', 'knowledge', 'channel']) {
    items.push({ section: 'Navigate', icon: '↗', label: 'Go to ' + t.charAt(0).toUpperCase() + t.slice(1), meta: 'g ' + t[0], action: () => switchTab(t) });
  }
  // Actions
  items.push({ section: 'Actions', icon: '+', label: 'New Workflow', meta: 'n', action: () => { switchTab('workflows'); openBuilderModal(null); } });
  items.push({ section: 'Actions', icon: '+', label: 'Add Agent', meta: 'N', action: () => { switchTab('agents'); openNewAgentModal(); } });
  items.push({ section: 'Actions', icon: '⏸', label: 'Pause All', action: () => document.getElementById('btn-pause').click() });
  items.push({ section: 'Actions', icon: '▶', label: 'Resume All', action: () => document.getElementById('btn-resume').click() });
  items.push({ section: 'Actions', icon: '?', label: 'Keyboard Shortcuts', meta: '?', action: () => openModal('modal-shortcuts') });
  // Agents
  for (const a of CACHED_AGENTS) {
    items.push({ section: 'Agents', icon: a.engine === 'gemini' ? 'G' : 'C', label: a.label, meta: a.id, action: () => { switchTab('agents'); openSkillsModal(a.id); } });
  }
  // Workflows
  for (const w of (CACHED_WORKFLOWS.templates || [])) {
    items.push({ section: 'Workflows', icon: '▶', label: 'Run: ' + (w.title || w.id), meta: w.file, action: () => { switchTab('workflows'); openRunModal(w.file, w.title); } });
  }
  return items;
}

function openCmdK() {
  CMDK_ITEMS = buildCmdKItems();
  CMDK_FILTERED = CMDK_ITEMS;
  CMDK_INDEX = 0;
  document.getElementById('cmdk').classList.add('show');
  const input = document.getElementById('cmdk-input');
  input.value = '';
  setTimeout(() => input.focus(), 50);
  renderCmdK();
}

function closeCmdK() {
  document.getElementById('cmdk').classList.remove('show');
}

function renderCmdK() {
  const q = document.getElementById('cmdk-input').value.trim().toLowerCase();
  CMDK_FILTERED = q
    ? CMDK_ITEMS.filter(it => it.label.toLowerCase().includes(q) || (it.meta || '').toLowerCase().includes(q) || it.section.toLowerCase().includes(q))
    : CMDK_ITEMS;
  if (CMDK_INDEX >= CMDK_FILTERED.length) CMDK_INDEX = 0;

  const out = [];
  let lastSection = null;
  CMDK_FILTERED.forEach((it, i) => {
    if (it.section !== lastSection) {
      out.push(`<div class="cmdk-section-title">${escape(it.section)}</div>`);
      lastSection = it.section;
    }
    out.push(`
      <div class="cmdk-item ${i === CMDK_INDEX ? 'active' : ''}" data-idx="${i}">
        <span class="cmdk-icon">${escape(it.icon || '·')}</span>
        <span class="cmdk-label">${escape(it.label)}</span>
        ${it.meta ? `<span class="cmdk-meta">${escape(it.meta)}</span>` : ''}
      </div>
    `);
  });
  const results = document.getElementById('cmdk-results');
  results.innerHTML = out.length ? out.join('') : '<div class="cmdk-empty">결과 없음</div>';
  results.querySelectorAll('.cmdk-item').forEach(el => {
    el.addEventListener('click', () => {
      CMDK_INDEX = parseInt(el.dataset.idx);
      executeCmdK();
    });
    el.addEventListener('mouseenter', () => {
      CMDK_INDEX = parseInt(el.dataset.idx);
      results.querySelectorAll('.cmdk-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    });
  });
}

function handleCmdKKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    CMDK_INDEX = Math.min(CMDK_FILTERED.length - 1, CMDK_INDEX + 1);
    renderCmdK();
    scrollActiveIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    CMDK_INDEX = Math.max(0, CMDK_INDEX - 1);
    renderCmdK();
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCmdK();
  } else if (e.key === 'Escape') {
    closeCmdK();
  }
}

function scrollActiveIntoView() {
  const el = document.querySelector('.cmdk-item.active');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function executeCmdK() {
  const item = CMDK_FILTERED[CMDK_INDEX];
  if (!item) return;
  closeCmdK();
  item.action();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Keyboard shortcuts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let G_PENDING = false;
let G_TIMER = null;

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCmdK();
      return;
    }
    // ESC closes modals/palette
    if (e.key === 'Escape') {
      closeAllModals();
      return;
    }
    // Ignore if typing in input
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // ? for help
    if (e.key === '?') {
      e.preventDefault();
      openModal('modal-shortcuts');
      return;
    }
    // n / N
    if (e.key === 'n') {
      const active = document.querySelector('.tab.active')?.dataset.tab;
      if (active === 'workflows') { e.preventDefault(); openBuilderModal(null); return; }
    }
    if (e.key === 'N') {
      const active = document.querySelector('.tab.active')?.dataset.tab;
      if (active === 'agents') { e.preventDefault(); openNewAgentModal(); return; }
    }
    // g + tab key
    if (e.key === 'g') {
      G_PENDING = true;
      clearTimeout(G_TIMER);
      G_TIMER = setTimeout(() => { G_PENDING = false; }, 1000);
      return;
    }
    if (G_PENDING) {
      const map = { o: 'overview', w: 'workflows', a: 'agents', k: 'knowledge', c: 'channel' };
      if (map[e.key]) {
        e.preventDefault();
        switchTab(map[e.key]);
      }
      G_PENDING = false;
      clearTimeout(G_TIMER);
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Workflow Builder (mostly unchanged)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function openBuilderModal(editFile) {
  BUILDER_EDIT_FILE = editFile;
  BUILDER_NODES = [];
  document.getElementById('builder-id').value = '';
  document.getElementById('builder-title-input').value = '';
  document.getElementById('builder-id').disabled = false;

  const select = document.getElementById('builder-clone-from');
  select.innerHTML = '<option value="">Clone from template...</option>';
  for (const t of WORKFLOW_TEMPLATES) {
    const opt = document.createElement('option');
    opt.value = t.file;
    opt.textContent = `${t.title || t.id} (${t.file})`;
    select.appendChild(opt);
  }

  if (editFile) {
    document.getElementById('builder-title').textContent = `Edit: ${editFile}`;
    document.getElementById('builder-id').disabled = true;
    try {
      const res = await fetch(`/api/workflows/template/${editFile}`);
      const wf = await res.json();
      document.getElementById('builder-id').value = (wf.workflow_id || '').replace(/^wf_/, '');
      document.getElementById('builder-title-input').value = wf.title || '';
      BUILDER_NODES = wf.nodes || [];
    } catch (e) {
      toast('danger', 'Load failed', editFile);
      return;
    }
  } else {
    document.getElementById('builder-title').textContent = 'New Workflow';
    addBuilderNode();
  }

  renderBuilderNodes();
  openModal('modal-builder');
}

async function cloneFromTemplate(e) {
  const file = e.target.value;
  if (!file) return;
  try {
    const res = await fetch(`/api/workflows/template/${file}`);
    const wf = await res.json();
    BUILDER_NODES = JSON.parse(JSON.stringify(wf.nodes || []));
    document.getElementById('builder-title-input').value = wf.title || '';
    renderBuilderNodes();
  } catch (e) { toast('danger', 'Clone failed', ''); }
  e.target.value = '';
}

function addBuilderNode() {
  const num = BUILDER_NODES.length + 1;
  const prevId = BUILDER_NODES.length > 0 ? BUILDER_NODES[BUILDER_NODES.length - 1].id : null;
  BUILDER_NODES.push({
    id: `n${num}`,
    agent: CACHED_AGENTS[0]?.id || 'pm',
    input_template: prevId ? `{{${prevId}.output_artifact}}` : '{{user_request}}',
    depends_on: prevId ? [prevId] : [],
    on_failure: 'manual',
    status: 'pending',
  });
  renderBuilderNodes();
}

function deleteBuilderNode(idx) {
  const removed = BUILDER_NODES[idx];
  BUILDER_NODES.splice(idx, 1);
  for (const n of BUILDER_NODES) {
    n.depends_on = (n.depends_on || []).filter(d => d !== removed.id);
  }
  renderBuilderNodes();
}

function renderBuilderNodes() {
  const container = document.getElementById('builder-nodes');
  container.innerHTML = '';
  BUILDER_NODES.forEach((node, idx) => {
    const row = document.createElement('div');
    row.className = 'builder-node';
    const agentOptions = CACHED_AGENTS
      .map(a => `<option value="${escape(a.id)}" ${a.id === node.agent ? 'selected' : ''}>${escape(a.label)}</option>`)
      .join('');
    row.innerHTML = `
      <div class="node-num">${idx + 1}</div>
      <input type="text" value="${escape(node.id)}" data-idx="${idx}" data-field="id" placeholder="node id">
      <div class="input-template-wrap">
        <input type="text" value="${escape(node.input_template)}" data-idx="${idx}" data-field="input_template">
        ${idx > 0 ? `<button class="insert-var-btn" data-idx="${idx}">prev</button>` : ''}
      </div>
      <select data-idx="${idx}" data-field="agent">${agentOptions}</select>
      <button class="delete-node-btn" data-idx="${idx}" title="삭제">×</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
    el.addEventListener('input', (e) => {
      const i = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      BUILDER_NODES[i][field] = e.target.value;
      renderBuilderPreview();
    });
  });
  container.querySelectorAll('.delete-node-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBuilderNode(parseInt(btn.dataset.idx)));
  });
  container.querySelectorAll('.insert-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx);
      const prev = BUILDER_NODES[i - 1];
      if (prev) {
        BUILDER_NODES[i].input_template = `{{${prev.id}.output_artifact}}`;
        renderBuilderNodes();
      }
    });
  });

  renderBuilderPreview();
}

function renderBuilderPreview() {
  const container = document.getElementById('builder-preview');
  container.innerHTML = '<h5>Preview</h5><div class="dag-container"></div>';
  if (BUILDER_NODES.length > 0) {
    const wfPreview = { workflow_id: 'preview', nodes: BUILDER_NODES.map(n => ({ ...n, status: 'pending' })) };
    renderDAG(container.querySelector('.dag-container'), wfPreview);
  }
}

async function saveWorkflow(thenRun) {
  const wfId = document.getElementById('builder-id').value.trim();
  const title = document.getElementById('builder-title-input').value.trim();
  if (!wfId) { toast('warning', 'ID 필수', ''); return; }
  if (BUILDER_NODES.length === 0) { toast('warning', '노드 1개 이상', ''); return; }

  const nodes = BUILDER_NODES.map(n => ({
    ...n,
    depends_on: Array.isArray(n.depends_on)
      ? n.depends_on.filter(Boolean)
      : (n.depends_on || '').split(',').map(s => s.trim()).filter(Boolean),
  }));

  const body = { workflow_id: wfId, title: title || wfId, nodes };
  const res = await api('/api/workflows/create', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    if (!res.conflict) toast('danger', '저장 실패', res.result || '');
    return;
  }

  closeModal('modal-builder');
  toast('success', '워크플로 저장됨', wfId);
  if (thenRun) setTimeout(() => openRunModal(res.result.file, title), 200);
  poll();
}

let SELECTED_LIBRARY_PATH = null;
let LIBRARY_DATA = null;

async function openNewAgentModal() {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.onclick = () => switchAgentMode(tab.dataset.mode);
  });
  switchAgentMode('library');

  LIBRARY_DATA = await api('/api/library');
  renderLibraryList('');
  const filter = document.getElementById('library-category-filter');
  filter.innerHTML = '<option value="">All</option>' +
    (LIBRARY_DATA.categories || []).map(c => `<option value="${escape(c)}">${escape(c)}</option>`).join('');
  filter.onchange = (e) => renderLibraryList(e.target.value);

  const skills = CACHED_SKILLS.length ? CACHED_SKILLS : ((await api('/api/skills')).skills || []);
  const container = document.getElementById('agent-skills-checkboxes');
  container.innerHTML = '<label style="margin-top:8px;">Skills (optional)</label>';
  const grid = document.createElement('div');
  grid.className = 'skills-checkboxes';
  for (const s of skills) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${escape(s.name)}"> ${escape(s.name)}`;
    grid.appendChild(lbl);
  }
  container.appendChild(grid);

  openModal('modal-agent');
}

function switchAgentMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.querySelectorAll('.agent-mode-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`agent-mode-${mode}`).classList.add('active');
}

function openExportPresetModal() {
  document.getElementById('preset-id').value = '';
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-description').value = '';
  document.getElementById('preset-icon').value = '🏢';
  openModal('modal-export-preset');
}

async function saveCurrentAsPreset() {
  const body = {
    id: document.getElementById('preset-id').value.trim(),
    name: document.getElementById('preset-name').value.trim(),
    description: document.getElementById('preset-description').value.trim(),
    icon: document.getElementById('preset-icon').value.trim() || '🏢',
  };
  if (!body.id || !body.name) { toast('warning', 'ID와 이름 필수', ''); return; }
  const res = await api('/api/presets/export', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) {
    closeModal('modal-export-preset');
    toast('success', '프리셋 저장됨', res.result.file);
  } else {
    toast('danger', '저장 실패', res.result || '');
  }
}

function parseDefaultSkills(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const s = String(raw).trim();
  // Try JSON array first
  try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch {}
  // Fallback: strip [] and split
  return s.replace(/^\[|\]$/g, '').split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function renderLibraryList(categoryFilter) {
  const container = document.getElementById('library-list');
  container.innerHTML = '';
  SELECTED_LIBRARY_PATH = null;
  const all = (LIBRARY_DATA?.library || []).filter(it =>
    !categoryFilter || it.category === categoryFilter
  );
  const activeFiles = new Set(CACHED_AGENTS.map(a => a.agent_file));

  // Group by category
  const groups = {};
  for (const it of all) {
    (groups[it.category] = groups[it.category] || []).push(it);
  }

  if (all.length === 0) {
    container.innerHTML = '<div class="empty-state-small">No agents in this category</div>';
    return;
  }

  for (const cat of Object.keys(groups).sort()) {
    const section = document.createElement('div');
    section.className = 'library-section';
    section.innerHTML = `<div class="library-section-title">${escape(cat)} <span class="library-section-count">${groups[cat].length}</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'library-grid';

    for (const it of groups[cat]) {
      const isActive = activeFiles.has(it.library_path.split('/').pop());
      const skills = parseDefaultSkills(it.default_skills);
      const card = document.createElement('div');
      card.className = 'library-card' + (isActive ? ' is-active' : '');
      card.innerHTML = `
        <div class="library-card-header">
          <span class="lib-name">${escape(it.name)}</span>
          ${isActive ? '<span class="lib-badge-active">active</span>' : ''}
        </div>
        <div class="lib-desc">${escape(it.description || '—')}</div>
        ${skills.length ? `<div class="lib-skills">${skills.slice(0, 4).map(s => `<span class="lib-chip">${escape(s)}</span>`).join('')}${skills.length > 4 ? `<span class="lib-chip lib-chip-more">+${skills.length - 4}</span>` : ''}</div>` : ''}
      `;
      if (!isActive) {
        card.onclick = () => {
          document.querySelectorAll('.library-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          SELECTED_LIBRARY_PATH = it.library_path;
        };
      }
      grid.appendChild(card);
    }
    section.appendChild(grid);
    container.appendChild(section);
  }
}

async function createAgent() {
  const libraryActive = document.getElementById('agent-mode-library').classList.contains('active');
  if (libraryActive) {
    if (!SELECTED_LIBRARY_PATH) { toast('warning', '에이전트 선택', ''); return; }
    closeModal('modal-agent');
    const res = await api('/api/agents/from-library', {
      method: 'POST',
      body: JSON.stringify({ library_path: SELECTED_LIBRARY_PATH })
    });
    if (res.ok) { toast('success', '에이전트 추가됨', SELECTED_LIBRARY_PATH); poll(); }
    else if (!res.conflict) toast('danger', '실패', res.result || '');
    return;
  }

  const skills = Array.from(document.querySelectorAll('#agent-skills-checkboxes input:checked')).map(i => i.value);
  const body = {
    id: document.getElementById('agent-id').value.trim(),
    label: document.getElementById('agent-label').value.trim(),
    engine: document.getElementById('agent-engine').value,
    agent_file: document.getElementById('agent-id').value.trim(),
    description: document.getElementById('agent-description').value.trim(),
    role_body: document.getElementById('agent-role-body').value.trim(),
    skills: skills,
  };
  if (!body.id || !body.label) { toast('warning', 'id, label 필수', ''); return; }

  closeModal('modal-agent');
  const res = await api('/api/agents/create', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) { toast('success', '에이전트 생성됨', body.label); poll(); }
  else if (!res.conflict) toast('danger', '실패', res.result || '');
}

async function handleAgentAction(action, aid) {
  if (action === 'delete') {
    const ok = await confirmModal('에이전트 삭제', `${aid}을(를) 삭제합니다. 이 작업은 되돌릴 수 없습니다.`);
    if (!ok) return;
    const res = await api(`/api/agents/${aid}/delete`, { method: 'POST', body: '{}' });
    if (res.ok) { toast('success', '삭제됨', aid); poll(); }
    else if (!res.conflict) toast('danger', '삭제 실패', res.result);
  } else if (action === 'skills') {
    openSkillsModal(aid);
  }
}

async function openSkillsModal(aid) {
  CURRENT_AGENT_FOR_SKILLS = aid;
  const state = await api('/api/state');
  const agent = state.agents.find(a => a.id === aid);
  if (!agent) return;
  const skills = CACHED_SKILLS.length ? CACHED_SKILLS : ((await api('/api/skills')).skills || []);
  const assigned = new Set(agent.assigned_skills || []);

  document.getElementById('skills-modal-title').textContent = `${agent.label} · Skills`;
  const list = document.getElementById('skills-modal-list');
  list.innerHTML = '';
  for (const s of skills) {
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${escape(s.name)}" ${assigned.has(s.name) ? 'checked' : ''}> ${escape(s.name)}`;
    list.appendChild(lbl);
  }
  openModal('modal-skills');
}

async function saveSkills() {
  const skills = Array.from(document.querySelectorAll('#skills-modal-list input:checked')).map(i => i.value);
  const res = await api(`/api/agents/${CURRENT_AGENT_FOR_SKILLS}/skills`, {
    method: 'POST', body: JSON.stringify({ skills })
  });
  if (res.ok) {
    closeModal('modal-skills');
    toast('success', '스킬 저장됨', `${skills.length}개 할당`);
    poll();
  } else {
    toast('danger', '실패', res.result);
  }
}

function openRunModal(file, title) {
  CURRENT_WORKFLOW_FILE = file;
  document.getElementById('run-modal-title').textContent = `Run: ${title || file}`;
  document.getElementById('run-user-request').value = '';
  openModal('modal-run-workflow');
}

async function runWorkflow() {
  const userRequest = document.getElementById('run-user-request').value.trim();
  if (!userRequest) { toast('warning', 'User request 필요', ''); return; }
  const res = await api(`/api/workflows/${CURRENT_WORKFLOW_FILE}/run`, {
    method: 'POST', body: JSON.stringify({ user_request: userRequest })
  });
  if (res.ok) {
    closeModal('modal-run-workflow');
    toast('success', '워크플로 실행', CURRENT_WORKFLOW_FILE);
    poll();
  } else {
    toast('danger', '실행 실패', res.result);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    idle: 'idle',
    working: 'working',
    done: 'done',
    error: 'error',
    timeout: 'timeout',
    dead: 'dead',
    booting: 'booting',
    stopped: 'stopped',
    compacting: 'compacting',
    'cost-paused': 'cost paused',
    'paused': 'paused',
    'permanently-failed': 'failed',
    'rate-limited': 'rate limited',
  };
  return labels[state] || state;
}

init();
