const STATE_TEXT = Object.freeze({
  draft: ['需求草稿', '补充业务目标并确认关键问题'],
  'requirements-pending': ['等待确认需求', '确认业务需求中的关键问题'],
  'requirements-approved': ['等待架构确认', '审阅并确认架构方案'],
  'architecture-ready': ['等待实施计划', '审阅并确认有边界的实施计划'],
  'plan-approved': ['计划已确认', '在已批准权限内启动实施'],
  executing: ['正在实施', '等待当前实施步骤完成'],
  verifying: ['正在验证', '等待必需的验证结果'],
  repairing: ['正在修复', '修复失败项并重做受影响的验证'],
  'review-ready': ['等待审阅', '完成所需的独立审阅和人工确认'],
  blocked: ['交付受阻', '先解决已记录的阻塞原因'],
  failed: ['交付失败', '核对失败原因与可恢复的检查点'],
  completed: ['交付已完成', '核对保留的证据和回退说明'],
  cancelled: ['交付已取消', '如需继续，请创建新会话'],
});
const EVIDENCE_TEXT = Object.freeze({ incomplete: '证据未齐', passed: '证据通过', failed: '证据失败' });

function guidedText(data) {
  const blocked = data.guided?.status === 'blocked' ||
    (['review-ready', 'completed'].includes(data.state) && data.guided?.evidence?.status !== 'passed');
  if (blocked) return ['交付受阻', '证据未齐或已失效，不得作为已完成交付；请核对并重做所需验证'];
  return STATE_TEXT[data.state] ?? ['状态待核对', '请从命令行核对规范会话状态'];
}

