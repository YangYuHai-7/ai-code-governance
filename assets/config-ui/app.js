const session = document.querySelector('meta[name="aicg-session"]').content;
const $ = (id) => document.getElementById(id);
// Owner-facing labels: [short name, what it actually does]. The page is the owner's
// surface, so a capability's consequence matters more than its internal key.
const featureLabels = {
  knowledge: ['项目知识', '记录项目里的约定和背景。'],
  taskRuntime: ['长任务', '支持跨多次会话的任务结构。'],
  hooks: ['提交前检查', 'git 提交前自动运行治理检查。'],
  externalWorkflows: ['外部流程对接', '与外部流程系统衔接所需的材料。'],
  ciIntegration: ['CI 集成', '生成持续集成需要的入口。'],
  deliveryLoop: ['需求到测试闭环', '生成从需求到测试的完整流程模板。'],
  aiAssist: ['AI 复核', '应用后让 AI 只读复核并评分（目前支持 Codex）。'],
};
// The page offers a curated five-client order (CONFIG_UI_CLIENTS in configuration-web.mjs);
// labels come from the agent registry, and these lines only explain each client's entrypoint.
const clientHints = {
  deepseek: '生成 AGENTS.md 与 .dsh/skills 入口',
  codex: '生成 AGENTS.md 与 .agents/skills 入口',
  cursor: '生成 Cursor 规则与技能入口',
  'claude-code': '生成 CLAUDE.md 与 .claude/skills 入口',
  'github-copilot': '生成 .github 下的说明与技能入口',
};
const osLabels = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
const depthLabels = { minimal: '简单', standard: '标准', complete: '完整' };
const strategyLabels = { 'keep-existing': '保持不动', 'new-code-standard': '只约束新代码', 'staged-migration': '分阶段改造' };
const familyLabels = {
  'web-frontend': '浏览器前端技术栈', 'web-backend': '服务端 Web 技术栈', dotnet: '.NET 平台',
  'native-mobile': '原生移动应用', 'hybrid-mobile': '跨端移动应用', desktop: '桌面应用',
  'systems-embedded': '系统或嵌入式开发', generic: '扫描无法确认具体技术栈时使用',
};
const stackLabels = {
  'frontend-react': 'React 前端', 'frontend-vue': 'Vue 前端', 'frontend-angular': 'Angular 前端',
  'frontend-svelte': 'Svelte 前端', 'backend-node': 'Node.js 服务端', 'backend-java': 'Java 服务端',
  'backend-python': 'Python 服务端', 'backend-go': 'Go 服务端', 'backend-php': 'PHP 服务端',
  'platform-dotnet': '.NET 平台', 'platform-android': 'Android 原生', 'platform-ios': 'iOS 原生',
  'platform-hybrid-mobile': '跨端移动', 'platform-desktop': '桌面应用', 'platform-c-cpp': 'C/C++ 系统开发',
  'generic-unknown': '通用 / 暂未识别',
};
let base = null;
let sha = null;
let previewHash = null;
let generation = 0;
let controller = null;
let downloadUrl = null;
let currentRoot = null;
let home = null;
let browseLocation = null;
let dirty = false;
let selecting = false;
let projectAssessment = null;
let applying = false;
let applyControls = [];
let agentRegistry = [];
let builtInClients = [];
let nativePickerAvailable = false;

// Feedback must be visible wherever the owner is looking. The page action bar is sticky at the
// bottom, so every message also appears as a floating toast above it instead of only in the
// top notice, which a scrolled-down owner never sees.
let toastTimer = null;
function showToast(value, error = false) {
  const toast = $('toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  if (value) {
    toast.textContent = value;
    toast.classList.toggle('error', error);
    toast.hidden = false;
    // Auto-dismiss so a transient message never lingers; errors stay readable longer.
    // Repeating progress updates reset the timer, so the toast stays for the whole operation.
    toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 8000 : 4000);
  } else {
    toast.hidden = true;
  }
}

function message(value, error = false) {
  $('notice').textContent = value;
  $('notice').classList.toggle('error', error);
  showToast(value, error);
}

function invalidate() {
  generation += 1;
  controller?.abort();
  controller = null;
  previewHash = null;
  $('apply').disabled = true;
  $('apply').hidden = true;
  // Any configuration change invalidates the preview, so the preview action becomes available
  // again and the previous file list is cleared.
  const preview = $('save-preview');
  if (preview) preview.hidden = false;
  $('preview-result').replaceChildren();
}

