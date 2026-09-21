const session = document.querySelector('meta[name="aicg-session"]').content;
const $ = (id) => document.getElementById(id);
const featureLabels = {
  knowledge: ['项目知识', '维护可追溯的项目知识与约定。'],
  taskRuntime: ['任务运行时', '生成更完整的任务执行结构。'],
  hooks: ['Git 钩子', '启用提交前治理检查入口。'],
  externalWorkflows: ['外部工作流', '生成与外部流程衔接的治理材料。'],
  ciIntegration: ['CI 集成', '生成持续集成相关治理入口。'],
  aiAssist: ['AI 辅助与独立复核', '应用后由新 Agent 只读复核并评分；当前已验证的自动复核适配器为 Codex。旧项目代码理解补全仍需单独确认。'],
};
const osLabels = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
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

function message(value, error = false) {
  $('notice').textContent = value;
  $('notice').classList.toggle('error', error);
}

function invalidate() {
  generation += 1;
  controller?.abort();
  controller = null;
  previewHash = null;
  $('apply').disabled = true;
  $('preview-result').replaceChildren();
}

async function api(route, body) {
  controller?.abort();
  controller = new AbortController();
  const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-aicg-session': session, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  const result = await response.json();
  if (!response.ok) {
    const details = Array.isArray(result.verificationErrors) ? result.verificationErrors : [];
    throw new Error([result.error || `HTTP ${response.status}`, ...details].join('\n'));
  }
  return result;
}

