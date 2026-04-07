// Virtual Company Dashboard - Main App
const POLL_INTERVAL = 2000;
let TOKEN = null;
let CURRENT_AGENT_FOR_SKILLS = null;
let CURRENT_WORKFLOW_FILE = null;
let WORKFLOW_TEMPLATES = [];
let BUILDER_NODES = [];
let BUILDER_EDIT_FILE = null;
let CACHED_AGENTS = [];
let CONFIG_ETAG = null;  // Lost Update 방지용 (서버 응답 ETag 헤더에서 추출)

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.method && opts.method !== 'GET' && TOKEN) {
    headers['X-Token'] = TOKEN;
    // POST에 If-Match 헤더 자동 추가 (Lost Update 방지)
    if (CONFIG_ETAG) headers['X-If-Match'] = CONFIG_ETAG;
  }
  const res = await fetch(path, { ...opts, headers });
  // GET 응답의 ETag 헤더 캐시
  const newEtag = res.headers.get('ETag');
  if (newEtag) CONFIG_ETAG = newEtag;
  // 409 충돌 처리
  if (res.status === 409) {
    const data = await res.json();
    alert('⚠ 충돌: ' + (data.result || '다른 곳에서 수정됨'));
    poll();  // 즉시 재로드
    return { ok: false, conflict: true, result: data.result };
  }
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
  CACHED_AGENTS = state.agents;
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
  WORKFLOW_TEMPLATES = templates; // 빌더에서 복제용

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
        <div class="dag-container"></div>
      `;
      activeEl.appendChild(card);
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
      <div class="gallery-item-actions">
        <button class="btn-primary" data-act="run">▶ 실행</button>
        <button data-act="edit">✏ 편집</button>
        <button class="btn-danger" data-act="delete">🗑 삭제</button>
      </div>
    `;
    item.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => handleWorkflowAction(btn.dataset.act, t.file, t.title));
    });
    gallery.appendChild(item);
  }
}

async function handleWorkflowAction(action, file, title) {
  if (action === 'run') openRunModal(file, title);
  else if (action === 'edit') openBuilderModal(file);
  else if (action === 'delete') {
    if (!confirm(`워크플로 ${file}을 삭제하시겠습니까?`)) return;
    const res = await api(`/api/workflows/${file}/delete`, { method: 'POST', body: '{}' });
    if (res.ok) poll();
    else alert('삭제 실패: ' + res.result);
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

  // Preset Export
  document.getElementById('btn-export-preset').addEventListener('click', openExportPresetModal);
  document.getElementById('btn-cancel-preset').addEventListener('click', () => closeModal('modal-export-preset'));
  document.getElementById('btn-save-preset').addEventListener('click', saveCurrentAsPreset);

  // Workflow Builder
  document.getElementById('btn-new-workflow').addEventListener('click', () => openBuilderModal(null));
  document.getElementById('btn-cancel-builder').addEventListener('click', () => closeModal('modal-builder'));
  document.getElementById('btn-add-node').addEventListener('click', addBuilderNode);
  document.getElementById('btn-save-workflow').addEventListener('click', () => saveWorkflow(false));
  document.getElementById('btn-save-and-run').addEventListener('click', () => saveWorkflow(true));
  document.getElementById('builder-clone-from').addEventListener('change', cloneFromTemplate);
}

// ━━━ Workflow Builder ━━━
async function openBuilderModal(editFile) {
  BUILDER_EDIT_FILE = editFile;
  BUILDER_NODES = [];
  document.getElementById('builder-id').value = '';
  document.getElementById('builder-title-input').value = '';
  document.getElementById('builder-id').disabled = false;

  // 갤러리 드롭다운 채우기
  const select = document.getElementById('builder-clone-from');
  select.innerHTML = '<option value="">템플릿에서 복제...</option>';
  for (const t of WORKFLOW_TEMPLATES) {
    const opt = document.createElement('option');
    opt.value = t.file;
    opt.textContent = `${t.title || t.id} (${t.file})`;
    select.appendChild(opt);
  }

  if (editFile) {
    // 편집 모드: 기존 워크플로 로드
    document.getElementById('builder-title').textContent = `워크플로 편집: ${editFile}`;
    document.getElementById('builder-id').disabled = true;
    try {
      const res = await fetch(`/api/workflows/template/${editFile}`);
      const wf = await res.json();
      document.getElementById('builder-id').value = (wf.workflow_id || '').replace(/^wf_/, '');
      document.getElementById('builder-title-input').value = wf.title || '';
      BUILDER_NODES = wf.nodes || [];
    } catch (e) {
      alert('워크플로 로드 실패');
      return;
    }
  } else {
    document.getElementById('builder-title').textContent = '새 워크플로';
    addBuilderNode();
  }

  renderBuilderNodes();
  document.getElementById('modal-builder').classList.add('show');
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
  } catch (e) { alert('복제 실패'); }
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
  // 다른 노드들의 depends_on에서 제거
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
    // depends_on 옵션: 자기 이전 노드들만
    const otherIds = BUILDER_NODES.filter((_, i) => i < idx).map(n => n.id);
    const depsValue = (node.depends_on || []).join(',');
    const agentOptions = CACHED_AGENTS
      .map(a => `<option value="${escape(a.id)}" ${a.id === node.agent ? 'selected' : ''}>${escape(a.label)}</option>`)
      .join('');
    row.innerHTML = `
      <div class="node-num">${idx + 1}</div>
      <input type="text" value="${escape(node.id)}" data-idx="${idx}" data-field="id" placeholder="node id">
      <div class="input-template-wrap">
        <input type="text" value="${escape(node.input_template)}" data-idx="${idx}" data-field="input_template">
        ${idx > 0 ? `<button class="insert-var-btn" data-idx="${idx}">📎 이전 결과</button>` : ''}
      </div>
      <select data-idx="${idx}" data-field="agent">${agentOptions}</select>
      <button class="delete-node-btn" data-idx="${idx}" title="삭제">🗑</button>
    `;
    container.appendChild(row);
  });

  // 이벤트 바인딩
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
  const wfPreview = {
    workflow_id: 'preview',
    nodes: BUILDER_NODES.map(n => ({ ...n, status: 'pending' })),
  };
  container.innerHTML = '<h5>📊 미리보기</h5><div class="dag-container"></div>';
  if (BUILDER_NODES.length > 0) {
    renderDAG(container.querySelector('.dag-container'), wfPreview);
  }
}