async function api(route, body) {
  controller?.abort();
  controller = new AbortController();
  const response = await fetch('/api/' + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-aicg-session': session, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  const result = await response.json();
  if (!response.ok) {
    const details = Array.isArray(result.verificationErrors) ? result.verificationErrors : [];
    const raw = result.error || ('HTTP ' + response.status);
    const error = /managed architecture configuration drifted|adaptive decision receipts drifted/.test(raw)
      ? '治理配置与账本不一致（漂移），AICG 拒绝在漂移的基线上预览或改写。请点页面上方的「备份并重建基线」。'
      : raw;
    throw new Error([error].concat(details).join('\n'));
  }
  return result;
}

// A drifted managed baseline is a refusal by design. Keep it to one line plus the two hashes,
// and put the recovery in a single owner-clicked button.
function renderTrustWarning(trust) {
  const box = $('trust-warning');
  if (!box) return;
  box.replaceChildren();
  if (!trust || trust.state === 'none' || trust.state === 'trusted') { box.hidden = true; return; }
  const short = (value) => (value ? value.slice(0, 12) + '…' : '（缺失）');
  const title = document.createElement('strong');
  const line = document.createElement('p');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary';
  button.textContent = '备份并重建基线';
  if (trust.state === 'unrecorded') {
    title.textContent = '治理配置没有可信账本记录，AICG 不会直接改写它。';
    line.textContent = '当前文件 ' + short(trust.actualSha);
  } else {
    title.textContent = '治理配置与账本不一致（漂移），无法预览或改写。';
    line.textContent = '账本记录 ' + short(trust.expectedSha) + ' · 当前文件 ' + short(trust.actualSha);
  }
  button.addEventListener('click', () => action(rebaseline));
  box.append(title, line, button);
  box.hidden = false;
}

// One-click, owner-confirmed baseline rebuild: back up the current managed config, then
// regenerate config + manifest from the values on the page through the exact-plan transaction.
async function rebaseline() {
  if (!window.confirm('将先备份当前的 .ai-governance/config.json，再按页面里的配置重建基线并更新账本。\n若技能管理缺少批准，会一并停用（原文件保留）。继续？')) return;
  const config = collect();
  setApplying(true);
  try {
    const result = await api('rebaseline', { config, expectedSha: sha });
    const data = await api('bootstrap');
    showProject(data);
    const notes = [];
    const backups = result.backupPaths ?? (result.backupPath ? [result.backupPath] : []);
    if (backups.length) notes.push('原文件已备份到 reports/aicg/rebaseline-backup/');
    if (result.skillManagementDropped) notes.push('技能管理缺少批准，已停用（原文件保留）');
    message('基线已重建，现在可以预览了。' + (notes.length ? notes.join('；') + '。' : ''));
  } finally { setApplying(false); }
}

function setApplying(active) {
  applying = active;
  if (active) {
    applyControls = [...document.querySelectorAll('button, input, select, textarea')].map((control) => ({ control, disabled: control.disabled }));
    for (const { control } of applyControls) control.disabled = true;
    $('workspace').setAttribute('aria-busy', 'true');
    $('notice').classList.add('busy');
    message('正在应用配置并校验项目，请稍候…');
  } else {
    for (const { control, disabled } of applyControls) control.disabled = disabled;
    applyControls = [];
    $('workspace').removeAttribute('aria-busy');
    $('notice').classList.remove('busy');
  }
}

function choices(container, name, entries, selected, describe = () => '') {
  const parent = $(container);
  parent.replaceChildren();
  for (const { id, label } of entries) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = name; input.value = id; input.checked = selected.includes(id);
    const title = document.createElement('span'); title.textContent = label;
    const detail = describe(id);
    if (detail) { const small = document.createElement('small'); small.textContent = detail; title.append(small); }
    const wrapper = document.createElement('label'); wrapper.className = 'choice'; wrapper.append(input, title); parent.append(wrapper);
  }
}

function checked(name) {
  return [...document.querySelectorAll('input[name="' + name + '"]:checked')].map((input) => input.value);
}

function ansChip(text, on) {
  const span = document.createElement('span');
  span.className = 'chip' + (on === false ? '' : ' on');
  span.textContent = text;
  return span;
}

function renderAns(id, chips) {
  $(id).replaceChildren(...chips);
}

// Each checklist row shows the current answer as a chip, so the owner can read the whole
// configuration without opening a single editor.
function syncSummaries() {
  const clients = checked('clients');
  const names = clients.map((id) => { const found = agentRegistry.find((agent) => agent.id === id); return found ? found.label : id; });
  const chips = names.slice(0, 2).map((name) => ansChip(name));
  if (names.length > 2) chips.push(ansChip('+' + (names.length - 2)));
  renderAns('ans-clients', names.length ? chips : [ansChip('还没选', false)]);
  const lifecycle = $('lifecycle').value;
  const lifecycleText = lifecycle === 'greenfield' ? '全新项目' : lifecycle === 'existing' ? (strategyLabels[$('strategy').value] || '保持不动') : '待确认';
  renderAns('ans-lifecycle', [ansChip(lifecycleText, lifecycle !== '')]);
  renderAns('ans-depth', [ansChip(depthLabels[$('depth').value] || '标准')]);
  const constraints = $('constraints').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  renderAns('ans-constraints', [ansChip(constraints.length ? '已填 ' + constraints.length + ' 条' : '跳过', constraints.length > 0)]);
}

