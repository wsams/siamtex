/* SiamTeX client — beginner-friendly LaTeX editor */
(function () {
  'use strict';

  const BASE = window.SIAMTEX_BASE || '/siamtex';

  const state = {
    user: null,
    authRequired: false,
    providers: [],
    oauthConfigured: false,
    aiEnabled: false,
    aiPermissions: null,
    isAdmin: false,
    aiConfig: null,
    aiModels: [],
    aiUsage: null,
    projects: [],
    templates: [],
    commonFiles: [],
    project: null,
    files: [],
    activePath: null,
    dirty: {},
    contents: {},
    build: null,
    buildsByEntry: {},
    problemsTab: 'problems',
    problemsExpanded: false,
    paneLayout: loadPaneLayout(),
    shareToken: null,
    editor: null,
    editorTheme: localStorage.getItem('siamtex_editor_theme') || 'material-darker',
    editorVim: localStorage.getItem('siamtex_editor_vim') === '1',
    autoTimer: null,
    compiling: false,
    chatOpen: false,
    chatMode: localStorage.getItem('siamtex_chat_mode') !== 'ask' ? 'edit' : 'ask',
    chatPresetCategory: localStorage.getItem('siamtex_chat_preset_cat') || 'polish',
    chatSelectedPresetId: localStorage.getItem('siamtex_chat_preset_id') || 'grammar',
    chatAutoApply: localStorage.getItem('siamtex_chat_auto_apply') !== '0',
    chatEditTarget: '',
    chatMessages: [],
    chatBusy: false,
    chatAbort: null,
    chatMentionIdx: -1,
  };

  const $main = () => document.getElementById('main');
  const $top = () => document.getElementById('topActions');

  function api(path, opts = {}) {
    const headers = Object.assign({ 'X-SiamTeX-CSRF': '1' }, opts.headers || {});
    const signal = opts.signal;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    const { signal: _s, ...fetchOpts } = opts;
    return fetch(BASE + path, {
      credentials: 'same-origin',
      ...fetchOpts,
      headers,
      signal,
    }).then(async (res) => {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
      }
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res;
    });
  }

  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.classList.add('hidden'); }, 5000);
  }

  function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    const sec = Math.floor(diff / 1000);
    if (sec < 45) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 36) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 14) return `${day}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function templateIcon(category) {
    const c = String(category || '').toLowerCase();
    if (c === 'school') return '📝';
    if (c === 'academic') return '📚';
    if (c === 'career') return '📋';
    return '📄';
  }

  function filterDashboardProjects() {
    const q = (document.getElementById('dashProjectSearch')?.value || '').trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll('.project-row').forEach((row) => {
      const hay = row.getAttribute('data-search') || '';
      const show = !q || hay.includes(q);
      row.hidden = !show;
      if (show) visible += 1;
    });
    const noMatch = document.getElementById('dashProjectNoMatch');
    if (noMatch) noMatch.classList.toggle('hidden', visible > 0 || !q);
  }

  function aiTimeoutSeconds() {
    const n = Number(state.aiConfig?.timeoutSeconds);
    return Number.isFinite(n) && n > 10 ? n : 180;
  }

  function effectiveAiModel() {
    return state.project?.aiModel || state.aiConfig?.model || '';
  }

  function effectiveAiConfig() {
    const base = state.aiConfig || {};
    const model = effectiveAiModel();
    return { ...base, model: model || base.model || '' };
  }

  async function loadAiModels() {
    if (!state.aiEnabled) {
      state.aiModels = [];
      return;
    }
    try {
      const q = state.project?.id ? `?projectId=${encodeURIComponent(state.project.id)}` : '';
      const data = await api('/api/ai_models.php' + q);
      state.aiModels = Array.isArray(data.models) ? data.models : [];
      const current = data.current || effectiveAiModel();
      if (current && !state.aiModels.includes(current)) {
        state.aiModels.unshift(current);
      }
    } catch {
      const cur = effectiveAiModel();
      state.aiModels = cur ? [cur] : [];
    }
  }

  function renderAiModelOptionList(selected) {
    const models = [...(state.aiModels || [])];
    if (selected && !models.includes(selected)) models.unshift(selected);
    const seen = new Set();
    return models.filter((m) => {
      if (!m || seen.has(m)) return false;
      seen.add(m);
      return true;
    }).map((m) => `<option value="${esc(m)}"${m === selected ? ' selected' : ''}>${esc(m)}</option>`).join('');
  }

  function renderProjAiModelSelect() {
    const sel = document.getElementById('projAiModel');
    if (!sel) return;
    const current = effectiveAiModel();
    sel.innerHTML = renderAiModelOptionList(current);
    if (current) sel.value = current;
  }

  async function refreshProjAiModelSelect() {
    await loadAiModels();
    renderProjAiModelSelect();
  }

  function wireProjAiModel() {
    const sel = document.getElementById('projAiModel');
    if (!sel || sel.dataset.wired) return;
    sel.dataset.wired = '1';
    sel.addEventListener('change', async () => {
      if (!state.project || !canEditProject(state.project)) return;
      const model = sel.value;
      try {
        const data = await api('/api/project.php?id=' + encodeURIComponent(state.project.id), {
          method: 'PATCH',
          json: { aiModel: model },
        });
        state.project = data.project;
        updateAiChatChrome();
        toast(`Project model: ${model}`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
        renderProjAiModelSelect();
      }
    });
  }

  function formatAiDuration(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  }

  function formatTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }

  function formatTokenUsage(usage, opts = {}) {
    if (!usage) return '0 tokens';
    const total = Number(usage.totalTokens) || 0;
    const est = usage.estimated ? '≈' : '';
    const prefix = opts.short ? '' : 'AI: ';
    if (opts.detailed) {
      const inTok = Number(usage.promptTokens) || 0;
      const outTok = Number(usage.completionTokens) || 0;
      return `${prefix}${est}${formatTokens(total)} tokens (${formatTokens(inTok)} in / ${formatTokens(outTok)} out)`;
    }
    return `${prefix}${est}${formatTokens(total)} tokens`;
  }

  function applyAiUsageFromResponse(data) {
    if (data?.usageTotals?.user) {
      state.aiUsage = data.usageTotals.user;
      renderGlobalAiUsage();
    }
    if (data?.usageTotals?.project && state.project) {
      state.project.aiUsage = data.usageTotals.project;
      renderProjectAiUsage();
    }
  }

  function renderGlobalAiUsage() {
    const el = document.getElementById('aiUsageGlobal');
    if (!el || !state.aiEnabled) return;
    const u = state.aiUsage;
    if (!u || (!u.totalTokens && !u.tokenQuota)) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const quota = u.tokenQuota > 0 ? u.tokenQuota : null;
    const quotaLabel = quota ? ` / ${formatTokens(quota)}` : '';
    el.textContent = `AI ${formatTokens(u.totalTokens)}${quotaLabel} tok`;
    const remain = quota ? ` · ${formatTokens(u.quotaRemaining ?? 0)} left` : '';
    el.title = `Your account: ${formatTokens(u.promptTokens)} prompt + ${formatTokens(u.completionTokens)} completion across ${u.callCount} call(s)${remain}`;
  }

  function formatQuotaUsage(usage, quota) {
    const used = formatTokens(usage?.totalTokens || 0);
    if (!quota || quota <= 0) return `${used} / ∞`;
    const pct = Math.min(100, Math.round(((usage?.totalTokens || 0) / quota) * 100));
    return `${used} / ${formatTokens(quota)} (${pct}%)`;
  }

  function renderProjectAiUsage() {
    const el = document.getElementById('aiUsageProject');
    if (!el || !state.project) return;
    const u = state.project.aiUsage;
    if (!u || !u.totalTokens) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<span class="ai-usage-label">AI tokens</span> <strong>${formatTokens(u.totalTokens)}</strong>
      <span class="ai-usage-detail">${formatTokens(u.promptTokens)} in · ${formatTokens(u.completionTokens)} out · ${u.callCount} calls</span>`;
    el.title = 'Cumulative AI token usage for this project (cloud providers may bill per token)';
  }

  let aiWaitGlobal = null;

  /**
   * Progress UI for long-running AI calls (elapsed time, timeout countdown, cancel, optional stream preview).
   * @param {HTMLElement} mount
   * @param {{ title?: string, subtitle?: string, phases?: string[], streaming?: boolean }} opts
   */
  function createAiWait(mount, opts = {}) {
    const timeout = aiTimeoutSeconds();
    const model = effectiveAiModel() || 'AI model';
    const streaming = !!opts.streaming;
    const phases = opts.phases || [
      `Connecting to ${model}…`,
      'Sending your LaTeX context over the network…',
      'Model is reading the source and errors — usually 20–60 seconds…',
      'Still generating a response — remote Ollama models can be slow…',
      'Approaching the server time limit — cancel to retry with a smaller scope…',
    ];
    const title = opts.title || 'AI is working';
    const subtitle = opts.subtitle || (streaming
      ? 'Live output from the model appears below as tokens arrive.'
      : 'Status updates appear while the model works.');

    mount.classList.remove('hidden');
    mount.innerHTML = `
      <div class="ai-wait" role="status" aria-live="polite" aria-busy="true">
        <div class="ai-wait-header">
          <span class="ai-wait-spinner" aria-hidden="true"></span>
          <div class="ai-wait-copy">
            <div class="ai-wait-title">${esc(title)}</div>
            <div class="ai-wait-phase" id="aiWaitPhase">${esc(phases[0])}</div>
            <div class="ai-wait-sub">${esc(subtitle)}</div>
          </div>
        </div>
        <div class="ai-wait-bar" aria-hidden="true"><span class="ai-wait-bar-fill"></span></div>
        <div class="ai-wait-meta">
          <span>Elapsed <strong class="ai-wait-elapsed">0s</strong></span>
          <span>Limit <strong>${esc(formatAiDuration(timeout))}</strong></span>
          <span class="ai-wait-remain-wrap">Remaining <strong class="ai-wait-remain">${esc(formatAiDuration(timeout))}</strong></span>
          <span class="ai-wait-tokens hidden">Tokens <strong class="ai-wait-token-count">0</strong> <span class="ai-wait-token-detail"></span></span>
        </div>
        <pre class="ai-wait-stream hidden" aria-label="Model output preview"></pre>
        <button type="button" class="ghost ai-wait-cancel">Cancel request</button>
      </div>`;

    const phaseEl = mount.querySelector('.ai-wait-phase');
    const elapsedEl = mount.querySelector('.ai-wait-elapsed');
    const remainEl = mount.querySelector('.ai-wait-remain');
    const remainWrap = mount.querySelector('.ai-wait-remain-wrap');
    const barFill = mount.querySelector('.ai-wait-bar-fill');
    const bar = mount.querySelector('.ai-wait-bar');
    const cancelBtn = mount.querySelector('.ai-wait-cancel');
    const streamEl = mount.querySelector('.ai-wait-stream');
    const tokensWrap = mount.querySelector('.ai-wait-tokens');
    const tokenCountEl = mount.querySelector('.ai-wait-token-count');
    const tokenDetailEl = mount.querySelector('.ai-wait-token-detail');
    const ac = new AbortController();
    let tick = null;
    let startedAt = 0;
    let cancelled = false;
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true };
    let manualPhase = false;

    if (streaming) {
      streamEl.classList.remove('hidden');
    }
    tokensWrap.classList.remove('hidden');

    const syncTokenDisplay = () => {
      const est = tokenUsage.estimated ? '≈' : '';
      tokenCountEl.textContent = `${est}${formatTokens(tokenUsage.totalTokens)}`;
      tokenDetailEl.textContent = tokenUsage.promptTokens || tokenUsage.completionTokens
        ? `(${formatTokens(tokenUsage.promptTokens)} in / ${formatTokens(tokenUsage.completionTokens)} out)`
        : '';
    };

    const applyTokenUsage = (usage) => {
      if (!usage) return;
      tokenUsage = {
        promptTokens: Number(usage.promptTokens) || 0,
        completionTokens: Number(usage.completionTokens) || 0,
        totalTokens: Number(usage.totalTokens) || (Number(usage.promptTokens) || 0) + (Number(usage.completionTokens) || 0),
        estimated: !!usage.estimated,
      };
      syncTokenDisplay();
      manualPhase = true;
      const label = `Receiving… ${formatTokenUsage(tokenUsage, { short: true })}`;
      phaseEl.textContent = label;
      const gPhase = aiWaitGlobal?.querySelector('.ai-global-phase');
      if (gPhase) gPhase.textContent = label;
    };

    const phaseFor = (sec) => {
      if (sec < 6) return phases[0];
      if (sec < 18) return phases[1];
      if (sec < 40) return phases[2];
      if (sec < timeout * 0.8) return phases[3];
      return phases[4] || phases[phases.length - 1];
    };

    const syncGlobal = (sec, remain) => {
      if (!aiWaitGlobal) return;
      const gPhase = aiWaitGlobal.querySelector('.ai-global-phase');
      const gElapsed = aiWaitGlobal.querySelector('.ai-global-elapsed');
      const gRemain = aiWaitGlobal.querySelector('.ai-global-remain');
      if (gPhase && !manualPhase) gPhase.textContent = phaseFor(sec);
      if (gElapsed) gElapsed.textContent = formatAiDuration(sec);
      if (gRemain) gRemain.textContent = formatAiDuration(remain);
    };

    return {
      signal: ac.signal,
      setPhase(message) {
        manualPhase = true;
        if (phaseEl) phaseEl.textContent = message;
        const gPhase = aiWaitGlobal?.querySelector('.ai-global-phase');
        if (gPhase) gPhase.textContent = message;
      },
      appendStream(text) {
        if (!text || !streamEl) return;
        streamEl.textContent += text;
        streamEl.scrollTop = streamEl.scrollHeight;
        if (tokenUsage.estimated) {
          const estOut = Math.max(tokenUsage.completionTokens, Math.ceil(streamEl.textContent.length / 4));
          applyTokenUsage({
            promptTokens: tokenUsage.promptTokens,
            completionTokens: estOut,
            totalTokens: tokenUsage.promptTokens + estOut,
            estimated: true,
          });
        }
      },
      setTokenUsage(usage) {
        applyTokenUsage(usage);
      },
      setProgress() {
        /* legacy SSE char progress — tokens preferred */
      },
      start() {
        startedAt = Date.now();
        document.body.classList.add('ai-busy');
        aiWaitGlobal = document.createElement('div');
        aiWaitGlobal.className = 'ai-global-busy';
        aiWaitGlobal.setAttribute('role', 'status');
        aiWaitGlobal.innerHTML = `
          <span class="ai-global-spinner" aria-hidden="true"></span>
          <span class="ai-global-title">${esc(title)}</span>
          <span class="ai-global-phase">${esc(phases[0])}</span>
          <span class="ai-global-times">
            <span class="ai-global-elapsed">0s</span>
            <span class="ai-global-sep">/</span>
            <span class="ai-global-remain">${esc(formatAiDuration(timeout))}</span>
          </span>`;
        document.querySelector('.topbar')?.insertAdjacentElement('afterend', aiWaitGlobal);

        tick = setInterval(() => {
          const sec = Math.floor((Date.now() - startedAt) / 1000);
          const remain = Math.max(0, timeout - sec);
          elapsedEl.textContent = formatAiDuration(sec);
          remainEl.textContent = formatAiDuration(remain);
          if (!manualPhase) phaseEl.textContent = phaseFor(sec);
          const pct = Math.min(100, (sec / timeout) * 100);
          barFill.style.width = `${pct}%`;
          bar.classList.toggle('ai-warn', pct >= 70 && pct < 92);
          bar.classList.toggle('ai-danger', pct >= 92);
          remainWrap.classList.toggle('ai-warn', remain > 0 && remain <= 30);
          remainWrap.classList.toggle('ai-danger', remain === 0);
          syncGlobal(sec, remain);
        }, 250);
      },
      finish() {
        clearInterval(tick);
        mount.classList.add('hidden');
        mount.innerHTML = '';
        document.body.classList.remove('ai-busy');
        aiWaitGlobal?.remove();
        aiWaitGlobal = null;
      },
      fail(message) {
        clearInterval(tick);
        document.body.classList.remove('ai-busy');
        aiWaitGlobal?.remove();
        aiWaitGlobal = null;
        mount.classList.remove('hidden');
        mount.innerHTML = `
          <div class="ai-wait ai-wait-error" role="alert">
            <div class="ai-wait-title">AI request failed</div>
            <p class="ai-wait-phase">${esc(message)}</p>
            <p class="ai-wait-sub">You can adjust your project, try again, or switch to a smaller scope / different model.</p>
          </div>`;
      },
      cancel() {
        cancelled = true;
        ac.abort();
      },
      wasCancelled() {
        return cancelled;
      },
      onCancel(fn) {
        cancelBtn.onclick = () => {
          cancelBtn.disabled = true;
          cancelBtn.textContent = 'Cancelling…';
          fn();
        };
      },
    };
  }

  async function runAiRequest(path, json, wait, buttons = []) {
    buttons.forEach((b) => { if (b) b.disabled = true; });
    wait.onCancel(() => wait.cancel());
    wait.start();
    try {
      const result = await api(path, { method: 'POST', json, signal: wait.signal });
      wait.finish();
      return result;
    } catch (e) {
      if (wait.wasCancelled() || e.name === 'AbortError') {
        wait.finish();
        throw new Error('AI request cancelled.');
      }
      let msg = String(e.message || e);
      if (/timeout|timed out|could not reach|empty response/i.test(msg)) {
        msg = `${msg} (limit ${formatAiDuration(aiTimeoutSeconds())} — try a smaller file or increase SIAMTEX_AI_TIMEOUT)`;
      }
      wait.fail(msg);
      throw new Error(msg);
    } finally {
      buttons.forEach((b) => { if (b) b.disabled = false; });
    }
  }

  function parseSseBlock(block, wait, onDone) {
    let event = 'message';
    let data = '';
    block.split('\n').forEach((line) => {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data = line.slice(6);
    });
    if (!data) return;
    const payload = JSON.parse(data);
    if (event === 'delta') wait.appendStream(payload.text || '');
    else if (event === 'reasoning') wait.appendReasoning?.(payload.text || '');
    else if (event === 'status') wait.setPhase(payload.message || 'Working…');
    else if (event === 'progress' && payload.usage) wait.setTokenUsage(payload.usage);
    else if (event === 'done') onDone(payload);
    else if (event === 'error') throw new Error(payload.error || 'AI error');
  }

  async function runAiStreamRequest(path, json, wait, buttons = []) {
    buttons.forEach((b) => { if (b) b.disabled = true; });
    wait.onCancel(() => wait.cancel());
    wait.start();
    let finalData = null;
    try {
      const res = await fetch(BASE + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-SiamTeX-CSRF': '1' },
        body: JSON.stringify(json),
        signal: wait.signal,
      });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (ct.includes('application/json')) {
          const err = await res.json();
          throw new Error(err.error || res.statusText);
        }
        throw new Error((await res.text()) || res.statusText);
      }
      if (!res.body || !ct.includes('text/event-stream')) {
        throw new Error('AI stream unavailable — server did not return event-stream.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          parseSseBlock(chunk, wait, (payload) => { finalData = payload; });
        }
      }
      if (buffer.trim()) {
        parseSseBlock(buffer.trim(), wait, (payload) => { finalData = payload; });
      }
      wait.finish();
      if (!finalData) throw new Error('AI stream ended without a result.');
      return finalData;
    } catch (e) {
      if (wait.wasCancelled() || e.name === 'AbortError') {
        wait.finish();
        throw new Error('AI request cancelled.');
      }
      let msg = String(e.message || e);
      if (/timeout|timed out|could not reach|empty response/i.test(msg)) {
        msg = `${msg} (limit ${formatAiDuration(aiTimeoutSeconds())} — try a smaller file or increase SIAMTEX_AI_TIMEOUT)`;
      }
      wait.fail(msg);
      throw new Error(msg);
    } finally {
      buttons.forEach((b) => { if (b) b.disabled = false; });
    }
  }

  /* ---------- General AI chat panel (Q&A + structured edits) ---------- */

  const AI_CHAT_PRESET_CATEGORIES = [
    {
      id: 'polish',
      label: 'Polish',
      presets: [
        { id: 'grammar', label: 'Grammar', instruction: 'Fix grammar only. Preserve meaning, structure, and all LaTeX commands. Return valid LaTeX only — no markdown fences or commentary.' },
        { id: 'spelling', label: 'Spelling', instruction: 'Fix spelling and typos only. Do not rephrase or change wording. Return valid LaTeX only.' },
        { id: 'clarity', label: 'Clarity', instruction: 'Improve clarity and flow while keeping the same structure and sectioning. Return valid LaTeX only.' },
        { id: 'concise', label: 'Concise', instruction: 'Make the writing more concise. Remove redundancy; keep all technical content. Return valid LaTeX only.' },
        { id: 'formal', label: 'Formal', instruction: 'Rewrite in a formal academic tone suitable for a journal paper. Return valid LaTeX only.' },
      ],
    },
    {
      id: 'latex',
      label: 'LaTeX',
      presets: [
        { id: 'fix-latex', label: 'Fix syntax', instruction: 'Fix LaTeX syntax and compilation issues. Return valid, compilable LaTeX only.' },
        { id: 'captions', label: 'Captions', instruction: 'Improve figure and table captions for clarity and style. Return valid LaTeX only.' },
        { id: 'math-notation', label: 'Math notation', instruction: 'Make mathematical notation consistent and idiomatic (amsmath-style). Return valid LaTeX only.' },
        { id: 'refs', label: 'Cross-refs', instruction: 'Improve \\label, \\ref, and \\cite usage for consistency. Return valid LaTeX only.' },
      ],
    },
    {
      id: 'academic',
      label: 'Academic',
      presets: [
        { id: 'peer-review', label: 'Peer review', instruction: 'Rewrite as if addressing thoughtful peer-review feedback: clearer claims, cautious wording, stronger transitions. Return valid LaTeX only.' },
        { id: 'expand-methods', label: 'Expand methods', instruction: 'Expand the methods/experimental section with more precise detail while staying factual. Return valid LaTeX only.' },
        { id: 'shorten-abstract', label: 'Short abstract', instruction: 'Shorten the abstract aggressively while preserving key results. Return valid LaTeX only.' },
        { id: 'plain-summary', label: 'Plain summary', instruction: 'Add a brief plain-language summary paragraph at the top (as a comment block). Return valid LaTeX only.' },
      ],
    },
    {
      id: 'voices',
      label: 'Voices',
      presets: [
        { id: 'hemingway', label: 'Hemingway', instruction: 'Rewrite in Ernest Hemingway\'s spare, direct prose style — short sentences, concrete nouns. Keep LaTeX structure valid.' },
        { id: 'shakespeare', label: 'Shakespeare', instruction: 'Rewrite with Shakespearean flair — elevated diction and rhythm — while keeping technical accuracy and valid LaTeX.' },
        { id: 'einstein', label: 'Einstein', instruction: 'Rewrite explaining ideas the way Albert Einstein might — intuitive, wonder-filled, yet precise. Valid LaTeX only.' },
        { id: 'feynman', label: 'Feynman', instruction: 'Rewrite in Richard Feynman\'s conversational, first-principles teaching style. Valid LaTeX only.' },
        { id: 'austen', label: 'Jane Austen', instruction: 'Rewrite with Jane Austen\'s wit and social observation applied to the subject matter. Keep valid LaTeX.' },
        { id: 'attwood', label: 'Atwood', instruction: 'Rewrite with Margaret Atwood\'s sharp, observant narrative voice. Valid LaTeX only.' },
      ],
    },
    {
      id: 'fun',
      label: 'Fun',
      presets: [
        { id: 'pirate', label: 'Pirate', instruction: 'Rewrite in enthusiastic pirate speak — arr, matey — but keep equations and LaTeX commands correct.' },
        { id: 'yoda', label: 'Yoda', instruction: 'Rewrite in Yoda\'s speech pattern you must, yet valid LaTeX remain it shall.' },
        { id: 'victorian', label: 'Victorian', instruction: 'Rewrite in ornate Victorian scholarly prose. Valid LaTeX only.' },
        { id: 'genz', label: 'Gen Z', instruction: 'Rewrite with light Gen Z internet voice — still professional enough for a draft; valid LaTeX only.' },
        { id: 'sports', label: 'Sports cast', instruction: 'Rewrite as an excited sports commentator calling the action of the research. Valid LaTeX only.' },
        { id: 'noir', label: 'Film noir', instruction: 'Rewrite as hard-boiled film noir narration about the document\'s subject. Valid LaTeX only.' },
      ],
    },
    {
      id: 'people',
      label: 'People',
      presets: [
        { id: 'colleague', label: 'Friendly colleague', instruction: 'Rewrite as a supportive colleague would — clear, warm, constructive. Valid LaTeX only.' },
        { id: 'strict-prof', label: 'Strict professor', instruction: 'Rewrite as a demanding professor would insist — precise, rigorous, no hand-waving. Valid LaTeX only.' },
        { id: 'tutor', label: 'Patient tutor', instruction: 'Rewrite for a student who is learning — define terms inline, gentle pacing. Valid LaTeX only.' },
        { id: 'grant-writer', label: 'Grant writer', instruction: 'Rewrite to maximize impact for a grant proposal — outcomes, significance, bold opening. Valid LaTeX only.' },
      ],
    },
  ];

  let aiChatMounted = false;

  function chatStorageKey() {
    const id = state.project?.id;
    return `siamtex_chat_${id || 'home'}`;
  }

  function loadChatHistory() {
    try {
      const raw = localStorage.getItem(chatStorageKey());
      const data = raw ? JSON.parse(raw) : [];
      state.chatMessages = Array.isArray(data)
        ? data.filter((m) => m && (m.role === 'user' || m.role === 'assistant')
          && (m.content || m.reasoning || m.editResult))
        : [];
    } catch {
      state.chatMessages = [];
    }
  }

  function saveChatHistory() {
    try {
      localStorage.setItem(chatStorageKey(), JSON.stringify(state.chatMessages.slice(-40)));
    } catch {
      /* quota */
    }
  }

  function chatContextPayload() {
    const ctx = {};
    if (state.project) {
      ctx.projectName = state.project.name || '';
      ctx.engine = state.project.engine || '';
      ctx.activeFile = state.activePath || state.project.mainFile || '';
      ctx.files = chatAttachableFiles();
    }
    return ctx;
  }

  function chatContextLabel() {
    if (!state.project) return 'General questions';
    const target = getChatEditTargetPath([]);
    return `${state.project.name} · editing ${target || 'open a text file'}`;
  }

  function getChatEditTargetPath(attachPaths, explicitPath) {
    if (explicitPath) return explicitPath;
    const picked = document.getElementById('aiChatTargetFile')?.value
      || state.chatEditTarget;
    if (picked && picked !== '__active__') return picked;
    return resolveChatEditPath(attachPaths);
  }

  function chatAttachableFiles() {
    if (!state.project) return [];
    return (state.files || [])
      .filter((f) => !/\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svgz|pdf|eps|ps|ai|otf|ttf|ttc|woff2?|pfb|pfm|afm|tfm|vf|pk|gf|mf|map|enc)$/i.test(f.path || ''))
      .map((f) => f.path)
      .filter(Boolean);
  }

  function resolveChatMentionToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (['active', 'current', '.'].includes(lower)) {
      return state.activePath || state.project?.mainFile || null;
    }
    if (lower === 'selection') return 'selection';
    const paths = chatAttachableFiles();
    if (paths.includes(raw)) return raw;
    const byBase = paths.find((p) => p === raw || p.endsWith('/' + raw) || p.split('/').pop() === raw);
    return byBase || null;
  }

  function parseChatMentions(text) {
    const attachSet = new Set();
    const re = /@([a-zA-Z0-9_.\/-]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const resolved = resolveChatMentionToken(m[1]);
      if (resolved && resolved !== 'selection') attachSet.add(resolved);
    }
    const wantsSelection = /@selection\b/i.test(text);
    return {
      text: text.trim(),
      attachPaths: [...attachSet],
      wantsSelection,
    };
  }

  function chatSelectionPayload(wantsSelection) {
    if (!wantsSelection || !state.editor) return null;
    const text = state.editor.getSelection();
    if (!text || !String(text).trim()) return null;
    return { path: state.activePath || state.project?.mainFile || 'editor', text: String(text) };
  }

  function formatChatUserText(text) {
    return esc(text)
      .replace(/@([a-zA-Z0-9_.\/-]+)/g, '<span class="ai-chat-mention">@$1</span>')
      .replace(/\n/g, '<br>');
  }

  let chatMarkdownReady = false;
  let chatStreamRenderTimer = null;

  function normalizeChatMarkdown(text) {
    return String(text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\\`\\`\\`/g, '```');
  }

  /** If the model wraps the whole reply in ```markdown … ```, peel it off. */
  function unwrapOuterChatFence(text) {
    let t = String(text ?? '').trim();
    for (let i = 0; i < 2; i++) {
      const m = t.match(/^```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)\n```\s*$/);
      if (!m) break;
      const lang = (m[1] || '').toLowerCase();
      const inner = m[2];
      if (['markdown', 'md', 'text', ''].includes(lang)) {
        t = inner.trim();
        continue;
      }
      break;
    }
    return t;
  }

  /** Split assistant text into prose and fenced code segments (more forgiving than marked alone). */
  function splitChatMarkdown(text) {
    const src = unwrapOuterChatFence(normalizeChatMarkdown(text));
    const parts = [];
    const re = /```([a-zA-Z0-9+_.-]*)\s*\n([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) {
        parts.push({ type: 'text', content: src.slice(last, m.index) });
      }
      parts.push({ type: 'code', lang: m[1] || 'text', content: m[2].replace(/\s+$/, '') });
      last = m.index + m[0].length;
    }
    if (last < src.length) {
      parts.push({ type: 'text', content: src.slice(last) });
    }
    if (!parts.length) parts.push({ type: 'text', content: src });
    return parts;
  }

  function renderChatCodeBlock(lang, code) {
    const language = esc((lang || 'text').split(/\s+/)[0] || 'text');
    const body = esc(String(code ?? '').replace(/\n$/, ''));
    return `<div class="ai-chat-code-wrap"><div class="ai-chat-code-head"><span class="ai-chat-code-lang">${language}</span><button type="button" class="ghost ai-chat-code-copy" title="Copy code">Copy</button></div><pre class="ai-chat-code"><code>${body}</code></pre></div>`;
  }

  function initChatMarkdown() {
    if (chatMarkdownReady || typeof marked === 'undefined') return typeof marked !== 'undefined';
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false,
    });
    chatMarkdownReady = true;
    return true;
  }

  function sanitizeChatHtml(html) {
    if (typeof DOMPurify === 'undefined') return html;
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['button'],
      ADD_ATTR: ['class', 'type', 'title'],
    });
  }

  function renderChatMarkdownInner(text) {
    const parts = splitChatMarkdown(text);
    const hasCode = parts.some((p) => p.type === 'code');
    if (!hasCode && typeof marked !== 'undefined' && initChatMarkdown()) {
      return sanitizeChatHtml(marked.parse(unwrapOuterChatFence(normalizeChatMarkdown(text))));
    }
    let html = '';
    for (const part of parts) {
      if (part.type === 'code') {
        html += renderChatCodeBlock(part.lang, part.content);
        continue;
      }
      const chunk = String(part.content ?? '').trim();
      if (!chunk) continue;
      if (typeof marked !== 'undefined' && initChatMarkdown()) {
        html += sanitizeChatHtml(marked.parse(chunk));
      } else {
        html += formatChatUserText(chunk);
      }
    }
    return html || formatChatUserText(String(text ?? ''));
  }

  function splitThinkingBlocks(text) {
    let answer = String(text ?? '');
    const thinkingParts = [];
    const blockRe = /<think(?:ing)?>\s*([\s\S]*?)\s*<\/think(?:ing)?>/gi;
    answer = answer.replace(blockRe, (_, inner) => {
      const chunk = String(inner || '').trim();
      if (chunk) thinkingParts.push(chunk);
      return '';
    });
    answer = answer.replace(/<reasoning>\s*([\s\S]*?)\s*<\/reasoning>/gi, (_, inner) => {
      const chunk = String(inner || '').trim();
      if (chunk) thinkingParts.push(chunk);
      return '';
    });
    answer = answer.trim();
    const openRe = /^\s*<think(?:ing)?>\s*([\s\S]*)$/i;
    const openM = answer.match(openRe);
    if (openM) {
      thinkingParts.push(String(openM[1] || '').trim());
      answer = '';
    }
    return { thinking: thinkingParts.join('\n\n'), answer };
  }

  function renderChatThinking(thinking, streaming) {
    if (!thinking?.trim()) return '';
    const body = esc(thinking).replace(/\n/g, '<br>');
    const openAttr = streaming ? ' open' : '';
    return `<details class="ai-chat-thinking"${openAttr}><summary>Thinking</summary><div class="ai-chat-thinking-body">${body}</div></details>`;
  }

  function formatChatMessageBody(text, role, reasoning = '', streaming = false) {
    if (role === 'assistant') {
      const split = splitThinkingBlocks(text || '');
      const think = (reasoning || split.thinking || '').trim();
      const answer = (split.answer || '').trim();
      let html = '';
      if (think) html += renderChatThinking(think, streaming);
      if (answer) {
        html += `<div class="ai-chat-md">${renderChatMarkdownInner(answer)}</div>`;
      } else if (!think) {
        html += `<div class="ai-chat-md">${renderChatMarkdownInner(text || '')}</div>`;
      }
      return html;
    }
    return formatChatUserText(text);
  }

  function renderChatMarkdown(text) {
    return formatChatMessageBody(text, 'assistant');
  }

  function fillChatMessageBody(bodyEl, content, streaming, reasoning = '') {
    if (!bodyEl) return;
    bodyEl.classList.toggle('ai-chat-msg-streaming', !!streaming);
    bodyEl.innerHTML = formatChatMessageBody(content, 'assistant', reasoning, streaming);
    wireChatMessageBody(bodyEl);
  }

  function scheduleChatStreamRender(bodyEl, mount, content, reasoning = '') {
    if (!bodyEl) return;
    clearTimeout(chatStreamRenderTimer);
    chatStreamRenderTimer = setTimeout(() => {
      fillChatMessageBody(bodyEl, content, true, reasoning);
      if (mount) mount.scrollTop = mount.scrollHeight;
    }, 60);
  }

  function flushChatStreamRender(bodyEl, mount, content, reasoning = '') {
    clearTimeout(chatStreamRenderTimer);
    chatStreamRenderTimer = null;
    if (!bodyEl) return;
    fillChatMessageBody(bodyEl, content, false, reasoning);
    if (mount) mount.scrollTop = mount.scrollHeight;
  }

  function wireChatMessageBody(root) {
    root?.querySelectorAll('.ai-chat-code-copy').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const pre = btn.closest('.ai-chat-code-wrap')?.querySelector('pre');
        const t = pre?.textContent || '';
        const label = btn.textContent;
        try {
          await navigator.clipboard.writeText(t);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = label || 'Copy'; }, 1600);
        } catch {
          toast('Could not copy', 'error');
        }
      });
    });
    root?.querySelectorAll('.ai-chat-msg-copy').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const msg = btn.closest('.ai-chat-msg');
        const t = msg?.querySelector('.ai-chat-msg-body')?.innerText || '';
        const label = btn.textContent;
        try {
          await navigator.clipboard.writeText(t.trim());
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = label || 'Copy'; }, 1600);
        } catch {
          toast('Could not copy', 'error');
        }
      });
    });
    root?.querySelectorAll('.ai-chat-msg-apply').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const msgEl = btn.closest('.ai-chat-msg');
        const idx = Number(msgEl?.getAttribute('data-msg-idx'));
        const msg = Number.isFinite(idx) ? state.chatMessages[idx] : null;
        if (!msg) return;
        btn.disabled = true;
        try {
          await applyChatMessageEdit(msg);
        } catch (e) {
          toast(e.message || 'Could not apply', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  /** @deprecated use formatChatMessageBody */
  function formatChatBubble(text) {
    return formatChatUserText(text);
  }

  function renderChatAttachedPills(paths) {
    if (!paths?.length) return '';
    return `<div class="ai-chat-attached">${paths.map((p) => (
      `<span class="ai-chat-file-pill" title="Attached for this message">${esc(p)}</span>`
    )).join('')}</div>`;
  }

  function renderAiChatMessages() {
    const mount = document.getElementById('aiChatMessages');
    if (!mount) return;
    if (!state.chatMessages.length) {
      const fileHint = state.project
        ? '<p class="ai-chat-empty-hint">In a project, type <code>@main.tex</code> or <code>@active</code> to attach file contents. Use <code>@selection</code> for highlighted editor text.</p>'
        : '<p class="ai-chat-empty-hint">Open a project to attach files with <code>@filename</code>.</p>';
      const editHint = state.project
        ? '<p class="ai-chat-empty-hint">Pick a <strong>filter</strong> above and click <strong>Apply filter</strong> — edits apply to the target file automatically.</p>'
        : '';
      mount.innerHTML = `<div class="ai-chat-empty">
        <p>Your AI hub — ask questions, run quick edits, and apply changes to the editor.</p>
        ${fileHint}
        ${editHint}
      </div>`;
      return;
    }
    mount.innerHTML = state.chatMessages.map((m, i) => {
      const usagePill = m.usage ? `<span class="ai-chat-msg-usage pill">${esc(formatTokenUsage(m.usage, { short: true }))}</span>` : '';
      const appliedPill = m.autoApplied ? '<span class="pill ai-chat-applied-pill">Applied</span>' : '';
      return `
      <div class="ai-chat-msg ai-chat-msg-${m.role === 'user' ? 'user' : 'assistant'}" data-msg-idx="${i}">
        <div class="ai-chat-msg-role">${m.role === 'user' ? 'You' : 'Assistant'}${usagePill}${appliedPill}</div>
        ${m.role === 'user' ? renderChatAttachedPills(m.attachedFiles) : ''}
        <div class="ai-chat-msg-body">${formatChatMessageBody(m.content, m.role, m.reasoning || '')}</div>
        ${chatMessageActionsHtml(m)}
      </div>`;
    }).join('');
    mount.scrollTop = mount.scrollHeight;
    wireChatMessageBody(mount);
  }

  function setAiChatBusy(busy) {
    state.chatBusy = busy;
    const sendBtn = document.getElementById('aiChatSend');
    const stopBtn = document.getElementById('aiChatStop');
    const input = document.getElementById('aiChatInput');
    if (sendBtn) sendBtn.disabled = busy;
    if (input) input.disabled = busy;
    if (stopBtn) stopBtn.classList.toggle('hidden', !busy);
    document.getElementById('aiChatPanel')?.classList.toggle('ai-chat-busy', busy);
    renderAiMagicBar();
  }

  function toggleAiChatPanel(forceOpen) {
    if (!hasAiChat() || !aiChatMounted) return;
    const open = forceOpen !== undefined ? !!forceOpen : !state.chatOpen;
    state.chatOpen = open;
    const panel = document.getElementById('aiChatPanel');
    const fab = document.getElementById('aiChatFab');
    panel?.classList.toggle('open', open);
    panel?.toggleAttribute('hidden', !open);
    fab?.classList.toggle('open', open);
    fab?.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem('siamtex_chat_open', open ? '1' : '0'); } catch { /* */ }
    if (open) {
      loadChatHistory();
      renderAiChatMessages();
      updateAiChatChrome();
      renderAiMagicBar();
    }
  }

  function setChatMode(mode) {
    state.chatMode = mode === 'edit' ? 'edit' : 'ask';
    try { localStorage.setItem('siamtex_chat_mode', state.chatMode); } catch { /* */ }
    document.querySelectorAll('.ai-chat-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === state.chatMode);
    });
    const input = document.getElementById('aiChatInput');
    if (input) {
      input.placeholder = state.chatMode === 'edit' && hasAiEditInChat()
        ? 'Describe edits for the target file… (@other.tex to switch files)'
        : 'Ask about your project… Type @ to attach files';
    }
  }

  function runAiChatPreset(preset, options = {}) {
    if (!hasAiChat()) return;
    if (!state.project) {
      toast('Open a project first', 'error');
      return;
    }
    if (!hasAiEditInChat()) {
      toast('You need edit access on this project', 'error');
      return;
    }
    const path = getChatEditTargetPath([]);
    if (!path || isBinaryFile({ path })) {
      toast('Open a .tex or text file to edit', 'error');
      return;
    }
    toggleAiChatPanel(true);
    const autoApply = options.autoApply ?? state.chatAutoApply;
    sendAiChatMessage(`✦ ${preset.label} → ${path}`, {
      preset,
      forceEdit: true,
      autoApply,
      path,
    });
  }

  function runAiMagicLucky() {
    const pick = document.getElementById('aiChatPresetPick');
    const presetId = pick?.value || state.chatSelectedPresetId;
    const preset = chatPresetById(presetId);
    if (!preset) {
      toast('Choose a quick action from the menu', 'error');
      return;
    }
    state.chatSelectedPresetId = presetId;
    try { localStorage.setItem('siamtex_chat_preset_id', presetId); } catch { /* */ }
    runAiChatPreset(preset, { autoApply: state.chatAutoApply });
  }

  function renderAiMagicBar() {
    const magic = document.getElementById('aiChatMagic');
    const catSel = document.getElementById('aiChatPresetCategory');
    const pickSel = document.getElementById('aiChatPresetPick');
    const targetSel = document.getElementById('aiChatTargetFile');
    const luckyBtn = document.getElementById('aiChatLucky');
    const autoChk = document.getElementById('aiChatAutoApply');
    const usageEl = document.getElementById('aiChatMagicUsage');
    if (!magic) return;

    const show = !!(hasAiChat() && state.project);
    magic.classList.toggle('hidden', !show);
    document.getElementById('aiChatModeWrap')?.classList.toggle('hidden', !show);
    if (!show) return;

    const canEdit = hasAiEditInChat();
    if (luckyBtn) {
      luckyBtn.disabled = !canEdit || state.chatBusy;
      luckyBtn.title = canEdit
        ? 'Run the selected filter on the target file'
        : 'Edit access required';
    }
    if (usageEl) {
      const text = document.getElementById('aiChatUsage')?.textContent?.trim() || '';
      usageEl.textContent = text || (state.chatBusy ? 'Working…' : '');
      usageEl.classList.toggle('hidden', !text && !state.chatBusy);
      usageEl.classList.toggle('busy', state.chatBusy);
    }

    if (autoChk) {
      autoChk.checked = !!state.chatAutoApply;
      autoChk.disabled = !canEdit;
    }

    if (targetSel) {
      const paths = chatAttachableFiles();
      const active = state.activePath || state.project?.mainFile || '';
      const opts = [`<option value="__active__">@active (${esc(active || 'current file')})</option>`];
      paths.forEach((p) => {
        if (p !== active) opts.push(`<option value="${esc(p)}">${esc(p)}</option>`);
      });
      targetSel.innerHTML = opts.join('');
      const saved = state.chatEditTarget;
      targetSel.value = (saved && saved !== '__active__' && paths.includes(saved)) ? saved : '__active__';
    }

    if (!AI_CHAT_PRESET_CATEGORIES.some((c) => c.id === state.chatPresetCategory)) {
      state.chatPresetCategory = AI_CHAT_PRESET_CATEGORIES[0]?.id || 'polish';
    }

    if (catSel) {
      catSel.innerHTML = AI_CHAT_PRESET_CATEGORIES.map((cat) => (
        `<option value="${esc(cat.id)}"${cat.id === state.chatPresetCategory ? ' selected' : ''}>${esc(cat.label)}</option>`
      )).join('');
    }

    const activeCat = AI_CHAT_PRESET_CATEGORIES.find((c) => c.id === state.chatPresetCategory)
      || AI_CHAT_PRESET_CATEGORIES[0];
    if (pickSel) {
      pickSel.innerHTML = (activeCat?.presets || []).map((p) => (
        `<option value="${esc(p.id)}"${p.id === state.chatSelectedPresetId ? ' selected' : ''}>${esc(p.label)}</option>`
      )).join('');
      if (!pickSel.value && activeCat?.presets?.[0]) {
        pickSel.value = activeCat.presets[0].id;
        state.chatSelectedPresetId = activeCat.presets[0].id;
      }
    }
  }

  function wireAiMagicBar() {
    if (wireAiMagicBar.done) return;
    wireAiMagicBar.done = true;

    document.getElementById('aiChatPresetCategory')?.addEventListener('change', (e) => {
      state.chatPresetCategory = e.target.value || 'polish';
      try { localStorage.setItem('siamtex_chat_preset_cat', state.chatPresetCategory); } catch { /* */ }
      state.chatSelectedPresetId = '';
      renderAiMagicBar();
    });
    document.getElementById('aiChatPresetPick')?.addEventListener('change', (e) => {
      state.chatSelectedPresetId = e.target.value || '';
      try { localStorage.setItem('siamtex_chat_preset_id', state.chatSelectedPresetId); } catch { /* */ }
    });
    document.getElementById('aiChatTargetFile')?.addEventListener('change', (e) => {
      state.chatEditTarget = e.target.value || '';
    });
    document.getElementById('aiChatAutoApply')?.addEventListener('change', (e) => {
      state.chatAutoApply = !!e.target.checked;
      try {
        localStorage.setItem('siamtex_chat_auto_apply', state.chatAutoApply ? '1' : '0');
      } catch { /* */ }
    });
    document.getElementById('aiChatLucky')?.addEventListener('click', () => runAiMagicLucky());
  }

  function updateAiChatChrome() {
    const modelEl = document.getElementById('aiChatModel');
    const ctxEl = document.getElementById('aiChatContext');
    const attachBtn = document.getElementById('aiChatAttachActive');
    const hintEl = document.getElementById('aiChatComposeHint');
    if (modelEl) modelEl.textContent = effectiveAiModel() || 'AI model';
    if (ctxEl) ctxEl.textContent = chatContextLabel();
    if (attachBtn) attachBtn.classList.toggle('hidden', !state.project);
    if (hintEl) {
      hintEl.innerHTML = state.project
        ? (state.chatMode === 'edit' && hasAiEditInChat()
          ? 'Edit mode — Send applies to target file (auto-apply when checked)'
          : 'Ask mode — Q&amp;A with <code>@file</code> context')
        : 'Open a project to attach files with <code>@filename</code>';
    }
    setChatMode(state.chatMode);
    renderAiMagicBar();
    const empty = document.querySelector('.ai-chat-empty');
    if (empty && state.chatOpen && !state.chatMessages.length) {
      renderAiChatMessages();
    }
  }

  async function runAiChatStream(payload, handlers) {
    const ac = handlers.signal || new AbortController();
    let finalData = null;
    const res = await fetch(BASE + '/api/ai_stream.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-SiamTeX-CSRF': '1' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      if (ct.includes('application/json')) {
        const err = await res.json();
        throw new Error(err.error || res.statusText);
      }
      throw new Error((await res.text()) || res.statusText);
    }
    if (!res.body || !ct.includes('text/event-stream')) {
      throw new Error('Chat stream unavailable.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const wait = {
      appendStream(t) { handlers.onDelta?.(t); },
      appendReasoning(t) { handlers.onReasoning?.(t); },
      setPhase() {},
      setTokenUsage(u) { handlers.onUsage?.(u); },
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        parseSseBlock(chunk, wait, (p) => { finalData = p; });
      }
    }
    if (buffer.trim()) {
      parseSseBlock(buffer.trim(), wait, (p) => { finalData = p; });
    }
    if (!finalData) throw new Error('Chat ended without a response.');
    return finalData;
  }

  async function sendAiChatEditMessage(instruction, options = {}) {
    const preset = options.preset;
    const displayText = options.displayText || (preset ? `✦ ${preset.label}` : instruction);
    const parsed = options.parsed || parseChatMentions(displayText);
    const path = getChatEditTargetPath(parsed.attachPaths, options.path);

    if (!path || isBinaryFile({ path })) {
      toast('Open a .tex or text file to edit with AI', 'error');
      return;
    }

    const autoApply = options.autoApply !== false && (options.autoApply ?? state.chatAutoApply);

    state.chatMessages.push({
      role: 'user',
      content: displayText,
      attachedFiles: [path],
      presetId: preset?.id,
    });
    state.chatMessages.push({
      role: 'assistant',
      content: '',
      reasoning: `Rewriting ${path}…`,
      editResult: null,
      editPath: path,
    });
    const assistantIdx = state.chatMessages.length - 1;
    renderAiChatMessages();
    saveChatHistory();

    const ac = new AbortController();
    state.chatAbort = ac;
    setAiChatBusy(true);
    renderAiMagicBar();

    const mount = document.getElementById('aiChatMessages');
    const bodyEl = mount?.querySelector('.ai-chat-msg:last-child .ai-chat-msg-body');
    let streamBuf = '';
    let lastUsage = null;

    const renderStreaming = () => {
      const msg = state.chatMessages[assistantIdx];
      const think = msg.reasoning || '';
      let html = '';
      if (think) html += renderChatThinking(think, true);
      if (streamBuf) {
        html += `<pre class="ai-chat-edit-stream">${esc(streamBuf)}</pre>`;
      }
      if (bodyEl) {
        bodyEl.classList.add('ai-chat-msg-streaming');
        bodyEl.innerHTML = html;
        mount.scrollTop = mount.scrollHeight;
      }
    };

    try {
      const data = await runAiChatStream({
        mode: 'file',
        projectId: state.project.id,
        path,
        instruction: instruction.trim(),
      }, {
        signal: ac,
        onDelta(t) {
          streamBuf += t;
          state.chatMessages[assistantIdx].content = streamBuf;
          renderStreaming();
        },
        onReasoning(t) {
          state.chatMessages[assistantIdx].reasoning = (state.chatMessages[assistantIdx].reasoning || '') + t;
          renderStreaming();
        },
        onUsage(u) {
          lastUsage = u;
          const el = document.getElementById('aiChatUsage');
          if (el && u) el.textContent = formatTokenUsage(u, { short: true });
          state.chatMessages[assistantIdx].reasoning = `Rewriting ${path}… ${formatTokenUsage(u, { short: true })}`;
          renderStreaming();
        },
      });

      const result = data.result || {};
      const content = result.content || streamBuf;
      state.chatMessages[assistantIdx].editResult = { mode: 'file', result: { ...result, path, content } };
      state.chatMessages[assistantIdx].editPath = path;
      state.chatMessages[assistantIdx].usage = data.usage || lastUsage;
      const summary = result.summary || `Updated ${path}`;
      state.chatMessages[assistantIdx].reasoning = `Done — ${summary}${data.usage ? ` · ${formatTokenUsage(data.usage, { short: true })}` : ''}`;
      state.chatMessages[assistantIdx].content = `${summary}\n\n\`\`\`latex\n${content}\n\`\`\``;
      applyAiUsageFromResponse(data);
      saveChatHistory();
      renderAiChatMessages();

      if (autoApply && hasAiEditInChat()) {
        try {
          await applyChatMessageEdit(state.chatMessages[assistantIdx]);
          state.chatMessages[assistantIdx].autoApplied = true;
          saveChatHistory();
          renderAiChatMessages();
          toast(`✦ Applied to ${path}${data.usage ? ` — ${formatTokenUsage(data.usage)}` : ''}`, 'ok');
          state.editor?.focus?.();
        } catch (e) {
          toast(`Edit ready — tap Replace in editor (${e.message})`, 'error');
        }
      } else {
        toast('Edit ready — tap Replace in editor or turn on Auto-apply', 'ok');
      }
    } catch (e) {
      if (e.name === 'AbortError' || e.message.includes('cancelled')) {
        if (!state.chatMessages[assistantIdx].content) {
          state.chatMessages.pop();
          state.chatMessages.pop();
        }
      } else {
        state.chatMessages[assistantIdx].content = state.chatMessages[assistantIdx].content
          || `Error: ${e.message}`;
        toast(e.message, 'error');
      }
      saveChatHistory();
      renderAiChatMessages();
    } finally {
      state.chatAbort = null;
      setAiChatBusy(false);
      renderAiMagicBar();
      const usageEl = document.getElementById('aiChatUsage');
      if (usageEl) usageEl.textContent = '';
    }
  }

  async function sendAiChatMessage(text, options = {}) {
    const preset = options.preset;
    const raw = String(text || '').trim();
    const instruction = preset?.instruction || options.instruction || raw;
    if (!instruction || state.chatBusy || !hasAiChat()) return;

    const useEdit = !!(preset || options.forceEdit || (state.chatMode === 'edit' && hasAiEditInChat()));
    if (useEdit && hasAiEditInChat()) {
      await sendAiChatEditMessage(instruction, {
        ...options,
        preset,
        parsed: parseChatMentions(raw || instruction),
        displayText: raw || (preset ? `✦ ${preset.label}` : instruction),
        autoApply: options.autoApply ?? state.chatAutoApply,
      });
      return;
    }

    const parsed = parseChatMentions(raw);
    if (parsed.wantsSelection && !chatSelectionPayload(true)) {
      toast('Highlight text in the editor for @selection, or remove @selection.', 'error');
      return;
    }
    if (state.project && /@([a-zA-Z0-9_.\/-]+)/.test(raw)) {
      const tokens = [...raw.matchAll(/@([a-zA-Z0-9_.\/-]+)/g)].map((m) => m[1]);
      const unknown = tokens.filter((t) => {
        const lower = t.toLowerCase();
        if (['active', 'current', '.', 'selection'].includes(lower)) return false;
        return !resolveChatMentionToken(t);
      });
      if (unknown.length) {
        toast(`Unknown file @${unknown[0]} — check the file list or use @active`, 'error');
        return;
      }
    }

    const attachPaths = parsed.attachPaths;
    const selection = chatSelectionPayload(parsed.wantsSelection);

    state.chatMessages.push({ role: 'user', content: parsed.text, attachedFiles: attachPaths });
    state.chatMessages.push({ role: 'assistant', content: '', reasoning: '' });
    const assistantIdx = state.chatMessages.length - 1;
    renderAiChatMessages();
    saveChatHistory();

    const ac = new AbortController();
    state.chatAbort = ac;
    setAiChatBusy(true);

    const mount = document.getElementById('aiChatMessages');
    const bodyEl = mount?.querySelector('.ai-chat-msg:last-child .ai-chat-msg-body');

    try {
      const data = await runAiChatStream({
        mode: 'chat',
        projectId: state.project?.id || '',
        messages: state.chatMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        context: chatContextPayload(),
        attachPaths,
        selection,
      }, {
        signal: ac,
        onDelta(t) {
          state.chatMessages[assistantIdx].content += t;
          if (bodyEl) {
            scheduleChatStreamRender(
              bodyEl,
              mount,
              state.chatMessages[assistantIdx].content,
              state.chatMessages[assistantIdx].reasoning || '',
            );
          }
        },
        onReasoning(t) {
          state.chatMessages[assistantIdx].reasoning = (state.chatMessages[assistantIdx].reasoning || '') + t;
          if (bodyEl) {
            scheduleChatStreamRender(
              bodyEl,
              mount,
              state.chatMessages[assistantIdx].content,
              state.chatMessages[assistantIdx].reasoning || '',
            );
          }
        },
        onUsage(u) {
          const el = document.getElementById('aiChatUsage');
          if (el && u) el.textContent = formatTokenUsage(u, { short: true });
        },
      });

      if (data.message && !state.chatMessages[assistantIdx].content) {
        state.chatMessages[assistantIdx].content = data.message;
      }
      if (data.reasoning && !state.chatMessages[assistantIdx].reasoning) {
        state.chatMessages[assistantIdx].reasoning = data.reasoning;
      }
      if (data.attachedFiles?.length && state.chatMessages[assistantIdx - 1]) {
        state.chatMessages[assistantIdx - 1].attachedFiles = data.attachedFiles;
      }
      applyAiUsageFromResponse(data);
      saveChatHistory();
      flushChatStreamRender(
        bodyEl,
        mount,
        state.chatMessages[assistantIdx].content,
        state.chatMessages[assistantIdx].reasoning || '',
      );
      renderAiChatMessages();
    } catch (e) {
      if (e.name === 'AbortError' || e.message.includes('cancelled')) {
        if (!state.chatMessages[assistantIdx].content) {
          state.chatMessages.pop();
          state.chatMessages.pop();
        }
      } else {
        state.chatMessages[assistantIdx].content = state.chatMessages[assistantIdx].content
          || `Error: ${e.message}`;
        toast(e.message, 'error');
      }
      saveChatHistory();
      renderAiChatMessages();
    } finally {
      state.chatAbort = null;
      setAiChatBusy(false);
      const usageEl = document.getElementById('aiChatUsage');
      if (usageEl) usageEl.textContent = '';
    }
  }

  function hideChatMentionMenu() {
    const menu = document.getElementById('aiChatMentionMenu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.innerHTML = '';
    state.chatMentionIdx = -1;
  }

  function chatMentionCandidates(query) {
    const q = String(query || '').toLowerCase();
    const items = [];
    if (state.project) {
      items.push({ token: 'active', label: '@active', hint: state.activePath || 'open file' });
      if (state.editor?.getSelection?.()?.trim()) {
        items.push({ token: 'selection', label: '@selection', hint: 'editor highlight' });
      }
      chatAttachableFiles().forEach((path) => {
        const base = path.split('/').pop();
        if (!q || path.toLowerCase().includes(q) || base.toLowerCase().includes(q)) {
          items.push({ token: path, label: '@' + path, hint: base });
        }
      });
    }
    return items.slice(0, 12);
  }

  function insertChatMention(token) {
    const input = document.getElementById('aiChatInput');
    if (!input) return;
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const at = before.lastIndexOf('@');
    if (at < 0) return;
    const insert = '@' + token + ' ';
    input.value = before.slice(0, at) + insert + after;
    const caret = at + insert.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    hideChatMentionMenu();
  }

  function updateChatMentionMenu() {
    const input = document.getElementById('aiChatInput');
    const menu = document.getElementById('aiChatMentionMenu');
    if (!input || !menu || !state.project) {
      hideChatMentionMenu();
      return;
    }
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const at = before.lastIndexOf('@');
    if (at < 0 || /\s/.test(before.slice(at + 1))) {
      hideChatMentionMenu();
      return;
    }
    const query = before.slice(at + 1);
    const items = chatMentionCandidates(query);
    if (!items.length) {
      hideChatMentionMenu();
      return;
    }
    state.chatMentionIdx = Math.min(Math.max(state.chatMentionIdx, 0), items.length - 1);
    menu.classList.remove('hidden');
    menu.innerHTML = items.map((item, i) => (
      `<button type="button" class="ai-chat-mention-item${i === state.chatMentionIdx ? ' active' : ''}" data-token="${esc(item.token)}">
        <span class="ai-chat-mention-label">${esc(item.label)}</span>
        <span class="ai-chat-mention-hint">${esc(item.hint)}</span>
      </button>`
    )).join('');
    menu.querySelectorAll('.ai-chat-mention-item').forEach((btn, i) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertChatMention(btn.getAttribute('data-token'));
      });
      btn.addEventListener('mouseenter', () => { state.chatMentionIdx = i; });
    });
  }

  function clearAiChat() {
    if (state.chatBusy) return;
    state.chatMessages = [];
    saveChatHistory();
    renderAiChatMessages();
    document.getElementById('aiChatInput')?.focus();
  }

  function initAiChatPanel() {
    if (!hasAiChat() || aiChatMounted) return;
    aiChatMounted = true;

    const panel = document.createElement('aside');
    panel.id = 'aiChatPanel';
    panel.className = 'ai-chat-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'AI chat');
    panel.innerHTML = `
      <header class="ai-chat-header">
        <div class="ai-chat-header-copy">
          <strong>✦ AI</strong>
          <span id="aiChatModel" class="ai-chat-model"></span>
          <span id="aiChatContext" class="ai-chat-context"></span>
        </div>
        <div class="ai-chat-header-actions">
          <button type="button" id="aiChatClear" class="ghost" title="New conversation">Clear</button>
          <button type="button" id="aiChatClose" class="ghost" title="Close panel">×</button>
        </div>
      </header>
      <div class="ai-chat-magic" id="aiChatMagic">
        <div class="ai-chat-magic-row">
          <label class="ai-chat-magic-field">
            <span class="ai-chat-magic-label">Target file</span>
            <select id="aiChatTargetFile" title="File to rewrite — @active follows the editor"></select>
          </label>
          <label class="ai-chat-magic-field">
            <span class="ai-chat-magic-label">Category</span>
            <select id="aiChatPresetCategory"></select>
          </label>
          <label class="ai-chat-magic-field ai-chat-magic-field-grow">
            <span class="ai-chat-magic-label">Filter</span>
            <select id="aiChatPresetPick"></select>
          </label>
        </div>
        <div class="ai-chat-magic-actions">
          <button type="button" id="aiChatLucky" class="primary ai-sparkle-btn ai-chat-apply-btn">Apply filter</button>
          <span id="aiChatMagicUsage" class="ai-chat-magic-usage hidden" aria-live="polite"></span>
          <label class="ai-chat-auto-apply">
            <input type="checkbox" id="aiChatAutoApply" checked />
            <span>Auto-apply to editor</span>
          </label>
          <div class="ai-chat-mode" id="aiChatModeWrap" role="group" aria-label="Chat mode">
            <button type="button" class="ai-chat-mode-btn" data-mode="edit">Edit</button>
            <button type="button" class="ai-chat-mode-btn" data-mode="ask">Ask</button>
          </div>
        </div>
        <p class="ai-chat-magic-hint">Defaults to the open editor file. Type <code>@chapter.tex</code> in the box below to target another file.</p>
      </div>
      <div class="ai-chat-messages" id="aiChatMessages" role="log" aria-live="polite"></div>
      <form id="aiChatForm" class="ai-chat-compose">
        <div class="ai-chat-compose-top" id="aiChatComposeTop">
          <button type="button" id="aiChatAttachActive" class="ghost ai-chat-attach-btn hidden" title="Insert @active">+ @active</button>
          <span class="ai-chat-compose-hint" id="aiChatComposeHint">Type <code>@file</code> in a project to attach sources</span>
        </div>
        <div class="ai-chat-input-wrap">
          <textarea id="aiChatInput" rows="3" placeholder="Edit mode: describe changes for the target file…"></textarea>
          <div class="ai-chat-mention-menu hidden" id="aiChatMentionMenu" role="listbox"></div>
        </div>
        <div class="ai-chat-compose-actions">
          <span id="aiChatUsage" class="ai-chat-usage"></span>
          <button type="button" id="aiChatStop" class="ghost hidden">Stop</button>
          <button type="submit" id="aiChatSend" class="primary">Send</button>
        </div>
      </form>`;

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'aiChatFab';
    fab.className = 'ai-chat-fab ai-sparkle-btn';
    fab.title = 'AI — chat & edits';
    fab.setAttribute('aria-expanded', 'false');
    fab.textContent = '✦';

    document.getElementById('app')?.append(panel, fab);

    fab.addEventListener('click', () => toggleAiChatPanel());
    document.getElementById('aiChatClose')?.addEventListener('click', () => toggleAiChatPanel(false));
    document.getElementById('aiChatClear')?.addEventListener('click', clearAiChat);
    document.getElementById('aiChatStop')?.addEventListener('click', () => {
      state.chatAbort?.abort();
      setAiChatBusy(false);
    });

    const form = document.getElementById('aiChatForm');
    const input = document.getElementById('aiChatInput');
    document.getElementById('aiChatAttachActive')?.addEventListener('click', () => {
      if (!input) return;
      const suffix = input.value && !input.value.endsWith(' ') ? ' ' : '';
      input.value += `${suffix}@active `;
      input.focus();
      updateChatMentionMenu();
    });
    document.querySelectorAll('.ai-chat-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setChatMode(btn.getAttribute('data-mode')));
    });
    wireAiMagicBar();
    renderAiMagicBar();
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!document.getElementById('aiChatMentionMenu')?.classList.contains('hidden')) return;
      const t = input?.value || '';
      if (input) input.value = '';
      hideChatMentionMenu();
      sendAiChatMessage(t);
    });
    input?.addEventListener('input', () => {
      state.chatMentionIdx = 0;
      updateChatMentionMenu();
    });
    input?.addEventListener('keydown', (e) => {
      const menu = document.getElementById('aiChatMentionMenu');
      const menuOpen = menu && !menu.classList.contains('hidden');
      if (menuOpen) {
        const items = menu.querySelectorAll('.ai-chat-mention-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.chatMentionIdx = Math.min(state.chatMentionIdx + 1, items.length - 1);
          updateChatMentionMenu();
          items[state.chatMentionIdx]?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.chatMentionIdx = Math.max(state.chatMentionIdx - 1, 0);
          updateChatMentionMenu();
          items[state.chatMentionIdx]?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const active = items[state.chatMentionIdx];
          if (active) insertChatMention(active.getAttribute('data-token'));
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hideChatMentionMenu();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form?.requestSubmit();
      }
    });
    input?.addEventListener('blur', () => {
      setTimeout(hideChatMentionMenu, 150);
    });

    loadChatHistory();
    updateAiChatChrome();
    if (localStorage.getItem('siamtex_chat_open') === '1') {
      toggleAiChatPanel(true);
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function canEditProject(p) {
    if (!p) return false;
    return p.role === 'owner' || p.role === 'edit';
  }

  /* ---------- Insert helpers (beginner toolbar) ---------- */

  const SNIPPETS = {
    bold: { wrap: ['\\textbf{', '}'], label: 'Bold' },
    italic: { wrap: ['\\textit{', '}'], label: 'Italic' },
    underline: { wrap: ['\\underline{', '}'], label: 'Underline' },
    emph: { wrap: ['\\emph{', '}'], label: 'Emphasis' },
    color: { wrap: ['\\textcolor{blue}{', '}'], label: 'Color' },
    large: { wrap: ['{\\large ', '}'], label: 'Larger' },
    small: { wrap: ['{\\small ', '}'], label: 'Smaller' },
    section: { wrap: ['\\section{', '}'], label: 'Heading' },
    subsection: { wrap: ['\\subsection{', '}'], label: 'Subheading' },
    subsubsection: { wrap: ['\\subsubsection{', '}'], label: 'Sub-subheading' },
    link: { wrap: ['\\href{https://example.com}{', '}'], label: 'Link' },
    email: { wrap: ['\\href{mailto:you@example.com}{', '}'], label: 'Email link' },
    itemize: {
      block: '\\begin{itemize}\n  \\item First item\n  \\item Second item\n\\end{itemize}\n',
      label: 'Bullet list',
    },
    enumerate: {
      block: '\\begin{enumerate}\n  \\item First\n  \\item Second\n\\end{enumerate}\n',
      label: 'Numbered list',
    },
    item: { wrap: ['\\item ', ''], label: 'List item' },
    quote: {
      block: '\\begin{quote}\nQuoted text here.\n\\end{quote}\n',
      label: 'Quote',
    },
    center: {
      block: '\\begin{center}\nCentered text\n\\end{center}\n',
      label: 'Center',
    },
    hline: { block: '\\hrule\n\\vspace{6pt}\n', label: 'Horizontal line' },
    newline: { block: '\\\\\n', label: 'New line' },
    vspace: { block: '\\vspace{12pt}\n', label: 'Vertical space' },
    mathInline: { wrap: ['$', '$'], label: 'Inline math' },
    mathBlock: { wrap: ['\\[\n', '\n\\]\n'], label: 'Math block' },
    fraction: { wrap: ['\\frac{', '}{b}'], label: 'Fraction' },
    sqrt: { wrap: ['\\sqrt{', '}'], label: 'Square root' },
    sum: { block: '\\sum_{i=1}^{n} ', label: 'Sum' },
    image: {
      block: '% Upload an image with + File, then use its filename here.\n% Requires: \\usepackage{graphicx} in the preamble (main.tex)\n\\includegraphics[width=0.5\\textwidth]{photo.png}\n',
      label: 'Image',
    },
    table: {
      block: '\\begin{tabular}{|l|l|}\n\\hline\nA & B \\\\\n\\hline\nC & D \\\\\n\\hline\n\\end{tabular}\n',
      label: 'Table',
    },
    footnote: { wrap: ['\\footnote{', '}'], label: 'Footnote' },
    comment: { wrap: ['% ', ''], label: 'Comment' },
    resumeSection: { wrap: ['\\section{', '}'], label: 'Resume section' },
    resumeJob: {
      block: '\\textbf{Job Title} — Company Name \\hfill Dates\\\\\n\\begin{itemize}\n  \\item Achievement with impact.\n  \\item Another highlight.\n\\end{itemize}\n\n',
      label: 'Job entry',
    },
    resumeSkill: {
      block: '\\textbf{Category:} skill one, skill two, skill three\n\n',
      label: 'Skills line',
    },
    resumeHeader: {
      block: '\\begin{center}\n{\\LARGE\\bfseries Your Name}\\\\[4pt]\nemail@example.com $\\cdot$ City, ST $\\cdot$ linkedin.com/in/you\n\\end{center}\n\n',
      label: 'Name header',
    },
    geometry: {
      block: '% Page margins (put in preamble, near the top)\n\\usepackage[margin=0.7in]{geometry}\n',
      label: 'Page margins',
    },
    fontsize10: { block: '% Change document class options, e.g. \\documentclass[10pt]{article}\n', label: 'Tip: font size' },
  };

  function insertSnippet(key) {
    const ed = state.editor;
    if (!ed || ed.getOption('readOnly')) {
      toast('Editor is read-only', 'error');
      return;
    }
    const snip = SNIPPETS[key];
    if (!snip) return;
    const doc = ed.getDoc();
    const selected = doc.getSelection();

    if (snip.wrap) {
      const [left, right] = snip.wrap;
      if (selected) {
        doc.replaceSelection(left + selected + right);
      } else {
        const cur = doc.getCursor();
        doc.replaceRange(left + right, cur);
        doc.setCursor({ line: cur.line, ch: cur.ch + left.length });
      }
    } else if (snip.block) {
      const cur = doc.getCursor();
      doc.replaceRange(snip.block, cur);
    }
    ed.focus();
    markDirtyFromEditor();
    scheduleAutoCompile();
  }

  const INSERT_MENUS = [
    {
      id: 'text',
      label: 'Text',
      items: ['bold', 'italic', 'underline', 'emph', 'color', 'large', 'small'],
    },
    {
      id: 'structure',
      label: 'Structure',
      items: ['section', 'subsection', 'subsubsection', 'itemize', 'enumerate', 'item', 'link', 'email', 'quote', 'center', 'hline', 'newline', 'vspace'],
    },
    {
      id: 'math',
      label: 'Math',
      items: ['mathInline', 'mathBlock', 'fraction', 'sqrt', 'sum'],
    },
    {
      id: 'resume',
      label: 'Resume',
      items: ['resumeHeader', 'resumeSection', 'resumeJob', 'resumeSkill', 'geometry', 'fontsize10'],
    },
    {
      id: 'insert',
      label: 'Insert',
      items: ['table', 'image', 'footnote', 'comment'],
    },
  ];

  const QUICK_SNIPPETS = ['bold', 'italic', 'underline'];

  function snippetHint(key) {
    const snip = SNIPPETS[key];
    if (!snip) return '';
    if (snip.wrap) {
      const [left, right] = snip.wrap;
      const sample = left.replace(/\\begin\{[^}]+\}/, '').replace(/^\\/, '').replace(/\{$/, '');
      return sample + (right ? '…' : '');
    }
    if (snip.block) {
      const line = snip.block.split('\n').find((l) => l.trim() && !l.trim().startsWith('%'));
      return line ? line.trim().slice(0, 28) + (line.trim().length > 28 ? '…' : '') : '';
    }
    return '';
  }

  function menuEntryHtml(key) {
    const snip = SNIPPETS[key];
    if (!snip) return '';
    const hint = snippetHint(key);
    return `<button type="button" class="menu-entry" role="menuitem" data-snip="${key}">
      <span class="menu-entry-label">${esc(snip.label)}</span>
      ${hint ? `<span class="menu-entry-hint">${esc(hint)}</span>` : ''}
    </button>`;
  }

  function toolbarHtml(canEdit) {
    if (!canEdit) {
      return '<div class="insert-menubar"><span class="toolbar-hint">View only</span></div>';
    }

    const quickBtns = QUICK_SNIPPETS.map((key) => {
      const snip = SNIPPETS[key];
      const glyph = key === 'bold' ? '<strong>B</strong>' : key === 'italic' ? '<em>I</em>' : '<span style="text-decoration:underline">U</span>';
      return `<button type="button" class="tb-icon" data-snip="${key}" title="${esc(snip?.label || key)}">${glyph}</button>`;
    }).join('');

    const menus = INSERT_MENUS.map((menu) => `
      <div class="menu-item" data-menu="${menu.id}">
        <button type="button" class="menu-trigger" aria-haspopup="true" aria-expanded="false">${esc(menu.label)}</button>
        <div class="menu-dropdown" role="menu" hidden>
          ${menu.items.map(menuEntryHtml).join('')}
        </div>
      </div>`).join('');

    return `
      <div class="insert-menubar" id="insertToolbar">
        <div class="insert-menubar-row">
          <div class="insert-quick" aria-label="Quick formatting">
            ${quickBtns}
            <span class="menubar-sep" aria-hidden="true"></span>
          </div>
          <nav class="menubar" role="menubar" aria-label="Insert LaTeX">
            ${menus}
          </nav>
        </div>
        <p class="toolbar-hint">Select text, then use <strong>B</strong> / <em>I</em> / <u>U</u> or pick an item from the menus — snippets are inserted at the cursor.</p>
      </div>`;
  }

  function closeInsertMenus(except) {
    document.querySelectorAll('#insertToolbar .menu-item').forEach((item) => {
      if (except && item === except) return;
      item.classList.remove('open');
      const trigger = item.querySelector('.menu-trigger');
      const panel = item.querySelector('.menu-dropdown');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    });
  }

  function bindToolbar() {
    const bar = document.getElementById('insertToolbar');
    if (!bar) return;

    bar.querySelectorAll('[data-snip]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        insertSnippet(btn.getAttribute('data-snip'));
        closeInsertMenus();
      });
    });

    bar.querySelectorAll('.menu-trigger').forEach((trigger) => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = trigger.closest('.menu-item');
        const panel = item?.querySelector('.menu-dropdown');
        if (!item || !panel) return;
        const willOpen = !item.classList.contains('open');
        closeInsertMenus();
        if (willOpen) {
          item.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
          panel.hidden = false;
          panel.querySelector('.menu-entry')?.focus();
        }
      });
    });

    if (!bar.dataset.menusBound) {
      bar.dataset.menusBound = '1';
      document.addEventListener('click', () => closeInsertMenus());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeInsertMenus();
      });
    }
  }

  /* ---------- Top bar / dashboard ---------- */

  function aiCan(feature) {
    return !!(state.aiEnabled && state.aiPermissions && state.aiPermissions[feature]);
  }

  /** Structured AI assist (edit file / project) — included with chat access. */
  function hasAiAssist() {
    if (!state.aiEnabled || !state.project || !canEditProject(state.project)) return false;
    if (state.isAdmin) return true;
    return aiCan('assist') || aiCan('chat');
  }

  function hasAiChat() {
    return aiCan('chat');
  }

  /** Structured edits in chat (file rewrites, presets, replace in editor). */
  function hasAiEditInChat() {
    if (!state.aiEnabled || !state.project || !canEditProject(state.project)) return false;
    if (state.isAdmin) return true;
    return aiCan('assist') || aiCan('chat');
  }

  function chatPresetById(id) {
    for (const cat of AI_CHAT_PRESET_CATEGORIES) {
      const hit = cat.presets.find((p) => p.id === id);
      if (hit) return { ...hit, category: cat.label };
    }
    return null;
  }

  function resolveChatEditPath(attachPaths) {
    if (attachPaths?.length) return attachPaths[0];
    return state.activePath || state.project?.mainFile || null;
  }

  function extractChatApplyPayload(msg) {
    if (!msg) return null;
    if (msg.editResult?.mode === 'file' && msg.editResult.result?.content != null) {
      return { mode: 'file', result: msg.editResult.result };
    }
    if (msg.editResult?.mode === 'project' && msg.editResult.result?.files) {
      return { mode: 'project', result: msg.editResult.result };
    }
    if (msg.editResult?.mode === 'snippet' && msg.editResult.content != null) {
      return msg.editResult;
    }
    const parts = splitChatMarkdown(msg.content || '');
    const code = parts.find((p) => p.type === 'code' && /^(latex|tex|text)?$/i.test(p.lang || ''));
    if (code && state.project) {
      const path = msg.editPath || state.activePath || state.project.mainFile;
      if (path) {
        return { mode: 'file', result: { path, content: code.content, summary: 'From chat reply' } };
      }
    }
    return null;
  }

  function chatMessageActionsHtml(m) {
    if (m.role !== 'assistant' || (!m.content?.trim() && !m.editResult)) return '';
    const canApply = hasAiEditInChat() && !!extractChatApplyPayload(m);
    return `<div class="ai-chat-msg-actions">
      <button type="button" class="ghost ai-chat-msg-copy" title="Copy reply">Copy</button>
      ${canApply ? `<button type="button" class="primary ai-chat-msg-apply" title="Replace ${esc(m.editPath || state.activePath || 'editor')}">${m.autoApplied ? 'Re-apply to editor' : 'Replace in editor'}</button>` : ''}
    </div>`;
  }

  function isCompileEntry(path) {
    return /\.tex$/i.test(path || '') && !String(path).includes('/');
  }

  function compileEntryForActive() {
    const path = state.activePath;
    if (path && isCompileEntry(path)) return path;
    return state.project?.mainFile || 'main.tex';
  }

  function previewEntry() {
    return compileEntryForActive();
  }

  function hasPdfForEntry(entry) {
    if (!state.project) return false;
    const list = state.project.pdfEntries || [];
    return list.includes(entry);
  }

  function updatePreviewLabel() {
    const label = document.getElementById('previewLabel');
    if (!label) return;
    const entry = previewEntry();
    label.textContent = `PDF preview — ${entry}`;
  }

  function loadPaneLayout() {
    try {
      const raw = JSON.parse(localStorage.getItem('siamtex_pane_layout') || '{}');
      return {
        split: typeof raw.split === 'number' ? Math.min(0.85, Math.max(0.15, raw.split)) : 0.5,
        editorCollapsed: !!raw.editorCollapsed,
        previewCollapsed: !!raw.previewCollapsed,
      };
    } catch {
      return { split: 0.5, editorCollapsed: false, previewCollapsed: false };
    }
  }

  function savePaneLayout() {
    try {
      localStorage.setItem('siamtex_pane_layout', JSON.stringify(state.paneLayout));
    } catch {
      /* quota */
    }
  }

  function applyPaneLayout() {
    const root = document.getElementById('splitPanes');
    if (!root) return;
    const L = state.paneLayout;
    root.classList.toggle('editor-collapsed', L.editorCollapsed);
    root.classList.toggle('preview-collapsed', L.previewCollapsed);
    root.classList.toggle('both-collapsed', L.editorCollapsed && L.previewCollapsed);
    root.style.setProperty('--editor-flex', String(L.editorCollapsed ? 0 : L.split * 1000));
    root.style.setProperty('--preview-flex', String(L.previewCollapsed ? 0 : (1 - L.split) * 1000));
    const splitter = document.getElementById('paneSplitter');
    if (splitter) splitter.setAttribute('aria-valuenow', String(Math.round(L.split * 100)));
    if (state.editor?.refresh) {
      requestAnimationFrame(() => state.editor.refresh());
    }
  }

  function collapsePane(which) {
    if (which === 'editor') state.paneLayout.editorCollapsed = true;
    else state.paneLayout.previewCollapsed = true;
    savePaneLayout();
    applyPaneLayout();
  }

  function restorePane(which) {
    if (which === 'editor') state.paneLayout.editorCollapsed = false;
    else state.paneLayout.previewCollapsed = false;
    savePaneLayout();
    applyPaneLayout();
  }

  function toggleMaximizePane(which) {
    const L = state.paneLayout;
    const selfCollapsed = which === 'editor' ? L.editorCollapsed : L.previewCollapsed;
    const otherCollapsed = which === 'editor' ? L.previewCollapsed : L.editorCollapsed;
    const onlySelf = !selfCollapsed && otherCollapsed;
    if (onlySelf) {
      L.editorCollapsed = false;
      L.previewCollapsed = false;
    } else {
      L.editorCollapsed = which !== 'editor';
      L.previewCollapsed = which !== 'preview';
    }
    savePaneLayout();
    applyPaneLayout();
  }

  function paneSplitVertical() {
    return window.matchMedia('(max-width: 960px)').matches;
  }

  function wirePaneLayout() {
    const root = document.getElementById('splitPanes');
    const splitter = document.getElementById('paneSplitter');
    if (!root || !splitter) return;

    applyPaneLayout();

    document.getElementById('btnCollapseEditor')?.addEventListener('click', () => collapsePane('editor'));
    document.getElementById('btnCollapsePreview')?.addEventListener('click', () => collapsePane('preview'));
    document.getElementById('btnMaxEditor')?.addEventListener('click', () => toggleMaximizePane('editor'));
    document.getElementById('btnMaxPreview')?.addEventListener('click', () => toggleMaximizePane('preview'));
    document.getElementById('restoreEditorPane')?.addEventListener('click', () => restorePane('editor'));
    document.getElementById('restorePreviewPane')?.addEventListener('click', () => restorePane('preview'));

    const setSplitFromPointer = (clientX, clientY) => {
      const rect = root.getBoundingClientRect();
      const vertical = paneSplitVertical();
      const ratio = vertical
        ? (clientY - rect.top) / rect.height
        : (clientX - rect.left) / rect.width;
      state.paneLayout.split = Math.min(0.85, Math.max(0.15, ratio));
      state.paneLayout.editorCollapsed = false;
      state.paneLayout.previewCollapsed = false;
      applyPaneLayout();
    };

    const finishDrag = () => {
      splitter.classList.remove('dragging');
      document.body.classList.remove('pane-dragging', 'pane-dragging-vertical');
      savePaneLayout();
    };

    const startDrag = (getPoint) => {
      if (state.paneLayout.editorCollapsed || state.paneLayout.previewCollapsed) return;
      splitter.classList.add('dragging');
      document.body.classList.add(paneSplitVertical() ? 'pane-dragging-vertical' : 'pane-dragging');

      const onMouseMove = (ev) => setSplitFromPointer(ev.clientX, ev.clientY);
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        finishDrag();
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      const first = getPoint();
      if (first) setSplitFromPointer(first.x, first.y);
    };

    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDrag(() => ({ x: e.clientX, y: e.clientY }));
    });

    splitter.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      splitter.classList.add('dragging');
      document.body.classList.add(paneSplitVertical() ? 'pane-dragging-vertical' : 'pane-dragging');

      const onTouchMove = (ev) => {
        if (ev.touches.length !== 1) return;
        const t = ev.touches[0];
        setSplitFromPointer(t.clientX, t.clientY);
      };
      const onTouchEnd = () => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('touchcancel', onTouchEnd);
        finishDrag();
      };
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    }, { passive: false });

    splitter.addEventListener('dblclick', () => {
      state.paneLayout.split = 0.5;
      state.paneLayout.editorCollapsed = false;
      state.paneLayout.previewCollapsed = false;
      savePaneLayout();
      applyPaneLayout();
    });

    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.05;
      const vertical = paneSplitVertical();
      const dec = vertical ? e.key === 'ArrowUp' : e.key === 'ArrowLeft';
      const inc = vertical ? e.key === 'ArrowDown' : e.key === 'ArrowRight';
      if (dec) {
        state.paneLayout.split = Math.max(0.15, state.paneLayout.split - step);
        e.preventDefault();
      } else if (inc) {
        state.paneLayout.split = Math.min(0.85, state.paneLayout.split + step);
        e.preventDefault();
      } else {
        return;
      }
      state.paneLayout.editorCollapsed = false;
      state.paneLayout.previewCollapsed = false;
      savePaneLayout();
      applyPaneLayout();
    });
  }

  function renderTop() {
    const u = state.user;
    if (!u) {
      $top().innerHTML = state.oauthConfigured
        ? `<a class="btn primary" href="${BASE}/api/auth_login.php?provider=github">Sign in with GitHub</a>`
        : `<span class="pill">Local mode</span>`;
      return;
    }
    const avatar = u.avatarUrl
      ? `<img src="${esc(u.avatarUrl)}" alt="">`
      : `<span class="logo" style="width:28px;height:28px;font-size:.9rem">∫</span>`;
    $top().innerHTML = `
      <span id="aiUsageGlobal" class="pill ai-usage-global hidden" title="Total AI tokens used on this account"></span>
      ${state.aiEnabled && aiCan('chat') ? '<button type="button" id="btnTopChat" class="ghost ai-sparkle-btn">✦ AI</button>' : ''}
      ${state.aiEnabled && aiCan('settings') ? '<button type="button" id="btnAiSettings" class="ghost">AI settings</button>' : ''}
      ${state.isAdmin ? '<button type="button" id="btnAdminAi" class="ghost">AI access</button>' : ''}
      <div class="user-chip">${avatar}<span>${esc(u.name || u.login || 'User')}</span></div>
      ${state.oauthConfigured ? `<button type="button" id="btnLogout" class="ghost">Sign out</button>` : ''}`;
    renderGlobalAiUsage();
    document.getElementById('btnTopChat')?.addEventListener('click', () => openAiPanel());
    document.getElementById('btnAiSettings')?.addEventListener('click', showAiSettings);
    document.getElementById('btnAdminAi')?.addEventListener('click', showAdminAiAccess);
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      await api('/api/auth_logout.php', { method: 'POST', json: {} });
      location.href = BASE + '/';
    });
  }

  function renderSplash() {
    $main().innerHTML = `
      <section class="card splash">
        <h1>Welcome to SiamTeX</h1>
        <p>Write LaTeX with a live PDF preview, insert buttons for common formatting, and encrypted projects.</p>
        <p style="margin-top:18px">
          <a class="btn primary" href="${BASE}/api/auth_login.php?provider=github">Sign in with GitHub</a>
        </p>
      </section>`;
  }

  function renderDashboard() {
    const projectRows = state.projects.map((p) => {
      const usage = p.aiUsage?.totalTokens
        ? `<span class="project-badge project-badge-ai" title="AI tokens used">${formatTokens(p.aiUsage.totalTokens)} tok</span>`
        : '';
      const search = [p.name, p.mainFile, p.engine, p.role, p.aiModel].filter(Boolean).join(' ').toLowerCase();
      const updated = formatRelativeTime(p.updatedAt);
      return `
      <div class="project-row" role="listitem" data-open="${esc(p.id)}" data-search="${esc(search)}"
        title="Open ${esc(p.name)}">
        <span class="project-row-icon" aria-hidden="true">📄</span>
        <span class="project-row-body">
          <span class="project-row-name">${esc(p.name)}</span>
          <span class="project-row-meta">${esc(p.mainFile)} · ${esc(p.engine)}${updated ? ` · ${esc(updated)}` : ''}</span>
        </span>
        <span class="project-row-badges">
          <span class="project-badge">${esc(p.role || 'owner')}</span>
          ${p.hasPdf ? '<span class="project-badge project-badge-ok">PDF</span>' : ''}
          ${usage}
        </span>
        <button type="button" class="ghost project-row-del" data-del="${esc(p.id)}" title="Delete project" aria-label="Delete ${esc(p.name)}">×</button>
      </div>`;
    }).join('');

    const aiBanner = aiCan('createProject') ? `
        <div class="dash-ai-banner">
          <div class="dash-ai-banner-copy">
            <span class="dash-ai-banner-icon" aria-hidden="true">✦</span>
            <div>
              <strong>New project with AI</strong>
              <span>Describe a document and get a multi-file LaTeX project.</span>
            </div>
          </div>
          <button type="button" id="btnAiNewProject" class="primary ai-sparkle-btn">Create with AI</button>
        </div>` : '';

    const templates = state.templates.map((t) => `
      <article class="template-tile">
        <div class="template-tile-head">
          <span class="template-tile-icon" aria-hidden="true">${templateIcon(t.category)}</span>
          <span class="template-tile-cat">${esc(t.category || 'general')}</span>
        </div>
        <h3 class="template-tile-name">${esc(t.name)}</h3>
        <p class="template-tile-desc">${esc(t.description)}</p>
        <p class="template-tile-files">${esc((t.files || []).join(', '))}</p>
        <button type="button" class="template-tile-btn" data-tpl="${esc(t.id)}">Create from template</button>
      </article>`).join('');

    const projectCount = state.projects.length;

    $main().innerHTML = `
      <section class="dash">
        <header class="dash-head">
          <div>
            <h1>Projects</h1>
            <p class="dash-lead">Your saved work — open a row to continue editing.</p>
          </div>
          <div class="dash-head-actions">
            <button type="button" id="btnNew" class="primary">New project</button>
            <label class="btn dash-import-btn">
              Import zip
              <input id="importFile" type="file" accept=".zip,application/zip" hidden />
            </label>
          </div>
        </header>

        ${aiBanner}

        <section class="dash-projects" aria-label="Your projects">
          <div class="dash-projects-toolbar">
            <input type="search" id="dashProjectSearch" class="dash-search" placeholder="Search projects…" autocomplete="off" />
            <span class="dash-project-count">${projectCount} project${projectCount === 1 ? '' : 's'}</span>
          </div>
          ${projectCount ? `
          <div class="project-list" role="list">${projectRows}</div>
          <p id="dashProjectNoMatch" class="dash-empty hidden">No projects match your search.</p>
          ` : `<p class="dash-empty">No projects yet — pick a template below or create a new project.</p>`}
        </section>

        <section class="dash-templates" aria-label="Templates">
          <header class="dash-templates-head">
            <h2>Templates</h2>
            <p>Starter packages — choose one to create a <em>new</em> project (not listed above until you save it).</p>
          </header>
          <div class="template-grid">${templates}</div>
        </section>
      </section>`;

    document.querySelectorAll('.project-row[data-open]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        openProject(el.getAttribute('data-open'));
      });
    });
    $main().querySelectorAll('[data-del]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this project?')) return;
        await api('/api/project.php?id=' + encodeURIComponent(el.getAttribute('data-del')), { method: 'DELETE' });
        toast('Project deleted', 'ok');
        await loadDashboard();
      });
    });
    $main().querySelectorAll('[data-tpl]').forEach((el) => {
      el.addEventListener('click', () => showNewModal(el.getAttribute('data-tpl')));
    });
    document.getElementById('btnNew').onclick = () => showNewModal('blank');
    document.getElementById('btnAiNewProject')?.addEventListener('click', showAiNewProject);
    document.getElementById('dashProjectSearch')?.addEventListener('input', filterDashboardProjects);
    document.getElementById('importFile').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', file.name.replace(/\.zip$/i, ''));
        const res = await fetch(BASE + '/api/import.php', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-SiamTeX-CSRF': '1' },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        toast('Imported', 'ok');
        openProject(data.project.id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function showNewModal(templateId) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>New project</h2>
        <p>The template fills the editor with starter text you can change.</p>
        <label>Name</label>
        <input id="npName" type="text" value="Untitled" />
        <label>Template</label>
        <select id="npTpl">${state.templates.map((t) =>
          `<option value="${esc(t.id)}" ${t.id === templateId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <label>Engine</label>
        <select id="npEngine">
          <option value="pdflatex">pdflatex (recommended)</option>
          <option value="xelatex">xelatex</option>
          <option value="lualatex">lualatex</option>
        </select>
        <div class="modal-actions">
          <button type="button" id="npCancel">Cancel</button>
          <button type="button" id="npCreate" class="primary">Create &amp; open</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#npCancel').onclick = () => backdrop.remove();
    backdrop.querySelector('#npCreate').onclick = async () => {
      try {
        const name = backdrop.querySelector('#npName').value.trim() || 'Untitled';
        const template = backdrop.querySelector('#npTpl').value;
        const engine = backdrop.querySelector('#npEngine').value;
        const data = await api('/api/projects.php', { method: 'POST', json: { name, template, engine } });
        backdrop.remove();
        await openProject(data.project.id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function showAiNewProject() {
    if (!aiCan('createProject')) {
      toast('Create project with AI is not enabled for your account', 'error');
      return;
    }
    const cfg = effectiveAiConfig();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide ai-create-modal">
        <div class="ai-create-head">
          <span class="ai-new-project-icon" aria-hidden="true">✦</span>
          <div>
            <h2>Create project with AI</h2>
            <p class="ai-disclaimer"><strong>Alpha / experimental.</strong> The model will generate one or more LaTeX files from your description. Review the project before sharing or submitting.</p>
          </div>
        </div>
        <p class="pill">${esc(cfg.model || 'model')} @ ${esc(cfg.baseUrl || 'provider')}</p>
        <label>Project name (optional)</label>
        <input id="aiNewName" type="text" placeholder="e.g. Physics homework 3" />
        <label>What should this project contain?</label>
        <textarea id="aiNewPrompt" rows="6" placeholder="e.g. A two-page homework write-up about the heat equation with sections for introduction, derivation, and conclusion. Include main.tex and a bibliography file."></textarea>
        <label>Engine</label>
        <select id="aiNewEngine">
          <option value="pdflatex">pdflatex (recommended)</option>
          <option value="xelatex">xelatex</option>
          <option value="lualatex">lualatex</option>
        </select>
        <div id="aiNewWaitMount" class="ai-wait-mount hidden"></div>
        <div id="aiNewPreview" class="ai-preview hidden"></div>
        <div class="modal-actions">
          <button type="button" id="aiNewRun" class="primary ai-sparkle-btn">✦ Generate project</button>
          <button type="button" id="aiNewOpen" class="primary hidden">Open project</button>
          <button type="button" id="aiNewClose">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    let created = null;
    const waitMount = backdrop.querySelector('#aiNewWaitMount');
    const runBtn = backdrop.querySelector('#aiNewRun');
    const openBtn = backdrop.querySelector('#aiNewOpen');
    const closeBtn = backdrop.querySelector('#aiNewClose');

    runBtn.onclick = async () => {
      const prompt = backdrop.querySelector('#aiNewPrompt').value.trim();
      if (!prompt) {
        toast('Describe the project you want', 'error');
        return;
      }
      const wait = createAiWait(waitMount, {
        title: 'AI is creating your project',
        streaming: true,
        subtitle: 'Raw JSON streams below as the model works (Ollama may buffer until near the end). Token counts update in parallel.',
        phases: [
          'Sending your prompt to the model…',
          'Planning document structure and files…',
          'Generating LaTeX sources — multi-file projects take longer…',
          'Still writing — local Ollama models can be slow…',
          'Approaching timeout — try a shorter prompt…',
        ],
      });
      runBtn.disabled = true;
      closeBtn.disabled = true;
      try {
        const data = await runAiStreamRequest('/api/ai_stream.php', {
          mode: 'create_project',
          prompt,
          name: backdrop.querySelector('#aiNewName').value.trim(),
          engine: backdrop.querySelector('#aiNewEngine').value,
        }, wait, [runBtn, openBtn, closeBtn]);
        created = data.project;
        applyAiUsageFromResponse(data);
        const prev = backdrop.querySelector('#aiNewPreview');
        prev.classList.remove('hidden');
        const names = Object.keys(data.result?.files || {}).join(', ');
        prev.innerHTML = `<h3>${esc(data.result?.summary || 'Project created')}</h3>
          <p>Files: ${esc(names)}</p>
          <p class="ai-usage-note">This request: ${esc(formatTokenUsage(data.usage, { detailed: true }))}</p>`;
        openBtn.classList.remove('hidden');
        runBtn.classList.add('hidden');
        toast(`Project ready — ${formatTokenUsage(data.usage)}`, 'ok');
      } catch (e) {
        toast(e.message, e.message.includes('cancelled') ? '' : 'error');
      } finally {
        runBtn.disabled = false;
        closeBtn.disabled = false;
      }
    };

    openBtn.onclick = async () => {
      if (!created?.id) return;
      backdrop.remove();
      await openProject(created.id);
    };
    closeBtn.onclick = () => backdrop.remove();
  }

  async function loadDashboard() {
    const [proj, tpl] = await Promise.all([
      api('/api/projects.php'),
      api('/api/templates.php'),
    ]);
    state.projects = proj.projects || [];
    state.templates = tpl.templates || [];
    state.commonFiles = tpl.commonFiles || [];
    state.project = null;
    state.activePath = null;
    renderDashboard();
    if (state.chatOpen) {
      loadChatHistory();
      renderAiChatMessages();
      updateAiChatChrome();
    }
  }

  /* ---------- Workspace / editor ---------- */

  const EDITOR_THEMES = [
    { id: 'default', label: 'Light', hostBg: '#ffffff' },
    { id: 'eclipse', label: 'Light (soft)', hostBg: '#ffffff' },
    { id: 'material-darker', label: 'Dark', hostBg: '#212121' },
    { id: 'dracula', label: 'Dark (vivid)', hostBg: '#282a36' },
    { id: 'siamtex-low', label: 'Dark (low contrast)', hostBg: '#1c1c22' },
  ];

  function editorThemeMeta(id) {
    return EDITOR_THEMES.find((t) => t.id === id) || EDITOR_THEMES[2];
  }

  function editorPrefsHtml() {
    const opts = EDITOR_THEMES.map((t) => (
      `<option value="${esc(t.id)}">${esc(t.label)}</option>`
    )).join('');
    const canEdit = canEditProject(state.project);
    const modelSelect = state.aiEnabled ? `
        <label class="editor-pref editor-pref-model" title="AI model for this project">
          <span class="editor-pref-label">Model</span>
          <select id="projAiModel" class="proj-ai-model"${canEdit ? '' : ' disabled'}>${renderAiModelOptionList(state.project?.aiModel || state.aiConfig?.model || '')}</select>
        </label>` : '';
    return `
      <div class="editor-prefs">
        ${modelSelect}
        <label class="editor-pref" title="Editor color theme">
          <span class="editor-pref-label">Theme</span>
          <select id="editorTheme">${opts}</select>
        </label>
        <label class="editor-pref editor-pref-vim" title="Vim keybindings — press Esc for normal mode, i to insert">
          <input type="checkbox" id="editorVim" />
          <span>Vim</span>
        </label>
      </div>`;
  }

  function applyEditorTheme() {
    const meta = editorThemeMeta(state.editorTheme);
    const host = document.getElementById('editorHost');
    if (host) {
      host.setAttribute('data-editor-theme', state.editorTheme);
      host.style.background = meta.hostBg;
    }
    if (state.editor?.setOption) {
      state.editor.setOption('theme', state.editorTheme);
      state.editor.refresh?.();
    }
    const fallback = document.getElementById('editorFallback');
    if (fallback) {
      fallback.className = `editor-fallback editor-fallback-${state.editorTheme}`;
    }
  }

  function applyEditorVim() {
    if (!state.editor?.setOption) return;
    if (typeof CodeMirror === 'undefined' || !CodeMirror.keyMap?.vim) {
      if (state.editorVim) {
        toast('Vim mode could not load — check your network or hard-refresh', 'error');
      }
      state.editorVim = false;
      localStorage.setItem('siamtex_editor_vim', '0');
      const chk = document.getElementById('editorVim');
      if (chk) chk.checked = false;
      return;
    }
    if (state.editorVim) {
      state.editor.setOption('keyMap', 'vim');
    } else {
      state.editor.setOption('keyMap', 'default');
      state.editor.setOption('extraKeys', editorExtraKeys());
    }
    state.editor.focus?.();
  }

  function wireEditorPrefs() {
    const themeSel = document.getElementById('editorTheme');
    const vimChk = document.getElementById('editorVim');
    if (!themeSel || !vimChk) return;
    if (!EDITOR_THEMES.some((t) => t.id === state.editorTheme)) {
      state.editorTheme = 'material-darker';
    }
    themeSel.value = state.editorTheme;
    vimChk.checked = state.editorVim;
    themeSel.onchange = () => {
      state.editorTheme = themeSel.value;
      localStorage.setItem('siamtex_editor_theme', state.editorTheme);
      applyEditorTheme();
    };
    vimChk.onchange = () => {
      state.editorVim = vimChk.checked;
      localStorage.setItem('siamtex_editor_vim', state.editorVim ? '1' : '0');
      applyEditorVim();
    };
    applyEditorTheme();
    applyEditorVim();
  }

  function editorExtraKeys() {
    return {
      'Ctrl-S': () => { saveActive(); return false; },
      'Cmd-S': () => { saveActive(); return false; },
      'Ctrl-Enter': () => { compileNow(); return false; },
      'Cmd-Enter': () => { compileNow(); return false; },
    };
  }

  function initVimExCommands() {
    if (typeof CodeMirror === 'undefined' || !CodeMirror.Vim?.defineEx) return;
    if (initVimExCommands.done) return;
    initVimExCommands.done = true;
    CodeMirror.Vim.defineEx('write', 'w', () => { saveActive(); });
  }

  async function openProject(id, shareToken = null) {
    try {
      state.shareToken = shareToken;
      const q = shareToken
        ? `?id=${encodeURIComponent(id)}&token=${encodeURIComponent(shareToken)}`
        : `?id=${encodeURIComponent(id)}`;
      const [data, me] = await Promise.all([
        api('/api/project.php' + q),
        shareToken ? Promise.resolve(null) : api('/api/auth_me.php').catch(() => null),
      ]);
      if (me) {
        state.aiPermissions = me.aiPermissions ?? state.aiPermissions;
        state.aiEnabled = !!me.aiEnabled;
        state.isAdmin = !!me.isAdmin;
        state.aiConfig = me.aiConfig ?? state.aiConfig;
      }
      state.project = data.project;
      state.files = data.files || [];
      state.buildsByEntry = data.builds || {};
      state.build = data.build || state.buildsByEntry[compileEntryForActive()] || null;
      if (data.aiUsage) state.project.aiUsage = data.aiUsage;
      state.contents = {};
      state.dirty = {};
      state.activePath = state.project.mainFile || 'main.tex';
      history.replaceState({}, '', BASE + '/?project=' + encodeURIComponent(id)
        + (shareToken ? '&token=' + encodeURIComponent(shareToken) : ''));
      renderWorkspace();
      if (hasAiChat() && canEditProject(data.project)) {
        setChatMode('edit');
      }
      await loadFile(state.activePath);
      updatePreviewLabel();
      if (hasPdfForEntry(previewEntry())) refreshPdf();
      // Focus editor so typing works immediately
      setTimeout(() => state.editor?.focus(), 50);
    } catch (err) {
      toast(err.message || 'Could not open project', 'error');
      await loadDashboard();
    }
  }

  function destroyEditor() {
    if (state.editor) {
      state.editor.toTextArea();
      state.editor = null;
    }
  }

  function markDirtyFromEditor() {
    if (!state.activePath || !state.editor) return;
    state.contents[state.activePath] = state.editor.getValue();
    state.dirty[state.activePath] = true;
    renderFileList();
  }

  function createEditor(text, readOnly) {
    destroyEditor();
    const host = document.getElementById('editorHost');
    if (!host) return;
    if (typeof CodeMirror === 'undefined') {
      host.innerHTML = '<textarea id="editorFallback" class="editor-fallback"></textarea>';
      const ta = document.getElementById('editorFallback');
      ta.className = `editor-fallback editor-fallback-${state.editorTheme}`;
      host.setAttribute('data-editor-theme', state.editorTheme);
      host.style.background = editorThemeMeta(state.editorTheme).hostBg;
      ta.value = text || '';
      ta.readOnly = !!readOnly;
      ta.addEventListener('input', () => {
        state.contents[state.activePath] = ta.value;
        state.dirty[state.activePath] = true;
        scheduleAutoCompile();
      });
      // Minimal adapter
      state.editor = {
        getValue: () => ta.value,
        setValue: (v) => { ta.value = v; },
        getDoc: () => ({
          getSelection: () => (ta.value).substring(ta.selectionStart, ta.selectionEnd),
          getCursor: () => ({ line: 0, ch: ta.selectionStart }),
          replaceSelection: (s) => {
            const a = ta.selectionStart; const b = ta.selectionEnd;
            ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
            ta.selectionStart = ta.selectionEnd = a + s.length;
          },
          replaceRange: (s, cur) => {
            const pos = cur.ch || 0;
            ta.value = ta.value.slice(0, pos) + s + ta.value.slice(pos);
            ta.selectionStart = ta.selectionEnd = pos + s.length;
          },
          setCursor: (c) => { ta.selectionStart = ta.selectionEnd = c.ch; },
        }),
        getOption: (k) => (k === 'readOnly' ? ta.readOnly : null),
        setOption: (k, v) => { if (k === 'readOnly') ta.readOnly = v; },
        focus: () => ta.focus(),
        toTextArea: () => {},
        refresh: () => {},
        on: () => {},
      };
      return;
    }

    host.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.value = text || '';
    host.appendChild(ta);

    state.editor = CodeMirror.fromTextArea(ta, {
      mode: 'stex',
      theme: state.editorTheme,
      lineNumbers: true,
      lineWrapping: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      indentUnit: 2,
      tabSize: 2,
      readOnly: !!readOnly,
      keyMap: state.editorVim && CodeMirror.keyMap?.vim ? 'vim' : 'default',
      extraKeys: editorExtraKeys(),
    });

    initVimExCommands();
    applyEditorTheme();
    applyEditorVim();

    state.editor.on('change', () => {
      markDirtyFromEditor();
      scheduleAutoCompile();
    });

    // Ensure visible height after layout
    requestAnimationFrame(() => {
      state.editor.refresh();
      state.editor.focus();
    });
  }

  function renderWorkspace() {
    const p = state.project;
    const canEdit = canEditProject(p);
    destroyEditor();
    $main().innerHTML = `
      <section class="workspace">
        <div class="ws-toolbar">
          <button type="button" id="btnBack" class="ghost">← Projects</button>
          <input id="projName" type="text" class="grow" value="${esc(p.name)}" ${canEdit ? '' : 'readonly'} />
          <select id="projEngine" ${canEdit ? '' : 'disabled'}>
            <option value="pdflatex">pdflatex</option>
            <option value="xelatex">xelatex</option>
            <option value="lualatex">lualatex</option>
          </select>
          <span class="status-dot" id="statusDot" title="Build status"></span>
          <button type="button" id="btnCompile" class="primary" ${canEdit ? '' : 'disabled'}>Compile</button>
          ${hasAiChat() ? '<button type="button" id="btnAiPanel" class="primary ai-sparkle-btn" title="AI — chat, quick edits, apply to editor">✦ AI</button>' : ''}
          <button type="button" id="btnExport">Export</button>
          ${p.role === 'owner' ? '<button type="button" id="btnShare">Share</button>' : ''}
          <button type="button" id="btnTools">Tools</button>
          <button type="button" id="btnHistory" title="Version history">History</button>
          <span id="aiUsageProject" class="pill ai-usage-project hidden" title="AI token usage for this project"></span>
        </div>
        ${toolbarHtml(canEdit)}
        <aside class="files">
          <h4>Files</h4>
          <div id="fileList"></div>
          <div id="pdfOutputList"></div>
          ${canEdit ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" id="btnAddFile">+ File</button>
          </div>` : ''}
        </aside>
        <div class="split-panes" id="splitPanes">
          <button type="button" class="pane-restore pane-restore-editor" id="restoreEditorPane" title="Show editor">Editor ▸</button>
          <section class="editor-pane" id="editorPane">
            <div class="pane-label editor-bar">
              <span id="editorLabel" class="editor-bar-title">Editor — click here and type, or use the Insert menus above</span>
              <div class="pane-actions">
                ${editorPrefsHtml()}
                <button type="button" class="ghost pane-btn" id="btnMaxEditor" title="Maximize editor (restore split when already maximized)">⛶</button>
                <button type="button" class="ghost pane-btn" id="btnCollapseEditor" title="Collapse editor">◀</button>
              </div>
            </div>
            <div id="editorHost" data-editor-theme="${esc(state.editorTheme)}"></div>
          </section>
          <div class="pane-splitter" id="paneSplitter" role="separator"
            aria-orientation="vertical" aria-valuemin="15" aria-valuemax="85" aria-valuenow="50"
            tabindex="0" title="Drag to resize. Double-click for 50/50. Arrow keys to nudge."></div>
          <section class="preview-pane" id="previewPane">
            <div class="pane-label preview-bar">
              <span id="previewLabel" class="preview-bar-title">PDF preview</span>
              <div class="pane-actions">
                <button type="button" class="ghost pane-btn" id="btnCollapsePreview" title="Collapse preview">▶</button>
                <button type="button" class="ghost pane-btn" id="btnMaxPreview" title="Maximize preview (restore split when already maximized)">⛶</button>
              </div>
            </div>
            <iframe id="pdfFrame" title="PDF preview"></iframe>
          </section>
          <button type="button" class="pane-restore pane-restore-preview" id="restorePreviewPane" title="Show PDF preview">◂ PDF</button>
        </div>
        <section class="problems" id="problemsPanel">
          <div class="problems-tabs">
            <button type="button" data-tab="problems" class="active">Problems</button>
            <button type="button" data-tab="log">Build log</button>
            <span class="problems-tabs-spacer"></span>
            <button type="button" id="btnProblemsExpand" class="ghost problems-tab-action" title="Toggle panel height">Expand</button>
            <button type="button" id="btnProblemsFullLog" class="ghost problems-tab-action" title="Open full build log">Full log</button>
          </div>
          <div class="problems-body" id="problemsBody"></div>
        </section>
      </section>`;

    document.getElementById('projEngine').value = p.engine;
    document.getElementById('btnBack').onclick = async () => {
      history.replaceState({}, '', BASE + '/');
      destroyEditor();
      await loadDashboard();
    };
    document.getElementById('btnCompile').onclick = () => compileNow();
    document.getElementById('btnExport').onclick = () => {
      location.href = BASE + '/api/export.php?id=' + encodeURIComponent(p.id);
    };
    document.getElementById('btnShare')?.addEventListener('click', shareProject);
    document.getElementById('btnTools').onclick = showTools;
    document.getElementById('btnAiPanel')?.addEventListener('click', () => openAiPanel());
    document.getElementById('btnHistory')?.addEventListener('click', showHistory);
    document.getElementById('btnAddFile')?.addEventListener('click', () => {
      addFile().catch((e) => toast(e.message || 'Could not open add-file dialog', 'error'));
    });
    document.getElementById('projName').onchange = async (e) => {
      if (!canEdit) return;
      state.project = (await api('/api/project.php?id=' + encodeURIComponent(p.id), {
        method: 'PATCH', json: { name: e.target.value },
      })).project;
    };
    document.getElementById('projEngine').onchange = async (e) => {
      if (!canEdit) return;
      state.project = (await api('/api/project.php?id=' + encodeURIComponent(p.id), {
        method: 'PATCH', json: { engine: e.target.value },
      })).project;
    };
    $main().querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = () => {
        state.problemsTab = btn.getAttribute('data-tab');
        $main().querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
        renderProblems();
      };
    });
    document.getElementById('btnProblemsExpand')?.addEventListener('click', toggleProblemsExpanded);
    document.getElementById('btnProblemsFullLog')?.addEventListener('click', showFullBuildLogModal);
    const problemsPanel = document.getElementById('problemsPanel');
    if (problemsPanel) problemsPanel.classList.toggle('problems-expanded', state.problemsExpanded);

    wirePaneLayout();
    refreshProjAiModelSelect().then(() => wireProjAiModel());
    bindToolbar();
    wireEditorPrefs();
    renderProjectAiUsage();
    updateAiChatChrome();
    if (state.chatOpen) {
      loadChatHistory();
      renderAiChatMessages();
    }
    renderFileList();
    renderProblems();
    updatePreviewLabel();
    updateStatusDot();
  }

  function isBinaryFile(f) {
    if (!f) return false;
    if (f.binary) return true;
    return /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svgz|pdf|eps|ps|ai|otf|ttf|ttc|woff2?|pfb|pfm|afm|tfm|vf|pk|gf|mf|map|enc)$/i.test(f.path || '');
  }

  function pdfDownloadUrl(entry) {
    const token = state.shareToken ? '&token=' + encodeURIComponent(state.shareToken) : '';
    return BASE + '/api/pdf.php?id=' + encodeURIComponent(state.project.id)
      + '&entry=' + encodeURIComponent(entry) + '&download=1' + token;
  }

  function renderPdfOutputsHtml() {
    const entries = (state.project?.pdfEntries || []).slice().sort();
    if (!entries.length) return '';
    return `<div class="pdf-outputs">
      <h4 class="pdf-outputs-title">PDF outputs</h4>
      ${entries.map((tex) => {
        const pdfName = tex.replace(/\.tex$/i, '.pdf');
        const url = pdfDownloadUrl(tex);
        return `<div class="pdf-output-item">
          <span class="pdf-output-name" title="Compiled from ${esc(tex)}">📕 ${esc(pdfName)}</span>
          <a class="btn ghost pdf-dl-btn" href="${esc(url)}" download="${esc(pdfName)}">Download</a>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderFileList() {
    const list = document.getElementById('fileList');
    if (!list) return;
    const canEdit = canEditProject(state.project);
    list.innerHTML = state.files.map((f) => {
      const isEntry = isCompileEntry(f.path);
      const pdfReady = isEntry && hasPdfForEntry(f.path);
      const entryMark = isEntry ? '<span class="file-entry-mark" title="Standalone compile entry">📄</span> ' : '';
      const pdfMark = pdfReady ? '<span class="file-pdf-mark" title="PDF built">✓</span>' : '';
      return `
      <div class="file-item ${f.path === state.activePath ? 'active' : ''} ${isBinaryFile(f) ? 'binary' : ''}" data-path="${esc(f.path)}">
        <span>${isBinaryFile(f) ? (/\.(otf|ttf|ttc|woff2?)$/i.test(f.path) ? '🔤 ' : '🖼 ') : entryMark}${esc(f.path)}${state.dirty[f.path] ? ' •' : ''}${pdfMark}</span>
        ${canEdit && f.path !== state.project.mainFile
          ? `<button type="button" data-rm="${esc(f.path)}">×</button>` : ''}
      </div>`;
    }).join('');
    list.querySelectorAll('[data-path]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-rm]')) return;
        loadFile(el.getAttribute('data-path'));
      });
    });
    list.querySelectorAll('[data-rm]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const path = el.getAttribute('data-rm');
        if (!confirm('Delete ' + path + '?')) return;
        await api('/api/files.php?id=' + encodeURIComponent(state.project.id) + '&path=' + encodeURIComponent(path), { method: 'DELETE' });
        state.files = state.files.filter((f) => f.path !== path);
        delete state.contents[path];
        if (state.activePath === path) await loadFile(state.project.mainFile);
        renderFileList();
      });
    });
    const pdfOut = document.getElementById('pdfOutputList');
    if (pdfOut) pdfOut.innerHTML = renderPdfOutputsHtml();
  }

  function showBinaryPane(path, size) {
    const host = document.getElementById('editorHost');
    const label = document.getElementById('editorLabel');
    if (label) label.textContent = path + ' — binary asset (not editable as text)';
    destroyEditor();
    if (!host) return;
    const kb = size ? (Math.round(size / 102.4) / 10) + ' KB' : '';
    const canEdit = canEditProject(state.project);
    const isFont = /\.(otf|ttf|ttc|woff2?|pfb|pfm|afm)$/i.test(path);
    const isImage = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico)$/i.test(path);
    let help = `<p>This file is stored in your project and available at compile time.
      ${kb ? '(' + esc(kb) + ')' : ''}</p>`;
    let snippet = path;
    let btnLabel = 'Insert path into editor';
    if (isImage || /\.pdf$/i.test(path)) {
      help += `
        <p>In your preamble (use <code>pdflatex</code> or include graphicx):</p>
        <pre>\\usepackage{graphicx}</pre>
        <p>Then insert:</p>
        <pre>\\includegraphics[width=0.5\\textwidth]{${esc(path)}}</pre>`;
      snippet = `\\includegraphics[width=0.5\\textwidth]{${path}}\n`;
      btnLabel = 'Insert \\includegraphics';
    } else if (isFont) {
      help += `
        <p>Fonts need <strong>xelatex</strong> or <strong>lualatex</strong> and <code>fontspec</code>:</p>
        <pre>\\usepackage{fontspec}
\\setmainfont{${esc(path.replace(/^.*\//, ''))}}</pre>
        <p>Or with an explicit file:</p>
        <pre>\\setmainfont{MyFont}[
  Path = ./,
  Extension = .otf,
  UprightFont = *,
]</pre>`;
      const base = path.replace(/^.*\//, '').replace(/\.(otf|ttf|ttc)$/i, '');
      snippet = `\\usepackage{fontspec}\n\\setmainfont{${base}}[\n  Path = ./${path.includes('/') ? path.replace(/[^/]+$/, '') : ''},\n  Extension = .${(path.split('.').pop() || 'otf')},\n  UprightFont = *,\n]\n`;
      btnLabel = 'Insert fontspec snippet';
    } else {
      help += `<p>Reference this file from your <code>.tex</code> sources by filename:</p><pre>${esc(path)}</pre>`;
    }
    host.innerHTML = `
      <div class="binary-pane">
        <div class="binary-icon">${isFont ? '🔤' : '🖼'}</div>
        <h3>${esc(path)}</h3>
        ${help}
        ${canEdit ? `<button type="button" class="primary" id="btnInsertImg">${esc(btnLabel)}</button>` : ''}
      </div>`;
    document.getElementById('btnInsertImg')?.addEventListener('click', () => {
      const textFile = state.files.find((f) => !isBinaryFile(f) && f.path === state.project.mainFile)
        || state.files.find((f) => !isBinaryFile(f));
      if (!textFile) {
        toast('Open a .tex file first', 'error');
        return;
      }
      loadFile(textFile.path).then(() => {
        if (!state.editor || state.editor.getOption?.('readOnly')) return;
        const doc = state.editor.getDoc();
        doc.replaceRange(snippet, doc.getCursor());
        markDirtyFromEditor();
        scheduleAutoCompile();
        toast('Inserted snippet for ' + path, 'ok');
      });
    });
  }

  async function loadFile(path) {
    if (state.activePath && state.dirty[state.activePath] && !isBinaryFile({ path: state.activePath })) {
      await saveActive();
    }
    state.activePath = path;
    const fileMeta = state.files.find((f) => f.path === path);

    if (isBinaryFile(fileMeta || { path })) {
      let size = fileMeta?.size;
      if (state.contents[path] === undefined) {
        const q = state.shareToken
          ? `?id=${encodeURIComponent(state.project.id)}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(state.shareToken)}`
          : `?id=${encodeURIComponent(state.project.id)}&path=${encodeURIComponent(path)}`;
        const data = await api('/api/files.php' + q);
        size = data.size ?? size;
        state.contents[path] = null; // mark loaded; binary has no text
      }
      showBinaryPane(path, size);
      renderFileList();
      return;
    }

    if (state.contents[path] === undefined || state.contents[path] === null) {
      const q = state.shareToken
        ? `?id=${encodeURIComponent(state.project.id)}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(state.shareToken)}`
        : `?id=${encodeURIComponent(state.project.id)}&path=${encodeURIComponent(path)}`;
      const data = await api('/api/files.php' + q);
      state.contents[path] = data.content ?? '';
    }
    const label = document.getElementById('editorLabel');
    if (label) {
      label.textContent = path + (canEditProject(state.project)
        ? ' — click in the editor and type, or use the Insert menus'
        : ' — view only');
    }
    const text = state.contents[path] || '';
    const editable = canEditProject(state.project);
    const host = document.getElementById('editorHost');
    const hasLiveEditor = host && state.editor?.setValue
      && host.contains(state.editor.getWrapperElement?.() || null);
    if (hasLiveEditor) {
      state.editor.setOption?.('readOnly', !editable);
      state.editor.setValue(text);
      state.editor.refresh?.();
      applyEditorVim();
      state.editor.focus?.();
    } else {
      createEditor(text, !editable);
      wireEditorPrefs();
    }
    renderFileList();
    if (state.chatOpen) updateAiChatChrome();
    if (isCompileEntry(path)) {
      const entry = path;
      state.build = state.buildsByEntry[entry] || null;
      updatePreviewLabel();
      renderProblems();
      if (hasPdfForEntry(entry)) refreshPdf();
      else {
        const frame = document.getElementById('pdfFrame');
        if (frame) frame.removeAttribute('src');
      }
    }
  }

  async function saveActive(source = 'save') {
    const path = state.activePath;
    if (!path || !state.dirty[path] || isBinaryFile({ path })) return;
    const content = state.editor ? state.editor.getValue() : (state.contents[path] ?? '');
    state.contents[path] = content;
    await api('/api/files.php?id=' + encodeURIComponent(state.project.id), {
      method: 'PUT',
      json: { path, content, source },
    });
    state.dirty[path] = false;
    renderFileList();
  }

  async function saveAllDirty() {
    if (state.editor && state.activePath && !isBinaryFile({ path: state.activePath })) {
      state.contents[state.activePath] = state.editor.getValue();
    }
    const files = {};
    for (const [path, dirty] of Object.entries(state.dirty)) {
      if (dirty && !isBinaryFile({ path })) files[path] = state.contents[path] ?? '';
    }
    if (state.activePath && state.dirty[state.activePath] && !isBinaryFile({ path: state.activePath })) {
      files[state.activePath] = state.contents[state.activePath] ?? '';
    }
    return files;
  }

  function scheduleAutoCompile() {
    clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(() => compileNow(true), 1800);
  }

  async function compileNow(silent = false) {
    if (state.compiling) return;
    if (!canEditProject(state.project)) return;
    state.compiling = true;
    updateStatusDot('busy');
    const btn = document.getElementById('btnCompile');
    if (btn) { btn.disabled = true; btn.textContent = 'Compiling…'; }
    try {
      const files = await saveAllDirty();
      const entry = compileEntryForActive();
      const result = await api('/api/compile.php', {
        method: 'POST',
        json: { id: state.project.id, files, entry },
      });
      Object.keys(files).forEach((p) => { state.dirty[p] = false; });
      state.build = result;
      if (result.entry) {
        state.buildsByEntry[result.entry] = result;
      }
      if (result.hasPdf && result.entry) {
        const list = state.project.pdfEntries || [];
        if (!list.includes(result.entry)) {
          state.project.pdfEntries = [...list, result.entry].sort();
        }
        state.project.hasPdf = true;
      }
      renderFileList();
      renderProblems();
      const dotKind = result.status === 'error' ? 'error'
        : result.status === 'ok_with_warnings' ? 'warn'
          : 'ok';
      updateStatusDot(dotKind);
      if (result.hasPdf) refreshPdf();
      if (!silent) {
        toast(result.status === 'error' ? 'Compile failed — see Problems' : 'Compiled', result.status === 'error' ? 'error' : 'ok');
      }
    } catch (e) {
      updateStatusDot('error');
      toast(e.message || 'Compile error', 'error');
    } finally {
      state.compiling = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Compile'; }
    }
  }

  function refreshPdf() {
    const frame = document.getElementById('pdfFrame');
    if (!frame) return;
    const entry = encodeURIComponent(previewEntry());
    const token = state.shareToken ? '&token=' + encodeURIComponent(state.shareToken) : '';
    frame.src = BASE + '/api/pdf.php?id=' + encodeURIComponent(state.project.id)
      + '&entry=' + entry + token + '&t=' + Date.now();
  }

  function diagLocation(d) {
    const fallback = state.project?.mainFile || 'main.tex';
    let file = (d.file || '').replace(/\\/g, '/');
    if (!file || file.includes('texmf') || file.includes('texlive')) {
      file = fallback;
    } else {
      const parts = file.split('/');
      if (parts.length > 2) {
        file = parts.slice(-2).join('/');
      }
    }
    return file + (d.line ? ':' + d.line : '');
  }

  function logProblemFallback(log) {
    if (!log) return '';
    const lines = log.split(/\r?\n/);
    const hits = [];
    for (const line of lines) {
      if (/^!\s/.test(line) || /^==>\s+Fatal error/i.test(line) || /^Latexmk:\s+.*error/i.test(line)) {
        hits.push(line);
      }
    }
    if (hits.length) {
      return hits.slice(0, 12).join('\n');
    }
    const tail = lines.filter((l) => l.trim()).slice(-18);
    return tail.join('\n');
  }

  function logViewClass() {
    return 'log-view' + (state.problemsExpanded ? ' log-expanded' : '');
  }

  function toggleProblemsExpanded() {
    state.problemsExpanded = !state.problemsExpanded;
    const panel = document.getElementById('problemsPanel');
    panel?.classList.toggle('problems-expanded', state.problemsExpanded);
    const btn = document.getElementById('btnProblemsExpand');
    if (btn) btn.textContent = state.problemsExpanded ? 'Collapse' : 'Expand';
    renderProblems();
  }

  function showFullBuildLogModal() {
    const log = state.build?.log || 'No build log yet. Click Compile to build your PDF.';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide modal-log">
        <h2>Full build log</h2>
        <pre class="build-log-full">${esc(log)}</pre>
        <div class="modal-actions">
          <button type="button" id="buildLogCopy" class="ghost">Copy log</button>
          <button type="button" id="buildLogClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#buildLogClose').onclick = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('#buildLogCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(log);
        toast('Log copied', 'ok');
      } catch {
        toast('Could not copy', 'error');
      }
    };
  }

  function renderProblems() {
    const body = document.getElementById('problemsBody');
    if (!body) return;
    const logCls = logViewClass();
    if (state.problemsTab === 'log') {
      body.innerHTML = `<div class="${logCls}">${esc(state.build?.log || 'No build log yet. Click Compile to build your PDF.')}</div>`;
      return;
    }
    const diags = state.build?.diagnostics || [];
    const errors = diags.filter((d) => d.severity === 'error');
    const canFix = canEditProject(state.project) && aiCan('fixErrors') && errors.length > 0;
    if (!diags.length) {
      if (state.build?.status === 'error' || state.build?.status === 'ok_with_warnings') {
        const fallback = logProblemFallback(state.build?.log || '');
        if (fallback) {
          body.innerHTML = `<div class="pill" style="margin-bottom:8px">Could not parse structured problems — showing log excerpt:</div><div class="${logCls}">${esc(fallback)}</div>`;
          return;
        }
      }
      body.innerHTML = '<div class="pill">No problems from the last build. Click Compile when you are ready.</div>';
      return;
    }
    const fixBar = canFix
      ? `<div class="problems-actions"><button type="button" id="btnAiFixProblems" class="primary">AI fix problems</button><span class="pill">${errors.length} error${errors.length === 1 ? '' : 's'}</span></div>`
      : '';
    body.innerHTML = fixBar + diags.map((d, i) => `
      <div class="diag" data-i="${i}">
        <span class="diag-sev sev-${esc(d.severity)}">${esc(d.severity)}</span>
        <span class="diag-msg">${esc(d.message || '(no message)')}</span>
        <span class="diag-loc">${esc(diagLocation(d))}</span>
      </div>`).join('');
    document.getElementById('btnAiFixProblems')?.addEventListener('click', () => showAiFixProblems(errors));
    body.querySelectorAll('.diag').forEach((el) => {
      el.onclick = async () => {
        const d = diags[Number(el.getAttribute('data-i'))];
        const file = d.file && !String(d.file).includes('texmf') && !String(d.file).includes('texlive')
          ? d.file
          : state.project.mainFile;
        if (file && file !== state.activePath && state.files.some((f) => f.path === file)) {
          await loadFile(file);
        }
        if (d.line && state.editor?.setCursor) {
          state.editor.setCursor({ line: Math.max(0, d.line - 1), ch: 0 });
          state.editor.focus();
        }
      };
    });
  }

  function updateStatusDot(kind) {
    const el = document.getElementById('statusDot');
    if (!el) return;
    if (!kind) {
      const s = state.build?.status;
      kind = s === 'error' ? 'error' : s === 'ok_with_warnings' ? 'warn' : s ? 'ok' : '';
    }
    el.className = 'status-dot ' + (kind || '');
  }

  async function shareProject() {
    const data = await api('/api/share.php', {
      method: 'POST',
      json: { id: state.project.id, role: 'view' },
    });
    state.project = data.project;
    const url = data.shareUrl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>Share link</h2>
        <p>Anyone with this link can view the project.</p>
        <input id="shareUrl" type="text" readonly value="${esc(url)}" />
        <div class="modal-actions">
          <button type="button" id="shareDisable" class="danger">Disable sharing</button>
          <button type="button" id="shareCopy" class="primary">Copy link</button>
          <button type="button" id="shareClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#shareClose').onclick = () => backdrop.remove();
    backdrop.querySelector('#shareCopy').onclick = async () => {
      await navigator.clipboard.writeText(url);
      toast('Copied', 'ok');
    };
    backdrop.querySelector('#shareDisable').onclick = async () => {
      const res = await api('/api/share.php', { method: 'DELETE', json: { id: state.project.id } });
      state.project = res.project;
      backdrop.remove();
      toast('Sharing disabled', 'ok');
    };
  }

  async function ensureCommonFiles() {
    if (state.commonFiles.length) return;
    const tpl = await api('/api/templates.php');
    state.templates = tpl.templates || state.templates;
    state.commonFiles = tpl.commonFiles || [];
  }

  /** Match server safePath: spaces and odd chars → underscores (LaTeX-friendly). */
  function sanitizePath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .map((seg) => seg
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/_+(\.[A-Za-z0-9]+)$/g, '$1')
        .replace(/^[._]+|[._]+$/g, ''))
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
  }

  function uploadDestPath(file, { path = '', prefix = '' }, fileCount) {
    if (fileCount === 1 && path) return sanitizePath(path);
    const base = prefix
      ? prefix.replace(/^\/+|\/+$/g, '') + '/' + file.name
      : file.name;
    return sanitizePath(base);
  }

  async function uploadProjectFiles(fileList, { path = '', prefix = '' } = {}) {
    const files = Array.from(fileList || []);
    if (!files.length) throw new Error('Choose one or more files to upload.');
    if (!state.project?.id) throw new Error('Open a project before uploading.');
    const fd = new FormData();
    fd.append('id', state.project.id);
    const cleanPath = path ? sanitizePath(path) : '';
    const cleanPrefix = prefix ? prefix.replace(/^\/+|\/+$/g, '') : '';
    if (files.length === 1) {
      if (cleanPath) fd.append('path', cleanPath);
      fd.append('file', files[0]);
    } else {
      if (cleanPrefix) fd.append('prefix', cleanPrefix);
      files.forEach((f) => fd.append('files[]', f));
    }
    const res = await fetch(BASE + '/api/upload.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-SiamTeX-CSRF': '1' },
      body: fd,
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.trim() || `Upload failed (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    const saved = data.files || (data.file ? [data.file] : []);
    if (!saved.length) throw new Error(data.error || 'No files were saved.');
    return data;
  }

  async function addFile() {
    await ensureCommonFiles();
    const existing = new Set(state.files.map((f) => f.path));
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const options = state.commonFiles.map((f) => {
      const taken = existing.has(f.path);
      return `<label class="file-pick ${taken ? 'disabled' : ''}">
        <input type="radio" name="pick" value="${esc(f.id)}" ${taken ? 'disabled' : ''} />
        <span>
          <strong>${esc(f.label)}</strong>
          <small>${esc(f.path)} — ${esc(f.description)}${taken ? ' (already in project)' : ''}</small>
        </span>
      </label>`;
    }).join('');
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>Add a file</h2>

        <div class="upload-box">
          <strong>Upload from your computer</strong>
          <p>Select one or more files, then click <strong>Upload files</strong>. Images, TeX sources, fonts, PDF/EPS, and other project assets. Max 10&nbsp;MB each.</p>
          <label class="upload-pick">
            <span class="btn">Choose files…</span>
            <input id="afUpload" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/svg+xml,.tex,.ltx,.sty,.cls,.clo,.dtx,.ins,.fd,.def,.cfg,.bib,.bst,.bbx,.cbx,.lbx,.dbx,.txt,.md,.csv,.tsv,.json,.yaml,.yml,.xml,.svg,.lua,.lco,.ldf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.ico,.pdf,.eps,.ps,.otf,.ttf,.ttc,.woff,.woff2,.pfb,.afm,.tfm,.map,.enc" />
          </label>
          <p id="afUploadCount" class="upload-count"></p>
          <p id="afUploadErr" class="upload-err hidden" role="alert"></p>
          <label style="margin-top:8px">Folder prefix (optional, for multiple files)</label>
          <input id="afUploadPrefix" type="text" placeholder="e.g. fonts or images" />
          <label style="margin-top:8px">Save as (optional, single file only)</label>
          <input id="afUploadPath" type="text" placeholder="e.g. photo.png or mystyle.sty" />
          <div class="modal-actions" style="margin-top:10px">
            <button type="button" id="afUploadBtn" class="primary">Upload files</button>
          </div>
        </div>

        <hr class="modal-sep" />

        <p>Or create a starter / blank text file:</p>
        <div class="file-pick-list">${options}
          <label class="file-pick">
            <input type="radio" name="pick" value="__custom" checked />
            <span><strong>Custom path</strong><small>Empty text file</small></span>
          </label>
        </div>
        <label>Custom path</label>
        <input id="afPath" type="text" placeholder="e.g. chapter2.tex or notes.bib" />
        <div class="modal-actions">
          <button type="button" id="afCancel">Cancel</button>
          <button type="button" id="afAdd">Create text file</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#afCancel').onclick = () => backdrop.remove();

    const uploadInput = backdrop.querySelector('#afUpload');
    const uploadCount = backdrop.querySelector('#afUploadCount');
    const uploadErr = backdrop.querySelector('#afUploadErr');
    const showUploadErr = (msg) => {
      if (!uploadErr) {
        toast(msg, 'error');
        return;
      }
      uploadErr.textContent = msg;
      uploadErr.classList.remove('hidden');
    };
    const clearUploadErr = () => {
      uploadErr?.classList.add('hidden');
      if (uploadErr) uploadErr.textContent = '';
    };
    const updateCount = () => {
      clearUploadErr();
      const list = uploadInput.files;
      const n = list?.length || 0;
      if (!n) {
        uploadCount.textContent = '';
        return;
      }
      const names = Array.from(list).map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ');
      uploadCount.textContent = `${n} file${n === 1 ? '' : 's'} selected: ${names} — click Upload files`;
    };
    uploadInput.addEventListener('change', updateCount);

    backdrop.querySelector('#afUploadBtn').onclick = async () => {
      const btn = backdrop.querySelector('#afUploadBtn');
      clearUploadErr();
      try {
        const list = uploadInput.files;
        if (!list?.length) throw new Error('Choose one or more files to upload.');
        const path = (backdrop.querySelector('#afUploadPath').value || '').trim();
        const prefix = (backdrop.querySelector('#afUploadPrefix').value || '').trim();
        const maxBytes = 10 * 1024 * 1024;
        for (const f of list) {
          if (f.size > maxBytes) {
            throw new Error(`${f.name} is ${formatBytes(f.size)} — max ${formatBytes(maxBytes)} per file.`);
          }
          const dest = uploadDestPath(f, { path, prefix }, list.length);
          if (!dest) throw new Error('Invalid file name: ' + f.name);
          if (existing.has(dest)) throw new Error('Already in project: ' + dest);
        }
        btn.disabled = true;
        btn.textContent = list.length > 1 ? `Uploading ${list.length} files…` : 'Uploading…';
        const data = await uploadProjectFiles(list, { path, prefix });
        const saved = data.files || (data.file ? [data.file] : []);
        for (const meta of saved) {
          state.files.push({
            path: meta.path,
            size: meta.size,
            updatedAt: new Date().toISOString(),
            binary: !!meta.binary,
          });
          existing.add(meta.path);
          state.contents[meta.path] = meta.binary ? null : undefined;
        }
        renderFileList();
        const errN = (data.errors || []).length;
        backdrop.remove();
        try {
          if (saved.length) await loadFile(saved[saved.length - 1].path);
        } catch (loadErr) {
          toast(loadErr.message || 'Uploaded, but could not open preview', 'error');
        }
        if (errN) {
          toast(`Uploaded ${saved.length}, ${errN} failed`, 'error');
        } else {
          toast(saved.length === 1 ? `Uploaded ${saved[0].path}` : `Uploaded ${saved.length} files`, 'ok');
        }
      } catch (e) {
        const msg = e?.message || 'Upload failed';
        showUploadErr(msg);
        toast(msg, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Upload files';
      }
    };

    backdrop.querySelector('#afAdd').onclick = async () => {
      try {
        const pick = backdrop.querySelector('input[name="pick"]:checked')?.value || '__custom';
        let path;
        let content;
        if (pick === '__custom') {
          path = (backdrop.querySelector('#afPath').value || '').trim();
          if (!path) throw new Error('Enter a file path.');
          content = path.endsWith('.bib') ? '% Bibliography\n' : '% ' + path + '\n';
        } else {
          const preset = state.commonFiles.find((f) => f.id === pick);
          if (!preset) throw new Error('Unknown file type.');
          path = preset.path;
          content = preset.content;
        }
        if (existing.has(path)) throw new Error('That file already exists.');
        const meta = await api('/api/files.php?id=' + encodeURIComponent(state.project.id), {
          method: 'PUT',
          json: { path, content, source: 'import' },
        });
        state.files.push({
          path: meta.file.path,
          size: meta.file.size,
          updatedAt: new Date().toISOString(),
          binary: !!meta.file.binary,
        });
        state.contents[path] = content;
        backdrop.remove();
        await loadFile(path);
        toast('Added ' + path, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  }

  async function showAiSettings() {
    if (!aiCan('settings')) {
      toast('AI settings are not enabled for your account', 'error');
      return;
    }
    let cfg = state.aiConfig || {};
    let serverDefaults = {};
    try {
      const data = await api('/api/ai_settings.php');
      cfg = data.config || cfg;
      serverDefaults = data.serverDefaults || {};
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    await loadAiModels();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>AI settings</h2>
        <p class="ai-disclaimer">Your <strong>default model</strong> applies to new projects and any project without its own model. Override per project in the toolbar model dropdown.</p>
        <label>Provider</label>
        <select id="aiSetProvider">
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI</option>
          <option value="openai_compatible">OpenAI-compatible (custom)</option>
        </select>
        <label>Base URL</label>
        <input id="aiSetBaseUrl" type="url" placeholder="https://api.openai.com/v1 or http://host:11434/v1" />
        <label>Default model</label>
        <div class="ai-model-pick">
          <input id="aiSetModel" type="text" list="aiSetModelList" placeholder="e.g. gpt-oss:20b" />
          <datalist id="aiSetModelList"></datalist>
          <button type="button" id="aiSetRefreshModels" class="ghost">Refresh models</button>
        </div>
        <p class="pill ai-settings-server">Server default: ${esc(serverDefaults.model || '(not set)')} @ ${esc(serverDefaults.baseUrl || '')}</p>
        <label>API key (optional — leave blank to keep current)</label>
        <input id="aiSetApiKey" type="password" autocomplete="off" placeholder="${cfg.hasApiKey ? '••••••••' : 'Not set'}" />
        <label class="editor-pref"><input type="checkbox" id="aiSetEnabled" /> Use my settings (override server defaults)</label>
        <p id="aiSetStatus" class="pill hidden"></p>
        <div class="modal-actions">
          <button type="button" id="aiSetTest" class="ghost">Test connection</button>
          <button type="button" id="aiSetSave" class="primary">Save default</button>
          <button type="button" id="aiSetClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const providerEl = backdrop.querySelector('#aiSetProvider');
    const baseEl = backdrop.querySelector('#aiSetBaseUrl');
    const modelEl = backdrop.querySelector('#aiSetModel');
    const modelListEl = backdrop.querySelector('#aiSetModelList');
    const statusEl = backdrop.querySelector('#aiSetStatus');

    providerEl.value = cfg.provider || 'ollama';
    baseEl.value = cfg.baseUrl || '';
    modelEl.value = cfg.model || '';
    backdrop.querySelector('#aiSetEnabled').checked = !!cfg.enabled;

    const fillModelList = () => {
      modelListEl.innerHTML = (state.aiModels || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
    };
    fillModelList();

    backdrop.querySelector('#aiSetRefreshModels').onclick = async () => {
      const btn = backdrop.querySelector('#aiSetRefreshModels');
      btn.disabled = true;
      try {
        const data = await api('/api/ai_models.php');
        state.aiModels = data.models || [];
        fillModelList();
        toast(`Found ${state.aiModels.length} model(s)`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };

    backdrop.querySelector('#aiSetTest').onclick = async () => {
      statusEl.classList.remove('hidden');
      statusEl.textContent = 'Testing…';
      try {
        await api('/api/ai_settings.php', {
          method: 'PUT',
          json: {
            provider: providerEl.value,
            baseUrl: baseEl.value.trim(),
            model: modelEl.value.trim(),
            enabled: backdrop.querySelector('#aiSetEnabled').checked,
          },
        });
        const r = await api('/api/ai_test.php', { method: 'POST', json: {} });
        statusEl.textContent = r.ok ? `OK — ${r.model}` : `Reply: ${r.reply}`;
        toast(r.ok ? 'Connection OK' : 'Unexpected reply', r.ok ? 'ok' : 'error');
      } catch (e) {
        statusEl.textContent = e.message;
        toast(e.message, 'error');
      }
    };

    backdrop.querySelector('#aiSetSave').onclick = async () => {
      const model = modelEl.value.trim();
      if (!model) {
        toast('Model is required', 'error');
        return;
      }
      const payload = {
        provider: providerEl.value,
        baseUrl: baseEl.value.trim(),
        model,
        enabled: backdrop.querySelector('#aiSetEnabled').checked,
      };
      const key = backdrop.querySelector('#aiSetApiKey').value.trim();
      if (key) payload.apiKey = key;
      try {
        const data = await api('/api/ai_settings.php', { method: 'PUT', json: payload });
        state.aiConfig = data.config;
        await loadAiModels();
        renderProjAiModelSelect();
        updateAiChatChrome();
        toast('Default AI settings saved', 'ok');
        backdrop.remove();
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    backdrop.querySelector('#aiSetClose').onclick = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  function showTools() {
    const text = state.editor ? state.editor.getValue() : '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h2>Author tools</h2>
        <p>Estimate length and get margin settings without writing LaTeX by hand.</p>
        <label>Words in current file (rough)</label>
        <input id="toolWords" type="number" value="${words}" />
        <label>Words per page</label>
        <input id="toolWpp" type="number" value="300" />
        <p id="toolOut" class="pill" style="margin-top:10px"></p>
        <label>Page margin</label>
        <input id="toolMargin" type="text" value="0.7in" />
        <pre id="toolGeom" style="background:rgba(0,0,0,.25);padding:10px;border-radius:8px;overflow:auto"></pre>
        <div class="modal-actions">
          <button type="button" id="toolInsertGeom" class="primary">Insert margins into editor</button>
          <button type="button" id="toolClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const run = async () => {
      const est = await api('/api/tools.php', {
        method: 'POST',
        json: {
          tool: 'page_estimate',
          words: Number(backdrop.querySelector('#toolWords').value || 0),
          wordsPerPage: Number(backdrop.querySelector('#toolWpp').value || 300),
        },
      });
      backdrop.querySelector('#toolOut').textContent =
        `≈ ${est.estimatedPages} pages (${est.words} words @ ${est.wordsPerPage}/page)`;
      const geom = await api('/api/tools.php', {
        method: 'POST',
        json: { tool: 'geometry', margin: backdrop.querySelector('#toolMargin').value || '1in' },
      });
      backdrop.querySelector('#toolGeom').textContent = geom.snippet;
      backdrop._geom = geom.snippet;
    };
    backdrop.querySelector('#toolInsertGeom').onclick = () => {
      if (backdrop._geom && state.editor && !state.editor.getOption('readOnly')) {
        const doc = state.editor.getDoc();
        doc.replaceRange(backdrop._geom + '\n', doc.getCursor());
        markDirtyFromEditor();
        toast('Inserted margin command', 'ok');
      }
    };
    backdrop.querySelector('#toolClose').onclick = () => backdrop.remove();
    run();
  }

  function openAiPanel(options = {}) {
    if (!hasAiChat()) {
      toast('AI is not enabled for your account', 'error');
      return;
    }
    if (state.project && hasAiEditInChat() && (options.editMode || state.chatMode !== 'ask')) {
      setChatMode('edit');
    }
    toggleAiChatPanel(true);
    renderAiMagicBar();
    if (!options.focusChat) state.editor?.focus?.();
    else document.getElementById('aiChatInput')?.focus();
  }

  function showAiAssist() {
    openAiPanel({ editMode: true });
  }

  async function applyChatMessageEdit(msg) {
    const pending = extractChatApplyPayload(msg);
    if (!pending) {
      toast('Nothing to apply from this message', 'error');
      return;
    }
    if (pending.mode === 'file' && pending.result?.path && pending.result.path !== state.activePath) {
      await loadFile(pending.result.path);
    }
    if (pending.mode === 'snippet') {
      const path = pending.path || state.activePath;
      const content = pending.content;
      if (state.editor && state.activePath === path && !state.editor.getOption('readOnly')) {
        const doc = state.editor.getDoc();
        if (pending.target === 'selection' && doc.somethingSelected?.()) {
          doc.replaceSelection(content);
        } else {
          state.editor.setValue(content);
        }
        markDirtyFromEditor();
        await saveActive('ai');
      } else if (path) {
        await api('/api/files.php?id=' + encodeURIComponent(state.project.id), {
          method: 'PUT',
          json: { path, content, source: 'ai' },
        });
        state.contents[path] = content;
        if (state.activePath === path && state.editor) state.editor.setValue(content);
      }
      toast('Applied to editor', 'ok');
      return;
    }
    await applyAiFileChanges(pending);
    state.editor?.focus?.();
  }

  async function applyAiFileChanges(pending) {
    if (pending.mode === 'file') {
      const path = pending.result.path;
      const content = pending.result.content;
      if (state.editor && state.activePath === path && !state.editor.getOption('readOnly')) {
        state.editor.setValue(content);
        markDirtyFromEditor();
        await saveActive('ai');
      } else {
        await api('/api/files.php?id=' + encodeURIComponent(state.project.id), {
          method: 'PUT',
          json: { path, content, source: 'ai' },
        });
        state.contents[path] = content;
        if (state.activePath === path && state.editor) {
          state.editor.setValue(content);
        }
      }
    } else {
      for (const [fp, content] of Object.entries(pending.result.files || {})) {
        await api('/api/files.php?id=' + encodeURIComponent(state.project.id), {
          method: 'PUT',
          json: { path: fp, content, source: 'ai' },
        });
        state.contents[fp] = content;
        if (fp === state.activePath && state.editor) {
          state.editor.setValue(content);
        }
      }
      const proj = await api('/api/project.php?id=' + encodeURIComponent(state.project.id));
      state.files = proj.files || state.files;
      renderFileList();
    }
    scheduleAutoCompile();
  }

  function showAiFixProblems(errors) {
    if (!aiCan('fixErrors')) {
      toast('AI fix errors is not enabled for your account', 'error');
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>AI fix compile problems</h2>
        <p class="ai-disclaimer"><strong>Alpha / experimental.</strong> Sends compile errors, affected files, and the <strong>full build log</strong> to your AI provider. Fixes are not guaranteed — quality depends on your model. Review every change before accepting.</p>
        <div class="ai-error-list">${errors.map((d) => `
          <div class="pill"><strong>${esc(d.severity)}</strong> ${esc(d.message || '(no message)')}
          <span class="loc">${esc(diagLocation(d))}</span></div>`).join('')}</div>
        <div id="aiFixWaitMount" class="ai-wait-mount hidden"></div>
        <div id="aiFixPreview" class="ai-preview hidden"></div>
        <div class="modal-actions">
          <button type="button" id="aiFixRun" class="primary">Analyze &amp; suggest fix</button>
          <button type="button" id="aiFixAccept" class="primary hidden">Accept fixes</button>
          <button type="button" id="aiFixClose">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    let pending = null;
    const waitMount = backdrop.querySelector('#aiFixWaitMount');
    const runBtn = backdrop.querySelector('#aiFixRun');
    const acceptBtn = backdrop.querySelector('#aiFixAccept');
    const closeBtn = backdrop.querySelector('#aiFixClose');
    const errFiles = [...new Set(errors.map((d) => d.file || state.project.mainFile).filter(Boolean))];

    backdrop.querySelector('#aiFixRun').onclick = async () => {
      const wait = createAiWait(waitMount, {
        title: 'AI fixing compile errors',
        streaming: true,
        subtitle: 'Fix JSON streams below; token usage updates in parallel.',
        phases: [
          'Gathering errors and affected source files from the last build…',
          `Sending context to ${effectiveAiModel() || 'the model'}…`,
          'Model is diagnosing LaTeX errors and planning fixes…',
          'Generating corrected file content — this often takes 1–3 minutes…',
          'Approaching timeout — cancel and fix one file manually if needed…',
        ],
      });
      runBtn.textContent = 'Analyzing…';
      try {
        const data = await runAiStreamRequest(
          '/api/ai_stream.php',
          { projectId: state.project.id, mode: 'fix_problems', entry: compileEntryForActive() },
          wait,
          [runBtn, acceptBtn, closeBtn],
        );
        pending = { mode: data.mode, result: data.result };
        applyAiUsageFromResponse(data);
        const prev = backdrop.querySelector('#aiFixPreview');
        prev.classList.remove('hidden');
        const names = Object.keys(data.result.files || {}).join(', ');
        prev.innerHTML = `<h3>${esc(data.result.summary)}</h3><p>Files to update: ${esc(names)}</p>
          <p class="ai-usage-note">${esc(formatTokenUsage(data.usage, { detailed: true }))}</p>`;
        if ((data.result.notes || []).length) {
          prev.innerHTML += `<p>${esc(data.result.notes.join(' '))}</p>`;
        }
        for (const [fp, body] of Object.entries(data.result.files || {})) {
          prev.innerHTML += `<h4>${esc(fp)}</h4><pre>${esc(String(body).slice(0, 4000))}</pre>`;
        }
        acceptBtn.classList.remove('hidden');
        toast(`Fix suggested — ${formatTokenUsage(data.usage)} — review and Accept`, 'ok');
      } catch (e) {
        toast(e.message, e.message.includes('cancelled') ? '' : 'error');
      } finally {
        runBtn.textContent = 'Analyze & suggest fix';
      }
    };

    backdrop.querySelector('#aiFixAccept').onclick = async () => {
      if (!pending) return;
      try {
        await applyAiFileChanges(pending);
        toast('Fixes applied — recompiling', 'ok');
        backdrop.remove();
        await compileNow(true);
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    backdrop.querySelector('#aiFixClose').onclick = () => backdrop.remove();
  }

  function historySourceLabel(source) {
    const map = {
      initial: 'Initial',
      save: 'Saved',
      compile: 'Compile',
      ai: 'AI',
      restore: 'Restore',
      import: 'Import',
    };
    return map[source] || source;
  }

  function buildHistoryTreeRows(revisions) {
    const byParent = new Map();
    for (const r of revisions) {
      const p = r.parentId == null ? 'root' : String(r.parentId);
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(r);
    }
    const rows = [];
    const walk = (parentKey, prefix) => {
      const kids = byParent.get(parentKey) || [];
      kids.forEach((r, i) => {
        const last = i === kids.length - 1;
        rows.push({
          revision: r,
          branch: prefix + (last ? '└─ ' : '├─ '),
        });
        const childPrefix = prefix + (last ? '   ' : '│  ');
        walk(String(r.id), childPrefix);
      });
    };
    walk('root', '');
    return rows;
  }

  function renderDiffHunks(hunks) {
    if (!hunks || !hunks.length) {
      return '<p class="pill">No differences.</p>';
    }
    let html = '<div class="diff-view">';
    for (const h of hunks) {
      const cls = h.type === 'insert' ? 'diff-add' : h.type === 'delete' ? 'diff-del' : 'diff-ctx';
      const sign = h.type === 'insert' ? '+' : h.type === 'delete' ? '-' : ' ';
      html += `<div class="diff-line ${cls}"><span class="diff-sign">${sign}</span><span class="diff-text">${esc(h.text)}</span></div>`;
    }
    html += '</div>';
    return html;
  }

  async function showHistory() {
    const path = state.activePath;
    if (!state.project || !path || isBinaryFile({ path })) {
      toast('Open a text file to view history', 'error');
      return;
    }
    if (!canEditProject(state.project) && state.project.role === 'view') {
      // viewers can still browse history
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide history-modal">
        <h2>Version history</h2>
        <p class="ai-disclaimer">Branching timeline like Vim undo tree. Pick a version, review the diff against current (or another version), then restore if needed. Restoring creates a new branch — nothing is deleted.</p>
        <p class="pill">${esc(path)}</p>
        <div class="history-layout">
          <div class="history-tree-wrap">
            <h3>Timeline</h3>
            <div id="historyTree" class="history-tree">Loading…</div>
          </div>
          <div class="history-diff-wrap">
            <div class="history-diff-toolbar">
              <label>Compare</label>
              <select id="historyCompare">
                <option value="current">Current editor</option>
              </select>
            </div>
            <div id="historyDiffMeta" class="pill"></div>
            <div id="historyDiff" class="history-diff-body">Select a version to preview changes.</div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="historyRestore" class="primary" disabled>Restore this version</button>
          <button type="button" id="historyClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    let revisions = [];
    let selectedId = null;
    let compareTo = 'current';

    const treeEl = backdrop.querySelector('#historyTree');
    const diffEl = backdrop.querySelector('#historyDiff');
    const diffMeta = backdrop.querySelector('#historyDiffMeta');
    const compareSel = backdrop.querySelector('#historyCompare');
    const restoreBtn = backdrop.querySelector('#historyRestore');
    if (!canEditProject(state.project)) {
      restoreBtn.style.display = 'none';
    }

    function currentEditorContent() {
      if (state.activePath === path && state.editor && !isBinaryFile({ path })) {
        return state.editor.getValue();
      }
      return state.contents[path] ?? '';
    }

    function populateCompareOptions() {
      const opts = ['<option value="current">Current editor</option>'];
      for (const r of revisions) {
        opts.push(`<option value="${r.id}">${esc(r.display)}</option>`);
      }
      compareSel.innerHTML = opts.join('');
      compareSel.value = String(compareTo);
    }

    function renderTree() {
      if (!revisions.length) {
        treeEl.innerHTML = '<p class="pill">No saved versions yet. History begins on your next save or compile.</p>';
        return;
      }
      const rows = buildHistoryTreeRows(revisions);
      treeEl.innerHTML = rows.map(({ revision: r, branch }) => {
        const active = r.id === selectedId ? ' active' : '';
        const head = r.isHead ? ' <span class="history-head-tag">head</span>' : '';
        return `<button type="button" class="history-node${active}" data-id="${r.id}">
          <span class="history-branch">${esc(branch)}</span>
          <span class="history-node-body">
            <span class="history-node-title">${esc(r.display)}</span>
            <span class="history-node-meta">${esc(historySourceLabel(r.source))}${head}</span>
          </span>
        </button>`;
      }).join('');
      treeEl.querySelectorAll('.history-node').forEach((btn) => {
        btn.onclick = () => {
          selectedId = Number(btn.getAttribute('data-id'));
          renderTree();
          loadDiff();
        };
      });
    }

    async function loadDiff() {
      if (!selectedId) {
        diffEl.textContent = 'Select a version to preview changes.';
        diffMeta.textContent = '';
        restoreBtn.disabled = true;
        return;
      }
      const fromId = selectedId;
      const to = compareSel.value;
      if (String(fromId) === String(to)) {
        diffEl.innerHTML = '<p class="pill">Choose a different comparison target.</p>';
        diffMeta.textContent = '';
        restoreBtn.disabled = true;
        return;
      }
      diffEl.textContent = 'Loading diff…';
      try {
        const q = new URLSearchParams({
          id: state.project.id,
          path,
          action: 'diff',
          from: String(fromId),
          to: String(to),
        });
        const data = await api('/api/history.php?' + q.toString());
        diffMeta.textContent = `${data.from.display} → ${data.to.display}`;
        diffEl.innerHTML = renderDiffHunks(data.hunks);
        const head = revisions.find((r) => r.isHead);
        restoreBtn.disabled = !canEditProject(state.project) || (head && head.id === selectedId && to === 'current' && !state.dirty[path]);
      } catch (e) {
        diffEl.textContent = e.message;
        restoreBtn.disabled = true;
      }
    }

    compareSel.onchange = () => {
      compareTo = compareSel.value;
      loadDiff();
    };

    restoreBtn.onclick = async () => {
      if (!selectedId || !canEditProject(state.project)) return;
      const rev = revisions.find((r) => r.id === selectedId);
      if (!rev) return;
      if (!confirm(`Restore "${rev.display}"?\n\nYour editor will be updated and a new branch point will be created.`)) {
        return;
      }
      restoreBtn.disabled = true;
      restoreBtn.textContent = 'Restoring…';
      try {
        const data = await api('/api/history.php?id=' + encodeURIComponent(state.project.id), {
          method: 'POST',
          json: { action: 'restore', path, revisionId: selectedId },
        });
        state.contents[path] = data.file.content ?? state.contents[path];
        if (state.editor && state.activePath === path) {
          state.editor.setValue(state.contents[path]);
        }
        state.dirty[path] = false;
        toast('Restored — ' + (data.file.label || rev.display), 'ok');
        const list = await api('/api/history.php?id=' + encodeURIComponent(state.project.id)
          + '&path=' + encodeURIComponent(path) + '&action=list');
        revisions = list.revisions || [];
        selectedId = data.file.revisionId || selectedId;
        populateCompareOptions();
        renderTree();
        await loadDiff();
        scheduleAutoCompile();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        restoreBtn.disabled = false;
        restoreBtn.textContent = 'Restore this version';
      }
    };

    backdrop.querySelector('#historyClose').onclick = () => backdrop.remove();

    try {
      const list = await api('/api/history.php?id=' + encodeURIComponent(state.project.id)
        + '&path=' + encodeURIComponent(path) + '&action=list');
      revisions = list.revisions || [];
      const head = revisions.find((r) => r.isHead);
      selectedId = head ? head.id : (revisions.length ? revisions[revisions.length - 1].id : null);
      populateCompareOptions();
      renderTree();
      await loadDiff();
    } catch (e) {
      treeEl.textContent = e.message;
    }
  }

  async function showAdminAiAccess() {
    if (!state.isAdmin) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide admin-ai-modal">
        <h2>AI access control</h2>
        <p class="ai-disclaimer">AI can be off for everyone until you enable features per user. Set optional token quotas to cap usage (blank = unlimited). Administrators listed in <code>SIAMTEX_ADMIN_GITHUB_LOGINS</code> always have full feature access but still appear in usage totals.</p>
        <div id="adminAiSiteUsage" class="admin-ai-site-usage pill hidden"></div>
        <p id="adminAiStatus" class="pill">Loading users…</p>
        <div id="adminAiTable" class="admin-ai-table-wrap"></div>
        <div class="modal-actions">
          <button type="button" id="adminAiClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#adminAiClose').onclick = () => backdrop.remove();

    const tableEl = backdrop.querySelector('#adminAiTable');
    const statusEl = backdrop.querySelector('#adminAiStatus');
    const siteEl = backdrop.querySelector('#adminAiSiteUsage');

    const featureCols = [
      ['chat', 'Chat'],
      ['createProject', 'Create'],
      ['assist', 'Assist'],
      ['fixErrors', 'Fix'],
      ['settings', 'Settings'],
    ];

    async function refreshAdminTable() {
      const data = await api('/api/admin_ai_access.php');
      statusEl.textContent = `${data.users.length} user(s) · admins from SIAMTEX_ADMIN_GITHUB_LOGINS`;
      renderTable(data.users || [], data.siteUsage);
    }

    async function saveTokenQuota(userId, input) {
      const raw = String(input.value || '').trim().replace(/,/g, '');
      const tokenQuota = raw === '' ? null : Number(raw);
      if (raw !== '' && (!Number.isFinite(tokenQuota) || tokenQuota < 0)) {
        toast('Quota must be a non-negative number or empty for unlimited', 'error');
        return;
      }
      input.disabled = true;
      try {
        await api('/api/admin_ai_access.php', {
          method: 'PATCH',
          json: { userId, tokenQuota },
        });
        toast('Token quota saved', 'ok');
        await refreshAdminTable();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        input.disabled = false;
      }
    }

    function renderTable(users, siteUsage) {
      if (siteUsage?.totalTokens) {
        siteEl.classList.remove('hidden');
        siteEl.innerHTML = `<strong>All users:</strong> ${formatTokens(siteUsage.totalTokens)} tokens
          (${formatTokens(siteUsage.promptTokens)} in · ${formatTokens(siteUsage.completionTokens)} out · ${siteUsage.callCount} calls)`;
      } else {
        siteEl.classList.add('hidden');
      }
      if (!users.length) {
        tableEl.innerHTML = '<p class="ai-disclaimer">No users yet.</p>';
        return;
      }
      tableEl.innerHTML = `
        <table class="admin-ai-table">
          <thead>
            <tr>
              <th>User</th>
              ${featureCols.map(([, label]) => `<th>${esc(label)}</th>`).join('')}
              <th>Token use</th>
              <th>Quota</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => `
              <tr data-user-id="${u.id}" class="${u.isAdmin ? 'admin-row' : ''}">
                <td>
                  <div class="admin-ai-user">
                    <strong>${esc(u.name)}</strong>
                    ${u.login ? `<span class="admin-ai-login">@${esc(u.login)}</span>` : ''}
                    ${u.isAdmin ? '<span class="pill">admin</span>' : ''}
                  </div>
                </td>
                ${featureCols.map(([key]) => `
                  <td class="admin-ai-check">
                    ${u.isAdmin ? '✓' : `<input type="checkbox" data-feature="${esc(key)}" ${u.permissions?.[key] ? 'checked' : ''} />`}
                  </td>`).join('')}
                <td class="admin-ai-tokens">${esc(formatQuotaUsage(u.aiUsage, u.tokenQuota))}</td>
                <td class="admin-ai-quota">
                  <input type="text" class="admin-ai-quota-input" data-user-id="${u.id}"
                    value="${u.tokenQuota ? esc(String(u.tokenQuota)) : ''}"
                    placeholder="∞" title="Leave empty for unlimited tokens" />
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      tableEl.querySelectorAll('tbody tr:not(.admin-row) input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const row = cb.closest('tr');
          const userId = Number(row?.getAttribute('data-user-id'));
          if (!userId) return;
          const permissions = {};
          row.querySelectorAll('input[data-feature]').forEach((input) => {
            permissions[input.getAttribute('data-feature')] = input.checked;
          });
          cb.disabled = true;
          try {
            await api('/api/admin_ai_access.php', {
              method: 'PATCH',
              json: { userId, permissions },
            });
            toast('Saved AI access for user', 'ok');
            await refreshAdminTable();
          } catch (e) {
            toast(e.message, 'error');
            cb.checked = !cb.checked;
          } finally {
            cb.disabled = false;
          }
        });
      });

      tableEl.querySelectorAll('.admin-ai-quota-input').forEach((input) => {
        input.addEventListener('change', () => {
          const userId = Number(input.getAttribute('data-user-id'));
          if (userId) saveTokenQuota(userId, input);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        });
      });
    }

    try {
      await refreshAdminTable();
    } catch (e) {
      statusEl.textContent = e.message;
      tableEl.innerHTML = '';
    }
  }

  async function boot() {
    try {
      if (typeof CodeMirror === 'undefined') {
        console.warn('CodeMirror failed to load; using textarea fallback');
      }
      const me = await api('/api/auth_me.php');
      state.user = me.user;
      state.authRequired = me.authRequired;
      state.providers = me.providers || [];
      state.oauthConfigured = me.oauthConfigured;
      state.aiEnabled = !!me.aiEnabled;
      state.aiPermissions = me.aiPermissions || null;
      state.isAdmin = !!me.isAdmin;
      state.aiConfig = me.aiConfig || null;
      state.aiUsage = me.aiUsage || null;
      renderTop();
      initAiChatPanel();

      if (!state.user && state.authRequired) {
        renderSplash();
        return;
      }

      const params = new URLSearchParams(location.search);
      const projectId = params.get('project');
      const token = params.get('token');
      if (projectId) {
        await openProject(projectId, token);
      } else {
        await loadDashboard();
      }
    } catch (e) {
      $main().innerHTML = `<section class="card splash"><h1>SiamTeX</h1><p>${esc(e.message)}</p></section>`;
    }
  }

  boot();
})();
