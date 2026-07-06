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
    aiConfig: null,
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
    problemsTab: 'problems',
    shareToken: null,
    editor: null,
    editorTheme: localStorage.getItem('siamtex_editor_theme') || 'material-darker',
    editorVim: localStorage.getItem('siamtex_editor_vim') === '1',
    autoTimer: null,
    compiling: false,
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

  function aiTimeoutSeconds() {
    const n = Number(state.aiConfig?.timeoutSeconds);
    return Number.isFinite(n) && n > 10 ? n : 180;
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
    if (!u || !u.totalTokens) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = `AI ${formatTokens(u.totalTokens)} tok`;
    el.title = `Your account: ${formatTokens(u.promptTokens)} prompt + ${formatTokens(u.completionTokens)} completion tokens across ${u.callCount} call(s)`;
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
    const model = state.aiConfig?.model || 'AI model';
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
      <div class="user-chip">${avatar}<span>${esc(u.name || u.login || 'User')}</span></div>
      ${state.oauthConfigured ? `<button type="button" id="btnLogout" class="ghost">Sign out</button>` : ''}`;
    renderGlobalAiUsage();
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
    const projects = state.projects.map((p) => {
      const usage = p.aiUsage?.totalTokens ? `<span class="pill ai-usage-pill" title="AI tokens used on this project">${formatTokens(p.aiUsage.totalTokens)} tok</span>` : '';
      return `
      <article class="card clickable" data-open="${esc(p.id)}">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.mainFile)} · ${esc(p.engine)}</p>
        <div class="meta">
          <span class="pill">${esc(p.role || 'owner')}</span>
          ${p.hasPdf ? '<span class="pill">PDF ready</span>' : ''}
          ${usage}
        </div>
        <div class="card-actions">
          <button type="button" data-open="${esc(p.id)}" class="primary">Open</button>
          <button type="button" data-del="${esc(p.id)}" class="danger">Delete</button>
        </div>
      </article>`;
    }).join('');

    const aiHero = state.aiEnabled ? `
        <article class="card ai-new-project-card">
          <div class="ai-new-project-glow" aria-hidden="true"></div>
          <div class="ai-new-project-inner">
            <div class="ai-new-project-icon" aria-hidden="true">✦</div>
            <div>
              <h3>New project with AI</h3>
              <p>Describe a document — homework, article, resume, slides — and SiamTeX will generate a multi-file LaTeX project.</p>
              ${state.aiUsage?.totalTokens ? `<p class="ai-usage-note">Account total: <strong>${formatTokens(state.aiUsage.totalTokens)}</strong> tokens across ${state.aiUsage.callCount} AI call(s)</p>` : ''}
            </div>
            <button type="button" id="btnAiNewProject" class="primary ai-sparkle-btn">✦ Create with AI</button>
          </div>
        </article>` : '';

    const templates = state.templates.map((t) => `
      <article class="card">
        <h3>${esc(t.name)}</h3>
        <p>${esc(t.description)}</p>
        <div class="meta">
          <span class="pill">${esc(t.category)}</span>
          <span class="pill">${(t.files || []).length} file${(t.files || []).length === 1 ? '' : 's'}</span>
        </div>
        <p class="tpl-files">${esc((t.files || []).join(', '))}</p>
        <div class="card-actions">
          <button type="button" class="primary" data-tpl="${esc(t.id)}">Use template package</button>
        </div>
      </article>`).join('');

    $main().innerHTML = `
      <section class="dash">
        <div class="dash-head">
          <div>
            <h1>Your projects</h1>
            <p>Start from a template — the editor opens with sample text you can edit using the Insert menus.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" id="btnNew" class="primary">New project</button>
            <label class="btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
              Import zip
              <input id="importFile" type="file" accept=".zip,application/zip" hidden />
            </label>
          </div>
        </div>
        <div class="grid dash-feature-grid">${aiHero}${projects || ''}</div>
        ${!projects && !aiHero ? '<p class="pill">No projects yet — create one from a template or with AI.</p>' : ''}
        <div class="templates">
          <h2>Templates</h2>
          <div class="grid">${templates}</div>
        </div>
      </section>`;

    $main().querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
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
    if (!state.aiEnabled) {
      toast('AI is not configured on this server', 'error');
      return;
    }
    const cfg = state.aiConfig || {};
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
        streaming: false,
        subtitle: 'Token usage updates below — cloud providers may bill per token.',
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
    renderDashboard();
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
    return `
      <div class="editor-prefs">
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
      const data = await api('/api/project.php' + q);
      state.project = data.project;
      state.files = data.files || [];
      state.build = data.build;
      if (data.aiUsage) state.project.aiUsage = data.aiUsage;
      state.contents = {};
      state.dirty = {};
      state.activePath = state.project.mainFile || 'main.tex';
      history.replaceState({}, '', BASE + '/?project=' + encodeURIComponent(id)
        + (shareToken ? '&token=' + encodeURIComponent(shareToken) : ''));
      renderWorkspace();
      await loadFile(state.activePath);
      if (state.project.hasPdf) refreshPdf();
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
          <button type="button" id="btnExport">Export</button>
          ${p.role === 'owner' ? '<button type="button" id="btnShare">Share</button>' : ''}
          <button type="button" id="btnTools">Tools</button>
          ${canEdit ? '<button type="button" id="btnAi">AI</button>' : ''}
          <button type="button" id="btnHistory" title="Version history">History</button>
          <span id="aiUsageProject" class="pill ai-usage-project hidden" title="AI token usage for this project"></span>
        </div>
        ${toolbarHtml(canEdit)}
        <aside class="files">
          <h4>Files</h4>
          <div id="fileList"></div>
          ${canEdit ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" id="btnAddFile">+ File</button>
          </div>` : ''}
        </aside>
        <section class="editor-pane">
          <div class="pane-label editor-bar">
            <span id="editorLabel" class="editor-bar-title">Editor — click here and type, or use the Insert menus above</span>
            ${editorPrefsHtml()}
          </div>
          <div id="editorHost" data-editor-theme="${esc(state.editorTheme)}"></div>
        </section>
        <section class="preview-pane">
          <div class="pane-label">PDF preview</div>
          <iframe id="pdfFrame" title="PDF preview"></iframe>
        </section>
        <section class="problems">
          <div class="problems-tabs">
            <button type="button" data-tab="problems" class="active">Problems</button>
            <button type="button" data-tab="log">Build log</button>
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
    document.getElementById('btnAi')?.addEventListener('click', showAiAssist);
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

    bindToolbar();
    wireEditorPrefs();
    renderProjectAiUsage();
    renderFileList();
    renderProblems();
    updateStatusDot();
    createEditor('', !canEdit);
    wireEditorPrefs();
  }

  function isBinaryFile(f) {
    if (!f) return false;
    if (f.binary) return true;
    return /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svgz|pdf|eps|ps|ai|otf|ttf|ttc|woff2?|pfb|pfm|afm|tfm|vf|pk|gf|mf|map|enc)$/i.test(f.path || '');
  }

  function renderFileList() {
    const list = document.getElementById('fileList');
    if (!list) return;
    const canEdit = canEditProject(state.project);
    list.innerHTML = state.files.map((f) => `
      <div class="file-item ${f.path === state.activePath ? 'active' : ''} ${isBinaryFile(f) ? 'binary' : ''}" data-path="${esc(f.path)}">
        <span>${isBinaryFile(f) ? (/\.(otf|ttf|ttc|woff2?)$/i.test(f.path) ? '🔤 ' : '🖼 ') : ''}${esc(f.path)}${state.dirty[f.path] ? ' •' : ''}</span>
        ${canEdit && f.path !== state.project.mainFile
          ? `<button type="button" data-rm="${esc(f.path)}">×</button>` : ''}
      </div>`).join('');
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
    if (state.editor && state.editor.setValue && document.querySelector('#editorHost .CodeMirror, #editorFallback')) {
      const ro = !canEditProject(state.project);
      state.editor.setOption?.('readOnly', ro);
      state.editor.setValue(text);
      state.editor.refresh?.();
      state.editor.focus?.();
    } else {
      createEditor(text, !canEditProject(state.project));
      wireEditorPrefs();
    }
    renderFileList();
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
      const result = await api('/api/compile.php', {
        method: 'POST',
        json: { id: state.project.id, files },
      });
      Object.keys(files).forEach((p) => { state.dirty[p] = false; });
      state.build = result;
      state.project.hasPdf = result.hasPdf;
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
    const token = state.shareToken ? '&token=' + encodeURIComponent(state.shareToken) : '';
    frame.src = BASE + '/api/pdf.php?id=' + encodeURIComponent(state.project.id) + token + '&t=' + Date.now();
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

  function renderProblems() {
    const body = document.getElementById('problemsBody');
    if (!body) return;
    if (state.problemsTab === 'log') {
      body.innerHTML = `<div class="log-view">${esc(state.build?.log || 'No build log yet. Click Compile to build your PDF.')}</div>`;
      return;
    }
    const diags = state.build?.diagnostics || [];
    const errors = diags.filter((d) => d.severity === 'error');
    const canFix = canEditProject(state.project) && state.aiEnabled && errors.length > 0;
    if (!diags.length) {
      if (state.build?.status === 'error' || state.build?.status === 'ok_with_warnings') {
        const fallback = logProblemFallback(state.build?.log || '');
        if (fallback) {
          body.innerHTML = `<div class="pill" style="margin-bottom:8px">Could not parse structured problems — showing log excerpt:</div><div class="log-view">${esc(fallback)}</div>`;
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

  function showAiAssist() {
    if (!state.aiEnabled) {
      toast('AI is not configured on this server', 'error');
      return;
    }
    if (!state.project || !canEditProject(state.project)) {
      toast('Open an editable project first', 'error');
      return;
    }
    const path = state.activePath;
    if (!path || isBinaryFile({ path })) {
      toast('Open a .tex or text file to edit with AI', 'error');
      return;
    }
    const cfg = state.aiConfig || {};
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>AI assist</h2>
        <p class="ai-disclaimer"><strong>Alpha / experimental.</strong> Sends the current file (or whole project) to your configured provider. Accuracy and usefulness depend on your model — review every change before accepting.</p>
        <p class="pill">${esc(cfg.model || 'model')} @ ${esc(cfg.baseUrl || 'provider')}</p>
        <label>Scope</label>
        <select id="aiScope">
          <option value="file">Current file (${esc(path)})</option>
          <option value="project">Whole project (.tex / .bib)</option>
        </select>
        <label>Instruction</label>
        <textarea id="aiInstruction" rows="4" placeholder="e.g. Improve wording, fix LaTeX errors, expand the summary section…"></textarea>
        <label>Extra reference text (optional)</label>
        <textarea id="aiContext" rows="3" placeholder="Paste notes, job description, or imported text…"></textarea>
        <div class="ai-presets">
          <button type="button" class="tb" data-preset="Improve wording and clarity. Keep structure.">Polish</button>
          <button type="button" class="tb" data-preset="Fix LaTeX syntax issues. Return valid LaTeX only.">Fix LaTeX</button>
          <button type="button" class="tb" data-preset="Expand with more detail while staying concise.">Expand</button>
        </div>
        <div id="aiWaitMount" class="ai-wait-mount hidden"></div>
        <div id="aiPreview" class="ai-preview hidden"></div>
        <div class="modal-actions">
          <button type="button" id="aiTest" class="ghost">Test connection</button>
          <button type="button" id="aiRun" class="primary">Run</button>
          <button type="button" id="aiAccept" class="primary hidden">Accept into editor</button>
          <button type="button" id="aiClose">Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    let pending = null;
    const waitMount = backdrop.querySelector('#aiWaitMount');
    const runBtn = backdrop.querySelector('#aiRun');
    const testBtn = backdrop.querySelector('#aiTest');
    const closeBtn = backdrop.querySelector('#aiClose');
    const acceptBtn = backdrop.querySelector('#aiAccept');

    function modelLabel() {
      return state.aiConfig?.model || 'the model';
    }

    backdrop.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        backdrop.querySelector('#aiInstruction').value = btn.getAttribute('data-preset');
      };
    });

    backdrop.querySelector('#aiTest').onclick = async () => {
      const wait = createAiWait(waitMount, {
        title: 'Testing AI connection',
        subtitle: 'Quick ping to your configured provider.',
        phases: [
          'Contacting the AI provider…',
          'Waiting for a short test reply…',
          'Still waiting on the model…',
          'Connection is slow — check Tailscale / Ollama…',
          'Nearly at the time limit…',
        ],
      });
      try {
        const r = await runAiRequest('/api/ai_test.php', {}, wait, [testBtn, runBtn, closeBtn]);
        toast(r.ok ? 'AI connection OK' : 'Unexpected reply: ' + r.reply, r.ok ? 'ok' : 'error');
      } catch (e) {
        toast(e.message, e.message.includes('cancelled') ? '' : 'error');
      }
    };

    backdrop.querySelector('#aiRun').onclick = async () => {
      const instruction = backdrop.querySelector('#aiInstruction').value.trim();
      if (!instruction) {
        toast('Enter an instruction', 'error');
        return;
      }
      const scope = backdrop.querySelector('#aiScope').value;
      const payload = {
        projectId: state.project.id,
        instruction,
        mode: scope === 'project' ? 'project' : 'file',
        path: scope === 'file' ? path : undefined,
        context: backdrop.querySelector('#aiContext').value.trim(),
      };
      const wait = createAiWait(waitMount, {
        title: scope === 'project' ? 'AI editing project' : `AI editing ${path}`,
        streaming: scope === 'file',
        subtitle: scope === 'project'
          ? 'Multi-file edits use JSON mode — token counts update while the model works.'
          : 'Live LaTeX output appears below; token usage updates as the model responds.',
        phases: scope === 'project' ? [
          `Collecting project files for ${modelLabel()}…`,
          'Uploading context to the model…',
          'Model is planning multi-file edits…',
          'Still writing — project-wide edits can take a few minutes…',
          'Approaching timeout — try single-file mode for faster results…',
        ] : [
          `Reading ${path}…`,
          `Sending to ${modelLabel()}…`,
          'Model is rewriting your LaTeX…',
          'Still generating — local models often need 30–90 seconds…',
          'Approaching timeout — try a shorter instruction…',
        ],
      });
      runBtn.textContent = 'Running…';
      try {
        const data = await runAiStreamRequest('/api/ai_stream.php', payload, wait, [runBtn, testBtn, closeBtn, acceptBtn]);
        pending = { mode: data.mode, result: data.result };
        applyAiUsageFromResponse(data);
        const prev = backdrop.querySelector('#aiPreview');
        prev.classList.remove('hidden');
        if (data.mode === 'file') {
          prev.innerHTML = `<h3>${esc(data.result.summary)}</h3><pre>${esc(data.result.content.slice(0, 8000))}</pre>`;
          acceptBtn.classList.remove('hidden');
        } else {
          const names = Object.keys(data.result.files || {}).join(', ');
          const notes = (data.result.notes || []).filter(Boolean);
          prev.innerHTML = `<h3>${esc(data.result.summary)}</h3><p>Files: ${esc(names)}</p>`;
          if (notes.length) {
            prev.innerHTML += `<div class="ai-notes"><strong>Notes</strong>${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`;
          }
          for (const [fp, body] of Object.entries(data.result.files || {})) {
            prev.innerHTML += `<h4>${esc(fp)}</h4><pre>${esc(String(body).slice(0, 4000))}</pre>`;
          }
          acceptBtn.classList.remove('hidden');
        }
        toast(`AI suggestion ready — ${formatTokenUsage(data.usage)} — review and Accept`, 'ok');
      } catch (e) {
        toast(e.message, e.message.includes('cancelled') ? '' : 'error');
      } finally {
        runBtn.textContent = 'Run';
      }
    };

    backdrop.querySelector('#aiAccept').onclick = async () => {
      if (!pending) return;
      try {
        await applyAiFileChanges(pending);
        toast('AI changes applied', 'ok');
        backdrop.remove();
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    backdrop.querySelector('#aiClose').onclick = () => backdrop.remove();
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
    if (!state.aiEnabled) {
      toast('AI is not configured', 'error');
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>AI fix compile problems</h2>
        <p class="ai-disclaimer"><strong>Alpha / experimental.</strong> Sends compile errors and affected files to your AI provider. Fixes are not guaranteed — quality depends on your model. Review every change before accepting.</p>
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
        streaming: false,
        subtitle: 'Token usage updates while the model generates JSON fix suggestions.',
        phases: [
          'Gathering errors and affected source files from the last build…',
          `Sending context to ${state.aiConfig?.model || 'the model'}…`,
          'Model is diagnosing LaTeX errors and planning fixes…',
          'Generating corrected file content — this often takes 1–3 minutes…',
          'Approaching timeout — cancel and fix one file manually if needed…',
        ],
      });
      runBtn.textContent = 'Analyzing…';
      try {
        const data = await runAiStreamRequest(
          '/api/ai_stream.php',
          { projectId: state.project.id, mode: 'fix_problems' },
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
      state.aiConfig = me.aiConfig || null;
      state.aiUsage = me.aiUsage || null;
      renderTop();

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