function fill(config) {
  base = structuredClone(config);
  const clients = config.clientSupport?.selectedClients ?? config.clients ?? [];
  document.querySelectorAll('input[name="clients"]').forEach((input) => { input.checked = clients.includes(input.value); });
  document.querySelectorAll('input[name="stacks"]').forEach((input) => { input.checked = (config.stacks ?? []).includes(input.value); });
  document.querySelectorAll('input[name="oses"]').forEach((input) => { input.checked = (config.supportedOs ?? []).includes(input.value); });
  document.querySelectorAll('input[name="features"]').forEach((input) => { input.checked = Boolean(config.features?.[input.value]); });
  $('brownfield-enrichment').value = config.features?.brownfieldEnrichment ?? 'ask';
  $('lifecycle').value = config.initialization?.lifecycle ?? (projectAssessment?.codebase.lifecycle.value === 'ambiguous' ? '' : projectAssessment?.codebase.lifecycle.value === 'greenfield' ? 'greenfield' : 'existing');
  $('strategy').value = config.initialization?.existingCodeStrategy ?? 'keep-existing';
  $('depth').value = config.governanceDepth ?? 'standard';
  $('artifact-language').value = config.artifactLanguage ?? 'en';
  $('interaction-language').value = config.interactionLanguage ?? 'zh-CN';
  $('code-language').value = config.codeDocumentationPolicy ?? 'inherit-existing';
  $('case-format').value = config.testing?.caseFormat ?? 'aicg-json-v2';
  $('case-root').value = config.testing?.caseRoot ?? 'docs/ai/testing';
  $('report-root').value = config.testing?.reportRoot ?? 'reports/testing';
  $('report-language').value = config.testing?.reportLanguage ?? 'zh-CN';
  $('human-perspective').value = config.testing?.humanPerspective ?? 'ask';
  $('constraints').value = (config.domainConstraints ?? []).join('\n');
  lifecycleChanged();
  syncFeatureAvailability();
  syncSummaries();
  invalidate();
  dirty = false;
}

function lifecycleChanged() {
  $('strategy-wrap').hidden = $('lifecycle').value !== 'existing';
  const hint = $('stacks-hint');
  if (hint) hint.textContent = $('lifecycle').value === 'greenfield'
    ? '新项目还没有代码可扫描，请手动选择要用的技术。'
    : '已按扫描结果预选，只留真实用到的。';
}

// Governance scale and additional capabilities are related but distinct: the scale picks the
// base artifact set, while each capability is its own switch on top. The delivery loop cannot
// exist at the smallest scale, so disable it there instead of accepting a choice the generator
// would silently ignore, and remember it for when the scale grows again.
const minimalBlockedFeatures = {
  deliveryLoop: '「简单」规模不生成需求到测试闭环，选择「标准」或「完整」后可用。',
};

function syncFeatureAvailability() {
  const minimal = $('depth').value === 'minimal';
  for (const [id, note] of Object.entries(minimalBlockedFeatures)) {
    const input = document.querySelector('input[name="features"][value="' + id + '"]');
    if (!input) continue;
    const wrapper = input.closest('.choice');
    const detail = wrapper ? wrapper.querySelector('small') : null;
    if (minimal) {
      if (!input.disabled) { input.dataset.wanted = input.checked ? '1' : ''; input.checked = false; }
      input.disabled = true;
      wrapper?.classList.add('disabled');
      if (detail && !detail.dataset.original) { detail.dataset.original = detail.textContent; detail.textContent = note; }
    } else {
      if (input.disabled) { input.disabled = false; if (input.dataset.wanted === '1') input.checked = true; }
      wrapper?.classList.remove('disabled');
      if (detail?.dataset.original) { detail.textContent = detail.dataset.original; delete detail.dataset.original; }
    }
  }
}

function collect() {
  const config = structuredClone(base);
  // adaptiveDecisions is managed state, not an owner decision: it lives in
  // .ai-governance/config.json and a draft that carries it is rejected by aicg init --config.
  delete config.adaptiveDecisions;
  const clients = checked('clients');
  if (!clients.length) throw new Error('请至少选择一个 AI 编码工具。');
  if (!$('lifecycle').value) throw new Error('请先选择“已有业务代码”或“全新项目”。');
  // Built-in membership comes from the agent registry. The page shows a curated order, so an
  // all-built-in scope is emitted in registry order because the validator compares it exactly.
  const builtIn = builtInClients.length ? builtInClients : agentRegistry.filter((agent) => agent.builtIn).map((agent) => agent.id);
  const selected = new Set(clients);
  const allBuiltIn = builtIn.length > 0 && builtIn.every((id) => selected.has(id)) && clients.every((id) => builtIn.includes(id));
  const emitted = allBuiltIn ? builtIn : clients;
  config.clients = emitted;
  const recordedClients = base.clientSupport?.selectedClients ?? base.clients ?? [];
  config.clientSupport = { ...(config.clientSupport ?? {}), mode: allBuiltIn ? 'all-built-in' : 'selected', selectedClients: emitted,
    source: emitted.length === recordedClients.length && emitted.every((id, index) => id === recordedClients[index]) ? (base.clientSupport?.source ?? 'config') : 'config' };
  config.stacks = checked('stacks');
  if (!config.stacks.length) throw new Error('请至少选择一个项目用到的技术。');
  config.supportedOs = checked('oses');
  config.features = { ...(config.features ?? {}) };
  for (const key of Object.keys(featureLabels)) config.features[key] = checked('features').includes(key);
  config.features.brownfieldEnrichment = $('brownfield-enrichment').value;
  config.governanceDepth = $('depth').value;
  config.artifactLanguage = $('artifact-language').value;
  config.interactionLanguage = $('interaction-language').value;
  config.codeDocumentationPolicy = $('code-language').value;
  config.initialization = { ...(config.initialization ?? {}), lifecycle: $('lifecycle').value };
  if (config.initialization.lifecycle === 'existing') config.initialization.existingCodeStrategy = $('strategy').value;
  else delete config.initialization.existingCodeStrategy;
  if (!base.initialization?.source || base.initialization?.lifecycle !== config.initialization.lifecycle
    || (base.initialization?.existingCodeStrategy ?? null) !== (config.initialization.existingCodeStrategy ?? null)) {
    config.initialization.source = 'config';
  }
  config.testing = { ...(config.testing ?? {}), schemaVersion: 1, caseFormat: $('case-format').value, caseRoot: $('case-root').value.trim(), reportRoot: $('report-root').value.trim(), reportLanguage: $('report-language').value, humanPerspective: $('human-perspective').value };
  config.domainConstraints = $('constraints').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return config;
}