function setApplying(active) {
  applying = active;
  if (active) {
    applyControls = [...document.querySelectorAll('button, input, select, textarea')].map((control) => ({ control, disabled: control.disabled }));
    for (const { control } of applyControls) control.disabled = true;
    $('workspace').setAttribute('aria-busy', 'true');
    $('notice').classList.add('busy');
    message('正在应用治理配置并校验项目，请稍候…');
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
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function fill(config, saved = false) {
  base = structuredClone(config);
  const clients = config.clientSupport?.selectedClients ?? config.clients ?? [];
  document.querySelectorAll('input[name="clients"]').forEach((input) => { input.checked = clients.includes(input.value); });
  document.querySelectorAll('input[name="stacks"]').forEach((input) => { input.checked = (config.stacks ?? []).includes(input.value); });
  document.querySelectorAll('input[name="oses"]').forEach((input) => { input.checked = (config.supportedOs ?? []).includes(input.value); });
  document.querySelectorAll('input[name="features"]').forEach((input) => { input.checked = Boolean(config.features?.[input.value]); });
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
  invalidate();
  $('preview').disabled = !saved;
  dirty = false;
}

function lifecycleChanged() {
  $('strategy-wrap').hidden = $('lifecycle').value !== 'existing';
}

function collect() {
  const config = structuredClone(base);
  const clients = checked('clients');
  if (!clients.length) throw new Error('至少选择一个 AI 编码工具。');
  if (!$('lifecycle').value) throw new Error('扫描无法确定项目状态，请选择现有项目或新项目。');
  config.clients = clients;
  const builtIn = ['codex', 'claude-code', 'cursor'];
  const recordedClients = base.clientSupport?.selectedClients ?? base.clients ?? [];
  config.clientSupport = { ...(config.clientSupport ?? {}), mode: clients.length === 3 && builtIn.every((id, index) => clients[index] === id) ? 'all-built-in' : 'selected', selectedClients: clients,
    source: clients.length === recordedClients.length && clients.every((id, index) => id === recordedClients[index]) ? (base.clientSupport?.source ?? 'config') : 'config' };
  config.stacks = checked('stacks');
  config.supportedOs = checked('oses');
  config.features = { ...(config.features ?? {}) };
  for (const key of Object.keys(featureLabels)) config.features[key] = checked('features').includes(key);
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

function renderPreview(result) {
  const target = $('preview-result'); target.replaceChildren();
  const title = document.createElement('strong'); title.textContent = `计划 ${result.planHash.slice(0, 12)}…`;
  const replacements = result.files.filter((item) => item.action === 'replace-owned').length;
  const info = document.createElement('p'); info.textContent = `涉及 ${result.files.length} 个文件，其中覆盖 ${replacements} 个；权限：${result.requiredPermissions.join('、') || '无写入'}`;
  const list = document.createElement('ul');
  for (const entry of result.files.filter((item) => item.changed).slice(0, 30)) {
    const line = document.createElement('li'); line.textContent = `${entry.action === 'replace-owned' ? '覆盖' : entry.action === 'create' ? '新增' : '更新'}：${entry.path}`; list.append(line);
  }
  target.append(title, info, list);
  if (result.conflicts.length) { const warning = document.createElement('p'); warning.textContent = `冲突：${result.conflicts.join('；')}`; target.append(warning); }
  if (result.skippedMembers?.length) { const note = document.createElement('p'); note.textContent = `已跳过未初始化子模块：${result.skippedMembers.join('、')}。`; target.append(note); }
  if (result.linksToMigrate.length) { const warning = document.createElement('p'); warning.textContent = `需迁移链接：${result.linksToMigrate.length}。当前页面不会自动授权迁移。`; target.append(warning); }
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

function showSelector() {
  invalidate();
  $('workspace').hidden = true;
  $('selector').hidden = false;
  $('cancel-switch').hidden = !currentRoot;
  $('project').textContent = currentRoot ? `${currentRoot}（等待切换）` : '尚未选择';
  $('switch-project').hidden = true;
}

function showProject(data) {
  currentRoot = data.root;
  home = data.home;
  renderRecent(data.recent ?? []);
  $('project').textContent = data.root;
  $('project-path').value = data.root;
  $('selector').hidden = true;
  $('browser-box').hidden = true;
  $('workspace').hidden = false;
  $('switch-project').hidden = false;
  sha = data.sha;
  projectAssessment = data.assessment;
  const classification = data.assessment.codebase;
  const existing = classification.lifecycle.value === 'existing' && classification.lifecycle.confidence === 'high' && data.scanComplete;
  const selected = data.config ?? data.template;
  const source = data.configSource === 'editable' ? '项目配置' : data.configSource === 'managed' ? '已应用治理配置' : '工程扫描';
  $('project-summary').hidden = false;
  $('assessment-summary').textContent = !data.scanComplete ? '扫描未完成，请检查工程后确认配置。'
    : classification.lifecycle.value === 'existing' ? '检测到已有业务代码，已形成基础配置。'
      : classification.lifecycle.value === 'greenfield' ? '检测到空白新项目，请选择目标工程配置。'
        : '只有项目清单或无法判定的文件，请先确认项目状态。';
  $('assessment-details').replaceChildren();
  for (const line of [
    `依据：${classification.evidence.sourceFiles.slice(0, 3).join('、') || classification.evidence.manifests.slice(0, 3).join('、') || '未发现业务代码'}`,
    `配置来源：${source}`,
    `技术栈：${(selected.stacks ?? []).map((id) => stackLabels[id] ?? id).join('、') || '尚未识别'}`,
    `AI 编码工具：${(selected.clientSupport?.selectedClients ?? selected.clients ?? []).join('、')}`,
  ]) { const item = document.createElement('div'); item.textContent = line; $('assessment-details').append(item); }
  $('configuration-fields').hidden = existing;
  $('edit-settings').hidden = !existing;
  $('edit-settings').textContent = '调整识别结果和配置';
  $('quick-preview').hidden = !existing;
  $('quick-preview').textContent = data.config ? '直接预览现有配置' : '使用识别结果并预览';
  for (const id of ['validate', 'save', 'preview']) $(id).hidden = existing;
  choices('clients', 'clients', data.agents, (data.config ?? data.template).clients,
    (id) => ({ codex: '生成 AGENTS.md 与 .agents/skills 入口', 'claude-code': '生成 CLAUDE.md 与 .claude/skills 入口', cursor: '生成 Cursor 规则与技能入口', generic: '通用 AGENTS.md 兼容客户端' })[id]);
  choices('stacks', 'stacks', data.stacks.map(({ id }) => ({ id, label: stackLabels[id] ?? id })), (data.config ?? data.template).stacks,
    (id) => familyLabels[data.stacks.find((item) => item.id === id)?.family] ?? '仅在项目实际采用时选择');
  choices('oses', 'oses', Object.keys(osLabels).map((id) => ({ id, label: osLabels[id] })), (data.config ?? data.template).supportedOs);
  choices('features', 'features', Object.entries(featureLabels).map(([id, values]) => ({ id, label: values[0] })), Object.entries((data.config ?? data.template).features).filter(([, enabled]) => enabled).map(([id]) => id),
    (id) => featureLabels[id]?.[1] ?? '');
  fill(selected, Boolean(data.config));
  message(existing ? '已识别现有工程。核对判断摘要后可以直接预览治理变更。' : data.config ? '已载入项目中的配置。修改后先校验，再保存。' : '已按项目扫描生成初始选择；尚未写入文件。');
}

async function selectProject(projectPath) {
  if (selecting) return;
  selecting = true;
  invalidate();
  try {
    const data = await api('project', { path: projectPath });
    showProject(data);
  } finally { selecting = false; }
}

async function browse(directory) {
  if (selecting) return;
  const data = await api(`directories?path=${encodeURIComponent(directory)}`);
  browseLocation = data.directory;
  $('browser-box').hidden = false;
  $('browse-path').textContent = data.directory;
  $('browse-up').disabled = !data.parent;
  $('browse-up').dataset.parent = data.parent ?? '';
  const target = $('browse-entries'); target.replaceChildren();
  if (!data.directories.length) { const empty = document.createElement('div'); empty.className = 'browse-empty'; empty.textContent = '此目录下没有可浏览的子文件夹。'; target.append(empty); }
  for (const name of data.directories) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `📁 ${name}`;
    button.addEventListener('click', () => action(() => browse(`${data.directory}${data.directory.endsWith('/') ? '' : '/'}${name}`)));
    target.append(button);
  }
}

async function bootstrap() {
  const data = await api('bootstrap');
  home = data.home;
  renderRecent(data.recent ?? []);
  if (data.root) showProject(data);
  else { showSelector(); message('请先选择要配置的项目。'); }
}

$('project-form').addEventListener('submit', (event) => { event.preventDefault(); action(() => selectProject($('project-path').value.trim())); });
$('switch-project').addEventListener('click', () => {
  if (dirty && !window.confirm('当前页面有未保存的修改。确定切换项目并放弃这些修改吗？')) return;
  showSelector(); message('请选择另一个项目；在确认选择前，当前项目不会改变。');
});
$('cancel-switch').addEventListener('click', () => { $('selector').hidden = true; $('workspace').hidden = false; $('switch-project').hidden = false; $('project').textContent = currentRoot; });
$('browse-toggle').addEventListener('click', () => action(() => browse($('project-path').value.trim() || home)));
$('browse-up').addEventListener('click', () => action(() => browse($('browse-up').dataset.parent)));
$('browse-use').addEventListener('click', () => action(() => selectProject(browseLocation)));
$('edit-settings').addEventListener('click', () => {
  const expanded = $('configuration-fields').hidden;
  $('configuration-fields').hidden = !expanded;
  $('edit-settings').textContent = expanded ? '收起配置选项' : '调整识别结果和配置';
  $('quick-preview').hidden = expanded;
  for (const id of ['validate', 'save', 'preview']) $(id).hidden = !expanded;
});

$('editor').addEventListener('input', () => { invalidate(); dirty = true; $('preview').disabled = true; lifecycleChanged(); });
$('editor').addEventListener('change', () => { invalidate(); dirty = true; $('preview').disabled = true; lifecycleChanged(); });
$('validate').addEventListener('click', () => action(async () => {
  const mark = generation; const result = await api('validate', { config: collect() });
  if (mark === generation) message(`配置有效：${result.lifecycle === 'existing' ? '现有项目' : '新项目'}，预计 ${result.operations} 项操作${result.conflicts.length ? `，存在 ${result.conflicts.length} 个冲突：\n${result.conflicts.join('\n')}` : ''}。`);
}));
async function saveConfiguration() {
  const config = collect(); const mark = generation;
  const result = await api('save', { config, expectedSha: sha });
  if (mark !== generation) { message('保存期间表单已变化；请重新检查并保存。', true); return; }
  sha = result.sha; base = structuredClone(config); invalidate(); dirty = false; $('preview').disabled = false; message('配置已保存到项目中的 aicg.config.json。');
  $('quick-preview').textContent = '直接预览现有配置';
  $('assessment-details').children[1].textContent = '配置来源：项目配置';
}
async function previewConfiguration() {
  const mark = generation; const result = await api('preview', {});
  if (mark !== generation) return;
  previewHash = result.planHash; $('apply').disabled = Boolean(result.conflicts.length || result.linksToMigrate.length);
  renderPreview(result); message('预览完成。只有保存后的配置会用于应用；请核对文件列表。');
}
$('save').addEventListener('click', () => action(saveConfiguration));
$('preview').addEventListener('click', () => action(previewConfiguration));
$('quick-preview').addEventListener('click', () => action(async () => {
  if (!sha || dirty) await saveConfiguration();
  if (sha) await previewConfiguration();
}));
$('apply').addEventListener('click', () => action(async () => {
  if (!previewHash || !window.confirm(`确认将计划 ${previewHash} 应用到当前项目？`)) return;
  const hash = previewHash; invalidate();
  setApplying(true);
  try {
    const result = await api('apply', { planHash: hash });
    const review = result.governanceReview;
    message(review
      ? `治理文件已应用并通过结构校验。独立评审：${review.status}；证据评分：${review.score}/100（${review.scoreStatus}）。报告：${review.reportPath}。`
      : '治理文件已应用，项目校验通过。');
  } finally { setApplying(false); }
}));
$('download').addEventListener('click', () => action(async () => {
  const config = collect();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = downloadUrl; link.download = 'aicg.config.json'; link.click();
  message('已下载当前页面的配置。共享前请检查其中的项目专属信息。');
}));
$('upload').addEventListener('change', () => action(async () => {
  const file = $('upload').files[0]; if (!file) return;
  if (file.size > 128 * 1024) throw new Error('配置文件不能超过 128 KiB。');
  const config = JSON.parse(await file.text());
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('请选择 JSON 配置对象。');
  fill(config); dirty = true; $('upload').value = ''; message('已载入上传的配置，尚未写入项目。请校验后保存。');
  $('configuration-fields').hidden = false; $('quick-preview').hidden = true;
  for (const id of ['validate', 'save', 'preview']) $(id).hidden = false;
}));
$('close').addEventListener('click', () => action(async () => { await api('close', {}); message('本地配置服务已关闭，可关闭此标签页。'); }));
window.addEventListener('pagehide', () => { if (!applying) controller?.abort(); if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
action(bootstrap);