export function mountStudio(doc = document, dependencies = {}) {
  const fetcher = dependencies.fetch ?? fetch;
  const randomKey = dependencies.randomKey ?? (() => crypto.randomUUID());
  const token = doc.querySelector('meta[name="aicg-session"]')?.content;
  const element = (id) => doc.getElementById(id);
  const view = {
    text: element('request-text'), profile: element('profile'), previewButton: element('preview-button'),
    submitButton: element('submit-button'), retryButton: element('retry-button'), newIntentButton: element('new-intent-button'),
    status: element('status'), preview: element('preview'), previewText: element('preview-text'),
    previewDetails: element('preview-details'), refreshButton: element('refresh-button'),
    sessionList: element('session-list'), sessionDetail: element('session-detail'),
  };
  let disposed = false;
  let previewGeneration = 0;
  let listGeneration = 0;
  let previewController = null;
  let submitController = null;
  let listController = null;
  let preview = null;
  let intent = null;
  let submitting = false;
  const listeners = [];
  const listListeners = [];

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  }

  function clearListListeners() {
    for (const [target, handler] of listListeners) target.removeEventListener('click', handler);
    listListeners.length = 0;
  }

  async function api(route, method, body, signal) {
    let response;
    try {
      response = await fetcher(route, {
        method, signal,
        headers: { 'x-aicg-session': token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause;
      const error = new Error('本地服务可能已停止或连接中断。请重新运行 aicg studio，先核对已有会话。');
      error.code = 'transport-unavailable';
      throw error;
    }
    const envelope = await response.json();
    if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') throw new Error('服务端响应格式无效。');
    if (!response.ok || !envelope.ok) {
      const error = new Error(envelope.error?.message ?? '请求失败。');
      error.code = envelope.error?.code ?? 'invalid-response';
      throw error;
    }
    if (!Object.hasOwn(envelope, 'data')) throw new Error('服务端响应缺少数据。');
    return envelope.data;
  }

  function setStatus(value) { view.status.textContent = value; }
  function setBusy(value) {
    submitting = value;
    view.text.disabled = value || Boolean(intent);
    view.profile.disabled = value || Boolean(intent);
    view.previewButton.disabled = value || Boolean(intent);
    view.submitButton.disabled = value || !preview || Boolean(intent);
    view.retryButton.hidden = !intent || value;
    view.newIntentButton.hidden = !intent || value;
  }

  function invalidatePreview() {
    previewController?.abort();
    previewController = null;
    previewGeneration += 1;
    preview = null;
    view.preview.hidden = true;
    view.submitButton.disabled = true;
  }

  function showPreview(data) {
    view.previewText.textContent = data.requestText;
    view.previewDetails.replaceChildren();
    const entries = [
      ['风险档位', data.profile], ['仓库摘要', data.repositoryDigest],
      ['路径权限', data.authority.allowedPaths.length ? data.authority.allowedPaths.join(', ') : '无'],
      ['命令权限', data.authority.allowedCommands.length ? '有' : '无'],
      ['网络／外部操作', data.authority.allowNetwork || data.authority.allowExternalEffects ? '需另行核对' : '禁止'],
      ['最多 Agent 轮数', String(data.budgets.maxAgentTurns)],
      ['最多命令数', String(data.budgets.maxCommands)],
    ];
    for (const [label, value] of entries) {
      const dt = doc.createElement('dt'); dt.textContent = label;
      const dd = doc.createElement('dd'); dd.textContent = value;
      view.previewDetails.append(dt, dd);
    }
    view.preview.hidden = false;
  }

  async function onPreview() {
    if (disposed || submitting || intent) return;
    invalidatePreview();
    const generation = previewGeneration;
    const controller = new AbortController();
    previewController = controller;
    setStatus('正在生成只读预览…');
    try {
      const result = await api('/api/v1/delivery-sessions/preview', 'POST', { requestText: view.text.value, profile: view.profile.value }, controller.signal);
      if (disposed || generation !== previewGeneration) return;
      preview = result;
      showPreview(result);
      view.submitButton.disabled = false;
      setStatus('请核对完整文字和权限后，明确确认创建。');
    } catch (error) {
      if (disposed || generation !== previewGeneration || error.name === 'AbortError') return;
      setStatus(`预览失败：${error.message}`);
    } finally {
      if (previewController === controller) previewController = null;
    }
  }

  function renderDetail(data) {
    view.sessionDetail.replaceChildren();
    const [label, nextAction] = guidedText(data);
    const title = doc.createElement('h3'); title.textContent = '规范会话';
    const state = doc.createElement('p'); state.textContent = `状态：${label}。`;
    const evidenceStatus = EVIDENCE_TEXT[data.guided.evidence.status] ?? '证据状态待核对';
    const evidence = doc.createElement('p'); evidence.textContent = `证据：${evidenceStatus}。下一步：${nextAction}。`;
    const authority = doc.createElement('p'); authority.textContent = `Agent：${data.expert.activeAgentId ?? '未激活'}；允许路径：${data.expert.authority.allowedPaths.length}；允许命令：${data.expert.authority.allowedCommands.length}`;
    view.sessionDetail.append(title, state, evidence, authority);

    const addList = (heading, entries, emptyText) => {
      const section = doc.createElement('section'); section.className = 'inspection-group';
      const title = doc.createElement('h4'); title.textContent = heading;
      section.append(title);
      if (entries.length) {
        const list = doc.createElement('ul');
        for (const entry of entries) {
          const item = doc.createElement('li'); item.textContent = entry;
          list.append(item);
        }
        section.append(list);
      } else {
        const empty = doc.createElement('p'); empty.textContent = emptyText;
        section.append(empty);
      }
      view.sessionDetail.append(section);
    };
    addList('待决事项', (data.guided.decisions ?? []).map((entry) => `${entry.kind === 'question' ? '问题' : '决定'}（${entry.status}）：${entry.text}`), '尚未记录具体待决事项；仍需核对当前阶段。');
    addList('风险', (data.guided.risks ?? []).map((entry) => `${entry.severity === 'blocking' ? '阻塞' : '待核对'}：${entry.detail}`), '暂无已记录风险；这不代表交付已获批准。');

    const recovery = doc.createElement('p');
    const checkpoints = data.guided.recovery?.checkpointCount ?? 0;
    recovery.textContent = `恢复：${data.guided.recovery?.available ? `有 ${checkpoints} 个检查点可供核对` : '当前无可用恢复检查点'}。${data.guided.recovery?.lastFailure ? `最近失败：${data.guided.recovery.lastFailure.message ?? data.guided.recovery.lastFailure.category ?? '待核对'}。` : ''}`;
    view.sessionDetail.append(recovery);

    const expert = doc.createElement('details'); expert.className = 'inspection-expert';
    const expertTitle = doc.createElement('summary'); expertTitle.textContent = '专家详情（只读）';
    const expertData = doc.createElement('pre'); expertData.textContent = JSON.stringify(data.expert, null, 2);
    const expertNote = doc.createElement('p'); expertNote.textContent = '原始字段仅供核对，不代表证据通过或获得执行权限。';
    expert.append(expertTitle, expertNote, expertData);
    view.sessionDetail.append(expert);
  }

  async function refreshList() {
    if (disposed) return;
    listController?.abort();
    const generation = ++listGeneration;
    const controller = new AbortController();
    listController = controller;
    try {
      const data = await api('/api/v1/delivery-sessions', 'GET', undefined, controller.signal);
      if (disposed || generation !== listGeneration) return;
      clearListListeners();
      view.sessionList.replaceChildren();
      for (const [index, summary] of data.sessions.entries()) {
        const item = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = `会话 ${index + 1} · ${guidedText(summary)[0]}`;
        const onSelect = () => { void selectSession(summary.sessionId); };
        button.addEventListener('click', onSelect);
        listListeners.push([button, onSelect]);
        item.append(button);
        view.sessionList.append(item);
      }
    } catch (error) {
      if (!disposed && generation === listGeneration && error.name !== 'AbortError') setStatus(`读取会话失败：${error.message}`);
    } finally {
      if (listController === controller) listController = null;
    }
  }

  async function selectSession(id) {
    if (disposed) return;
    listController?.abort();
    const generation = ++listGeneration;
    const controller = new AbortController();
    listController = controller;
    try {
      const data = await api(`/api/v1/delivery-sessions/${encodeURIComponent(id)}`, 'GET', undefined, controller.signal);
      if (!disposed && generation === listGeneration) renderDetail(data);
    } catch (error) {
      if (!disposed && generation === listGeneration && error.name !== 'AbortError') setStatus(`读取会话失败：${error.message}`);
    } finally {
      if (listController === controller) listController = null;
    }
  }

  async function submitIntent() {
    if (disposed || submitting || !intent) return;
    const submitted = intent;
    const controller = new AbortController();
    submitController = controller;
    setBusy(true);
    setStatus('正在创建规范会话；请勿重复提交…');
    try {
      const data = await api('/api/v1/delivery-sessions', 'POST', submitted, controller.signal);
      if (disposed || submitted !== intent) return;
      intent = null;
      preview = null;
      view.preview.hidden = true;
      renderDetail(data.inspection);
      setStatus(data.replayed ? '已找到同一次提交创建的会话。' : '会话已创建，当前仍等待需求确认。');
      void refreshList();
    } catch (error) {
      if (disposed || submitted !== intent) return;
      if (['invalid-request', 'idempotency-conflict', 'stale-preview'].includes(error.code)) {
        intent = null;
        invalidatePreview();
        setStatus(`提交被拒绝：${error.message} 请重新预览。`);
      } else if (error.code === 'publication-unresolved') {
        setStatus('会话创建尚未确认，可能需要人工恢复。请保持此页面打开，先刷新会话列表；稍后可重试原请求，若持续如此请停止提交并核对本地会话存储。');
      } else if (error.code === 'transport-unavailable') {
        setStatus('结果不明，本地服务可能已停止或连接中断。若原页面恢复连接，可用原请求重试或刷新；否则请重新运行 aicg studio 并先核对已有会话。仍无法确认时停止提交并人工核对本地会话存储；不要创建新请求。');
      } else {
        setStatus('结果暂不确定。请使用原请求重试，或刷新会话列表；不要生成新防重键。');
      }
    } finally {
      if (submitController === controller) submitController = null;
      if (!disposed) setBusy(false);
    }
  }

  function onSubmit() {
    if (disposed || submitting || !preview || intent) return;
    intent = { requestText: preview.requestText, profile: preview.profile, previewDigest: preview.previewDigest, idempotencyKey: randomKey() };
    void submitIntent();
  }

  function onNewIntent() {
    if (disposed || submitting) return;
    submitController?.abort();
    submitController = null;
    intent = null;
    invalidatePreview();
    setBusy(false);
    setStatus('待定请求已从本页面移除；它可能已在服务端创建。请先刷新会话列表。');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    previewGeneration += 1;
    listGeneration += 1;
    previewController?.abort();
    submitController?.abort();
    listController?.abort();
    clearListListeners();
    for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
    listeners.length = 0;
  }

  listen(view.text, 'input', invalidatePreview);
  listen(view.profile, 'change', invalidatePreview);
  listen(view.previewButton, 'click', onPreview);
  listen(view.submitButton, 'click', onSubmit);
  listen(view.retryButton, 'click', () => { void submitIntent(); });
  listen(view.newIntentButton, 'click', onNewIntent);
  listen(view.refreshButton, 'click', () => { void refreshList(); });
  listen(doc.defaultView, 'pagehide', dispose);
  setBusy(false);
  void refreshList();
  return dispose;
}

if (typeof document !== 'undefined') mountStudio(document);