async function action(callback) {
  if (applying) return;
  try { await callback(); }
  catch (error) { if (error.name !== 'AbortError') message(error.message, true); }
}

const MAX_PREVIEW_FILES = 300;

function actionMeta(action) {
  if (action === 'create') return ['新增', 'create'];
  if (action === 'replace-owned') return ['覆盖', 'replace'];
  return ['更新', 'update'];
}

// Group planned files by their real repository directory so the owner reads the same tree
// they see on disk, instead of a flat path list.
function previewTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const entry of files) {
    const parts = entry.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push({ name: parts[parts.length - 1], action: entry.action });
  }
  return root;
}

function renderTree(node) {
  const list = document.createElement('ul'); list.className = 'tree';
  const dirs = [...node.dirs.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  const files = [...node.files].sort((left, right) => left.name.localeCompare(right.name));
  for (const [name, child] of dirs) {
    const item = document.createElement('li'); item.className = 'dir';
    const label = document.createElement('span'); label.className = 'dir-name'; label.textContent = name + '/';
    item.append(label, renderTree(child));
    list.append(item);
  }
  for (const file of files) {
    const meta = actionMeta(file.action);
    const item = document.createElement('li'); item.className = 'file ' + meta[1];
    const badge = document.createElement('span'); badge.className = 'badge-act ' + meta[1]; badge.textContent = meta[0];
    const name = document.createElement('span'); name.className = 'path-name'; name.textContent = file.name;
    item.append(badge, name);
    list.append(item);
  }
  return list;
}

function renderPreview(result) {
  const target = $('preview-result'); target.replaceChildren();
  target.classList.add('tree-view');
  const changed = result.files.filter((item) => item.changed);
  const creates = changed.filter((item) => item.action === 'create').length;
  const replacements = changed.filter((item) => item.action === 'replace-owned').length;
  const updates = changed.length - creates - replacements;
  const title = document.createElement('strong'); title.textContent = '变更预览（编号 ' + result.planHash.slice(0, 8) + '）';
  const info = document.createElement('p'); info.className = 'preview-counts';
  info.textContent = '共 ' + changed.length + ' 个文件变更：新增 ' + creates + '、更新 ' + updates + '、覆盖 ' + replacements + '。';
  target.append(title, info);
  const shown = changed.slice(0, MAX_PREVIEW_FILES);
  target.append(renderTree(previewTree(shown)));
  if (changed.length > shown.length) { const more = document.createElement('p'); more.textContent = '目录只展开前 ' + MAX_PREVIEW_FILES + ' 个文件，共 ' + changed.length + ' 个。'; target.append(more); }
  if (result.conflicts.length) { const warning = document.createElement('p'); warning.className = 'warn'; warning.textContent = '需要先处理：' + result.conflicts.join('；'); target.append(warning); }
  if (result.skippedMembers?.length) { const note = document.createElement('p'); note.textContent = '已跳过未初始化的子模块：' + result.skippedMembers.join('、') + '。'; target.append(note); }
  if (result.linksToMigrate.length) { const warning = document.createElement('p'); warning.className = 'warn'; warning.textContent = '有 ' + result.linksToMigrate.length + ' 个链接需要迁移，页面不会自动处理。'; target.append(warning); }
}

function renderRecent(paths) {
  const target = $('recent-projects'); target.replaceChildren();
  if (!paths.length) { const empty = document.createElement('p'); empty.className = 'empty-recent'; empty.textContent = '还没有最近项目。'; target.append(empty); return; }
  for (const projectPath of paths) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = projectPath;
    button.addEventListener('click', () => action(() => selectProject(projectPath)));
    target.append(button);
  }
}

function renderMatches(paths, label) {
  const target = $('drop-matches');
  target.replaceChildren();
  if (!paths.length) { target.hidden = true; return; }
  const heading = document.createElement('h3'); heading.textContent = label; target.append(heading);
  for (const candidate of paths) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = candidate;
    button.addEventListener('click', () => action(() => selectProject(candidate)));
    target.append(button);
  }
  target.hidden = false;
}