async function saveWorkflow(thenRun) {
  const wfId = document.getElementById('builder-id').value.trim();
  const title = document.getElementById('builder-title-input').value.trim();
  if (!wfId) { alert('ID 필수'); return; }
  if (BUILDER_NODES.length === 0) { alert('노드 1개 이상 필요'); return; }

  // depends_on 정규화 (콤마 구분 → array)
  const nodes = BUILDER_NODES.map(n => ({
    ...n,
    depends_on: Array.isArray(n.depends_on)
      ? n.depends_on.filter(Boolean)
      : (n.depends_on || '').split(',').map(s => s.trim()).filter(Boolean),
  }));

  const body = { workflow_id: wfId, title: title || wfId, nodes };
  const res = await api('/api/workflows/create', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    alert('저장 실패: ' + (res.result || 'unknown'));
    return;
  }

  closeModal('modal-builder');

  if (thenRun) {
    // 저장 후 즉시 실행 모달 열기
    setTimeout(() => openRunModal(res.result.file, title), 200);
  }
  poll();
}

let SELECTED_LIBRARY_PATH = null;
let LIBRARY_DATA = null;

async function openNewAgentModal() {
  // 모드 탭 설정
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.onclick = () => switchAgentMode(tab.dataset.mode);
  });
  switchAgentMode('library');

  // 라이브러리 로드
  LIBRARY_DATA = await api('/api/library');
  renderLibraryList('');
  // 카테고리 필터
  const filter = document.getElementById('library-category-filter');
  filter.innerHTML = '<option value="">전체</option>' +
    (LIBRARY_DATA.categories || []).map(c => `<option value="${escape(c)}">${escape(c)}</option>`).join('');
  filter.onchange = (e) => renderLibraryList(e.target.value);

  // Custom 모드용 스킬 체크박스
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
  document.getElementById('modal-export-preset').classList.add('show');
}