function showSelector() {
  invalidate();
  renderMatches([], '');
  renderTrustWarning(null);
  $('workspace').hidden = true;
  $('selector').hidden = false;
  $('cancel-switch').hidden = !currentRoot;
  $('project-line').hidden = !currentRoot;
  $('project').textContent = currentRoot ? currentRoot + '（等待切换）' : '尚未选择';
  $('switch-project').hidden = true;
  $('hero-note').textContent = '选一个项目，我按它的实际情况生成治理框架。全部在本机完成，不会上传。';
  $('choose-folder').hidden = !nativePickerAvailable;
  $('browse-toggle').hidden = nativePickerAvailable;
  if (nativePickerAvailable) $('browser-box').hidden = true;
  $('open-project').disabled = !$('project-path').value.trim();
}

function showProject(data) {
  currentRoot = data.root;
  home = data.home;
  agentRegistry = data.agents ?? [];
  builtInClients = data.builtInClients ?? agentRegistry.filter((agent) => agent.builtIn).map((agent) => agent.id);
  renderRecent(data.recent ?? []);
  renderTrustWarning(data.managedTrust);
  $('project').textContent = data.root;
  $('project-path').value = data.root;
  $('project-line').hidden = false;
  $('hero-note').textContent = '我已经看过这个项目，确认下面几项就行。全部在本机完成，不会上传。';
  $('selector').hidden = true;
  $('browser-box').hidden = true;
  $('workspace').hidden = false;
  $('switch-project').hidden = false;
  sha = data.sha;
  projectAssessment = data.assessment;
  const classification = data.assessment.codebase;
  // `template` is what the server restored: the applied governance config when one exists,
  // otherwise the editable draft, otherwise the scan-backed defaults.
  const selected = data.template ?? data.config ?? {};
  const source = data.configSource === 'editable' ? '项目里的配置文件' : data.configSource === 'managed' ? '已应用的治理配置' : '工程扫描结果';
  $('assessment-summary').textContent = !data.scanComplete ? '扫描没跑完，先帮我确认一下这些选择。'
    : classification.lifecycle.value === 'existing' ? '我看了一下这个项目：已有业务代码。'
      : classification.lifecycle.value === 'greenfield' ? '我看了一下这个项目：还是空白的新项目。'
        : '我拿不准这个项目的状态，帮我确认一下。';
  const family = data.repositoryFamily;
  renderFamilyScope(family);
  $('greet-sub').textContent = family?.family
    ? '这是仓库族：本次将治理 ' + (family.members?.length ?? 0) + ' 个成员仓' + (family.members?.length ? '（' + family.members.join('、') + '）' : '') + (family.skipped?.length ? '；另有 ' + family.skipped.length + ' 个未拉取成员仓' : '') + '。'
    : '项目：' + data.root + ' · 帮我确认下面几件事就行。';
  const details = $('assessment-details'); details.replaceChildren();
  for (const line of [
    { text: '依据：' + (classification.evidence.sourceFiles.slice(0, 3).join('、') || classification.evidence.manifests.slice(0, 3).join('、') || '未发现业务代码') },
    { id: 'config-source', text: '配置来源：' + source },
    { text: '技术栈：' + ((selected.stacks ?? []).map((id) => stackLabels[id] ?? id).join('、') || '尚未识别') },
    { text: 'AI 工具：' + ((selected.clientSupport?.selectedClients ?? selected.clients ?? []).join('、')) },
    { text: '仓库族：' + (family?.family ? ((family.members?.length ?? 0) + ' 个成员仓' + (family.skipped?.length ? '，' + family.skipped.length + ' 个未拉取' : '')) : '否') },
  ]) { const item = document.createElement('div'); if (line.id) item.id = line.id; item.textContent = line.text; details.append(item); }
  choices('clients', 'clients', data.agents, selected.clients ?? [], (id) => clientHints[id]);
  choices('stacks', 'stacks', data.stacks.map(({ id }) => ({ id, label: stackLabels[id] ?? id })), selected.stacks ?? [],
    (id) => familyLabels[data.stacks.find((item) => item.id === id)?.family] ?? '仅在项目实际采用时选择');
  choices('oses', 'oses', Object.keys(osLabels).map((id) => ({ id, label: osLabels[id] })), selected.supportedOs ?? []);
  choices('features', 'features', Object.entries(featureLabels).map(([id, values]) => ({ id, label: values[0] })), Object.entries(selected.features ?? {}).filter(([, enabled]) => enabled).map(([id]) => id),
    (id) => featureLabels[id]?.[1] ?? '');
  fill(selected);
  if (data.configSource === 'managed') message(data.config
    ? '已还原项目里已应用的治理框架；项目里的 aicg.config.json 草稿仍然保留，可用下面的「导入 / 导出配置」载入。改完点最下面的按钮。'
    : '已还原项目里已应用的治理框架。改完点最下面的按钮。');
  else if (data.config) message('已载入项目里的配置。改完点最下面的按钮。');
  else if (data.detectedClients?.length) {
    const names = data.detectedClients.map((id) => { const found = agentRegistry.find((agent) => agent.id === id); return found ? found.label : id; });
    message('本机检测到 ' + names.join('、') + '，已默认勾选。确认没问题就点最下面的按钮。');
  } else message('已按扫描结果填好，确认没问题就点最下面的按钮。');
}

// The server scans and plans synchronously before it answers, so a large repository takes a
// while and the wait cannot stream real per-file progress from the blocked event loop. An
// honest indeterminate indicator with elapsed time and stage labels keeps the page alive.
const SCAN_STAGES = [
  { at: 0, text: '正在扫描文件…' },
  { at: 4, text: '正在识别技术栈和开发单元…' },
  { at: 12, text: '正在规划治理产物…' },
];
let scanTimer = null;
let scanStartedAt = 0;
// Repository-family scope: the owner picks which member repositories this generation
// touches. Default is every scanned member; a deselected member is never planned or written.
function renderFamilyScope(family) {
  const scope = $('family-scope');
  const box = $('family-members');
  if (!scope || !box) return;
  box.replaceChildren();
  const members = family?.family ? (family.members ?? []) : [];
  if (!members.length) { scope.hidden = true; return; }
  for (const member of members) {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'family-members'; input.value = member; input.checked = true;
    const span = document.createElement('span'); span.textContent = member;
    label.append(input, span);
    box.append(label);
  }
  scope.hidden = false;
}

function familyMembers() {
  const boxes = [...document.querySelectorAll('input[name="family-members"]')];
  if (!boxes.length) return null;
  return boxes.filter((box) => box.checked).map((box) => box.value);
}

// Poll the worker's progress directly; api() aborts the in-flight request, so it cannot be used here.
function startProgressPolling(write) {
  const interval = setInterval(async () => {
    try {
      const response = await fetch('/api/progress', { headers: { 'x-aicg-session': session } });
      if (!response.ok) return;
      const progress = (await response.json()).progress;
      if (progress) write(progress);
    } catch { /* a transient poll failure never blocks the scan */ }
  }, 700);
  return () => clearInterval(interval);
}

function setScanning(active, title, note) {
  const box = $('scanning');
  if (!box) return;
  if (active) {
    if (title) $('scanning-title').textContent = title;
    scanStartedAt = Date.now();
    const tick = () => {
      const seconds = Math.round((Date.now() - scanStartedAt) / 1000);
      const stage = [...SCAN_STAGES].reverse().find((entry) => seconds >= entry.at) ?? SCAN_STAGES[0];
      $('scanning-note').textContent = stage.text + ' 已用 ' + seconds + ' 秒。' + (note || '读取技术栈、开发单元和验证命令。');
    };
    tick();
    clearInterval(scanTimer);
    scanTimer = setInterval(tick, 1000);
    box.hidden = false;
  } else {
    clearInterval(scanTimer);
    scanTimer = null;
    box.hidden = true;
  }
}

async function selectProject(projectPath) {
  if (selecting) return;
  selecting = true;
  invalidate();
  setScanning(true, '正在扫描仓库…', '读取技术栈、开发单元和验证命令。');
  const stopPoll = startProgressPolling((progress) => {
    const seconds = Math.round((Date.now() - scanStartedAt) / 1000);
    const note = '正在扫描…已发现 ' + progress.entries + ' 个文件，其中 ' + progress.files + ' 个代码文件；已用 ' + seconds + ' 秒。';
    $('scanning-note').textContent = note;
    showToast(note);
  });
  try {
    const data = await api('project', { path: projectPath });
    showProject(data);
  } finally { stopPoll(); selecting = false; setScanning(false); }
}

async function browse(directory) {
  if (selecting) return;
  const data = await api('directories?path=' + encodeURIComponent(directory));
  browseLocation = data.directory;
  $('browser-box').hidden = false;
  $('browse-path').textContent = data.directory;
  $('browse-up').disabled = !data.parent;
  $('browse-up').dataset.parent = data.parent ?? '';
  const target = $('browse-entries'); target.replaceChildren();
  if (!data.directories.length) { const empty = document.createElement('div'); empty.className = 'browse-empty'; empty.textContent = '此目录下没有可浏览的子文件夹。'; target.append(empty); }
  for (const name of data.directories) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '📁 ' + name;
    button.addEventListener('click', () => action(() => browse(data.directory + (data.directory.endsWith('/') ? '' : '/') + name)));
    target.append(button);
  }
}

async function bootstrap() {
  setScanning(true);
  try {
    const data = await api('bootstrap');
    home = data.home;
    nativePickerAvailable = data.nativePicker === true;
    renderRecent(data.recent ?? []);
    if (data.root) showProject(data);
    else showSelector();
  } finally { setScanning(false); }
}

async function chooseFolder() {
  message('请在弹出的系统窗口里选择项目文件夹…');
  const result = await api('choose-folder', {});
  if (!result.path) { message('已取消选择。'); return; }
  $('project-path').value = result.path;
  await selectProject(result.path);
}