async function saveCurrentAsPreset() {
  const body = {
    id: document.getElementById('preset-id').value.trim(),
    name: document.getElementById('preset-name').value.trim(),
    description: document.getElementById('preset-description').value.trim(),
    icon: document.getElementById('preset-icon').value.trim() || '🏢',
  };
  if (!body.id || !body.name) {
    alert('ID와 이름은 필수입니다');
    return;
  }
  const res = await api('/api/presets/export', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) {
    closeModal('modal-export-preset');
    alert(`✓ 프리셋 저장: ${res.result.file}\n\n다음 install.sh부터 선택 가능합니다.`);
  } else {
    alert('실패: ' + (res.result || 'unknown'));
  }
}

function renderLibraryList(categoryFilter) {
  const container = document.getElementById('library-list');
  container.innerHTML = '';
  SELECTED_LIBRARY_PATH = null;
  const items = (LIBRARY_DATA?.library || []).filter(it =>
    !categoryFilter || it.category === categoryFilter
  );
  // 이미 활성화된 에이전트는 제외 (agent_file 기준)
  const activeFiles = new Set(CACHED_AGENTS.map(a => a.agent_file));
  for (const it of items) {
    const isActive = activeFiles.has(it.library_path.split('/').pop());
    const card = document.createElement('div');
    card.className = 'library-card';
    if (isActive) {
      card.style.opacity = '0.4';
      card.style.cursor = 'not-allowed';
    }
    card.innerHTML = `
      <div class="library-card-header">
        <span class="lib-name">${escape(it.name)}</span>
        <span class="lib-category">${escape(it.category)}</span>
      </div>
      <div class="lib-desc">${escape(it.description)}</div>
      ${isActive ? '<div style="margin-top:4px;font-size:10px;color:var(--green);">✓ 이미 활성화됨</div>' : ''}
    `;
    if (!isActive) {
      card.onclick = () => {
        document.querySelectorAll('.library-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        SELECTED_LIBRARY_PATH = it.library_path;
      };
    }
    container.appendChild(card);
  }
}

async function createAgent() {
  // 라이브러리 모드인지 Custom 모드인지 확인
  const libraryActive = document.getElementById('agent-mode-library').classList.contains('active');

  if (libraryActive) {
    if (!SELECTED_LIBRARY_PATH) {
      alert('라이브러리에서 에이전트를 선택해주세요');
      return;
    }
    closeModal('modal-agent');
    const res = await api('/api/agents/from-library', {
      method: 'POST',
      body: JSON.stringify({ library_path: SELECTED_LIBRARY_PATH })
    });
    if (res.ok) {
      poll();
    } else if (!res.conflict) {
      alert('실패: ' + (res.result || 'unknown'));
    }
    return;
  }

  // Custom 모드
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

  // Optimistic UI: 모달 즉시 닫고 임시 카드 표시
  closeModal('modal-agent');
  const cards = document.getElementById('agents-cards');
  const tempCard = document.createElement('div');
  tempCard.className = 'agent-card';
  tempCard.style.opacity = '0.5';
  tempCard.id = `temp-agent-${body.id}`;
  tempCard.innerHTML = `
    <div class="agent-card-header">
      <strong>${escape(body.label)}</strong>
      <span class="agent-engine">${escape(body.engine)} (생성 중...)</span>
    </div>
    <div class="agent-meta">id: ${escape(body.id)}</div>
  `;
  cards.appendChild(tempCard);

  const res = await api('/api/agents/create', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) {
    poll();  // 실제 데이터로 교체
  } else {
    // Rollback
    tempCard.remove();
    if (!res.conflict) alert('실패: ' + (res.result || 'unknown error'));
  }
}

async function handleAgentAction(action, aid) {
  if (action === 'delete') {
    if (!confirm(`에이전트 ${aid}를 삭제하시겠습니까?`)) return;
    // Optimistic UI: 즉시 카드 숨김
    const card = document.querySelector(`.agent-card [data-id="${aid}"]`)?.closest('.agent-card');
    if (card) {
      card.style.opacity = '0.4';
      card.style.pointerEvents = 'none';
    }
    const res = await api(`/api/agents/${aid}/delete`, { method: 'POST', body: '{}' });
    if (res.ok) {
      poll();
    } else {
      // Rollback
      if (card) {
        card.style.opacity = '';
        card.style.pointerEvents = '';
      }
      if (!res.conflict) alert('삭제 실패: ' + res.result);
    }
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