// A browser hides the absolute path of a folder dragged from Finder, so a drop selects
// directly only when the browser exposes a file URL or path; otherwise it opens the OS dialog.
function droppedPath(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return null;
  const candidates = [];
  for (const type of ['text/uri-list', 'text/plain']) {
    const value = transfer.getData(type);
    if (value) candidates.push(...value.split(/\r?\n/));
  }
  const file = transfer.files?.[0];
  if (file?.path) candidates.push(file.path);
  for (const candidate of candidates) {
    let value = candidate.trim().replace(/^file:\/\//, '');
    if (!value) continue;
    try { value = decodeURIComponent(value); } catch { /* keep the raw value */ }
    while (value.length > 1 && (value.endsWith('/') || value.endsWith('\\'))) value = value.slice(0, -1);
    if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return value;
  }
  return null;
}

function readDroppedDirectory(entry) {
  return new Promise((resolve) => {
    const reader = entry.createReader();
    const collected = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length || collected.length >= 60) { resolve(collected.slice(0, 60)); return; }
        for (const child of batch) { if (collected.length < 60) collected.push({ name: child.name, dir: child.isDirectory }); }
        readBatch();
      }, () => resolve(collected.slice(0, 60)));
    };
    readBatch();
  });
}

// The browser cannot name the dropped folder's path, but it can name its children. Send that
// fingerprint to the local server, which finds the matching directory on disk.
async function handleDrop(event) {
  const path = droppedPath(event);
  if (path) { $('project-path').value = path; return selectProject(path); }
  let droppedDirectory = null;
  for (const candidate of [...(event.dataTransfer?.items ?? [])]) {
    if (candidate.kind !== 'file' || typeof candidate.webkitGetAsEntry !== 'function') continue;
    const entry = candidate.webkitGetAsEntry();
    if (entry?.isDirectory) { droppedDirectory = entry; break; }
  }
  if (droppedDirectory) {
    message('正在本机查找这个文件夹…');
    const entries = await readDroppedDirectory(droppedDirectory);
    const located = await api('locate', { name: droppedDirectory.name, entries });
    if (located.matches.length === 1) { $('project-path').value = located.matches[0]; return selectProject(located.matches[0]); }
    if (located.matches.length > 1) { renderMatches(located.matches, '找到多个同名文件夹，请点选一个：'); message('找到多个同名文件夹，请在下面点选。', true); return undefined; }
  }
  if (nativePickerAvailable) {
    message('本机没找到这个文件夹，已为你打开系统选择框。');
    return chooseFolder();
  }
  message('浏览器拿不到拖入文件夹的完整路径，请手动输入路径或用「浏览文件夹」。', true);
  return undefined;
}

$('choose-folder').addEventListener('click', () => action(chooseFolder));
$('selector').addEventListener('dragover', (event) => { event.preventDefault(); $('selector').classList.add('dropping'); });
$('selector').addEventListener('dragleave', () => $('selector').classList.remove('dropping'));
$('selector').addEventListener('drop', (event) => { event.preventDefault(); $('selector').classList.remove('dropping'); action(() => handleDrop(event)); });

document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const panel = $('edit-' + button.dataset.toggle);
    const open = panel.hidden;
    panel.hidden = !open;
    button.textContent = open ? '收起' : button.dataset.closed;
  });
});

$('project-form').addEventListener('submit', (event) => { event.preventDefault(); action(() => selectProject($('project-path').value.trim())); });
$('project-path').addEventListener('input', () => { $('open-project').disabled = !$('project-path').value.trim(); });
$('switch-project').addEventListener('click', () => {
  if (dirty && !window.confirm('当前页面有未保存的修改。确定切换项目并放弃这些修改吗？')) return;
  showSelector(); message('请选择另一个项目；在确认选择前，当前项目不会改变。');
});
$('cancel-switch').addEventListener('click', () => { $('selector').hidden = true; $('workspace').hidden = false; $('switch-project').hidden = false; $('project').textContent = currentRoot; });
$('browse-toggle').addEventListener('click', () => action(() => browse($('project-path').value.trim() || home)));
$('browse-up').addEventListener('click', () => action(() => browse($('browse-up').dataset.parent)));
$('browse-use').addEventListener('click', () => action(() => selectProject(browseLocation)));
$('import-export-toggle').addEventListener('click', () => { const box = $('import-export'); box.hidden = !box.hidden; });

$('editor').addEventListener('input', () => { invalidate(); dirty = true; lifecycleChanged(); syncFeatureAvailability(); syncSummaries(); });
$('editor').addEventListener('change', () => { invalidate(); dirty = true; lifecycleChanged(); syncFeatureAvailability(); syncSummaries(); });

async function previewConfiguration() {
  const mark = generation;
  const result = await api('preview', { members: familyMembers() ?? undefined });
  if (mark !== generation) {
    // The page changed while the preview ran, so this result no longer describes what the
    // owner sees. Say so instead of silently re-enabling the button with an empty preview.
    renderPreviewError('页面状态在预览期间发生变化，这次预览已作废，请重新点击预览。');
    return;
  }
  previewHash = result.planHash;
  const blocked = result.conflicts.length > 0 || result.linksToMigrate.length > 0;
  $('apply').hidden = false;
  $('apply').disabled = blocked;
  // The file list is now on screen, so the preview button is redundant: the owner either applies
  // or edits the configuration, and an edit restores the button. Keep it only when the preview is
  // blocked, so the owner can re-preview after fixing the reported problem.
  const previewButton = $('save-preview');
  if (previewButton) previewButton.hidden = !blocked;
  renderPreview(result);
  message(blocked ? '预览完成，但有需要先处理的问题，暂时不能应用。' : '预览完成。确认文件列表后即可应用到项目。', blocked);
}
// One action saves and previews, replacing the old separate 校验/保存/预览 buttons.
async function saveAndPreview() {
  const config = collect();
  const saved = await api('save', { config, expectedSha: sha });
  sha = saved.sha;
  base = structuredClone(config);
  dirty = false;
  const sourceLine = $('config-source');
  if (sourceLine) sourceLine.textContent = '配置来源：项目里的配置文件';
  invalidate();
  setPreviewing(true);
  try {
    await previewConfiguration();
  } catch (error) {
    // An aborted preview used to vanish silently: the button re-enabled with no result and no
    // explanation. Always tell the owner what happened and keep the state on screen.
    const text = error.name === 'AbortError'
      ? '预览被中断（页面状态已变化），请重新点击预览。'
      : error.message;
    renderPreviewError(text);
    message(text, true);
  } finally { setPreviewing(false); }
  showHandoff();
}

// Preview re-scans the whole repository and plans every artifact, which on a large or
// repository-family project can take tens of seconds. Disable the button and show what is
// happening instead of leaving the preview area empty.
let previewPollStop = null;
function setPreviewing(active) {
  const button = $('save-preview');
  if (active) {
    if (button) button.disabled = true;
    $('workspace').setAttribute('aria-busy', 'true');
    message('正在预览要生成的治理文件…大型或仓库族项目可能需要几十秒，请勿重复点击。');
    renderPreviewPending();
    scanStartedAt = Date.now();
    previewPollStop = startProgressPolling((progress) => {
      const note = '正在预览…已发现 ' + progress.entries + ' 个文件，其中 ' + progress.files + ' 个代码文件；已用 ' + Math.round((Date.now() - scanStartedAt) / 1000) + ' 秒。';
      $('notice').textContent = note;
      showToast(note);
    });
  } else {
    if (previewPollStop) { previewPollStop(); previewPollStop = null; }
    if (button) button.disabled = false;
    $('workspace').removeAttribute('aria-busy');
  }
}

function renderPreviewError(text) {
  const target = $('preview-result');
  if (!target) return;
  target.replaceChildren();
  const box = document.createElement('p');
  box.className = 'preview-counts';
  box.textContent = text;
  target.append(box);
}

function renderPreviewPending() {
  const target = $('preview-result');
  if (!target) return;
  target.replaceChildren();
  const box = document.createElement('p');
  box.className = 'preview-counts';
  box.textContent = '正在预览…（大型或仓库族项目可能需要几十秒）';
  target.append(box);
}
// The page owns the owner decisions; the coding agent owns the semantic completion.
function handoffPrompt() {
  const target = currentRoot || '<项目路径>';
  return [
    '用 aicg 为当前项目生成治理框架（项目：' + target + '）。',
    '按项目里的 aicg.config.json 执行；需要我确认或选择时再问我。不要修改业务代码。',
    '问我时用业务语言：说清楚「要改什么、对我有什么影响、有什么风险」，给 2-3 个选项；不要出现 planHash、manifest、adaptiveDecisions 这类内部名词或哈希。',
  ].join('\n');
}
function showHandoff() {
  const box = $('handoff'); const text = $('handoff-text');
  if (!box || !text) return;
  text.value = handoffPrompt();
  box.hidden = false;
}

$('family-scope')?.addEventListener('change', invalidate);
$('save-preview').addEventListener('click', () => action(saveAndPreview));
$('apply').addEventListener('click', () => action(async () => {
  if (!previewHash || !window.confirm('确认将计划 ' + previewHash + ' 应用到当前项目？')) return;
  const hash = previewHash; invalidate();
  setApplying(true);
  try {
    const result = await api('apply', { planHash: hash, members: familyMembers() ?? undefined });
    const review = result.governanceReview;
    message(review
      ? '治理文件已应用并通过结构校验。独立复核：' + review.status + '；证据评分：' + review.score + '/100。报告：' + review.reportPath + '。'
      : '治理文件已应用，项目校验通过。');
  } finally { setApplying(false); }
}));
$('download').addEventListener('click', () => action(async () => {
  const config = collect();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = downloadUrl; link.download = 'aicg.config.json'; link.click();
  message('已下载当前页面的配置。分享前请检查其中的项目专属信息。');
}));
$('upload').addEventListener('change', () => action(async () => {
  const file = $('upload').files[0]; if (!file) return;
  if (file.size > 128 * 1024) throw new Error('配置文件不能超过 128 KiB。');
  const config = JSON.parse(await file.text());
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('请选择 JSON 配置对象。');
  fill(config); dirty = true; $('upload').value = ''; message('已载入上传的配置，尚未写入项目。请检查后保存。');
}));
$('handoff-copy')?.addEventListener('click', () => action(async () => {
  const text = $('handoff-text')?.value ?? '';
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); message('提示词已复制，粘贴给你的 AI 编程助手即可。'); }
  else { $('handoff-text').select(); document.execCommand('copy'); message('提示词已复制。'); }
}));
$('close').addEventListener('click', () => action(async () => { await api('close', {}); message('本地配置服务已关闭，可关闭此标签页。'); }));
window.addEventListener('pagehide', () => { if (!applying) controller?.abort(); if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
action(bootstrap);
