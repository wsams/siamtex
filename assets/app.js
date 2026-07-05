/* SiamTeX client — beginner-friendly LaTeX editor */
(function () {
  'use strict';

  const BASE = window.SIAMTEX_BASE || '/siamtex';

  const state = {
    user: null,
    authRequired: false,
    providers: [],
    oauthConfigured: false,
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
    autoTimer: null,
    compiling: false,
  };

  const $main = () => document.getElementById('main');
  const $top = () => document.getElementById('topActions');

  function api(path, opts = {}) {
    const headers = Object.assign({ 'X-SiamTeX-CSRF': '1' }, opts.headers || {});
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    return fetch(BASE + path, { credentials: 'same-origin', ...opts, headers }).then(async (res) => {
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
    el.textContent = msg;
    el.className = 'toast ' + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast hidden'; }, 3200);
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

  function toolbarHtml(canEdit) {
    if (!canEdit) {
      return '<div class="insert-toolbar"><span class="toolbar-hint">View only</span></div>';
    }
    const btn = (key, title) =>
      `<button type="button" class="tb" data-snip="${key}" title="${esc(title || SNIPPETS[key]?.label || key)}">${esc(title || SNIPPETS[key]?.label || key)}</button>`;

    return `
      <div class="insert-toolbar" id="insertToolbar">
        <div class="tb-group">
          <span class="tb-label">Text</span>
          ${btn('bold', 'Bold')}
          ${btn('italic', 'Italic')}
          ${btn('underline', 'Underline')}
          ${btn('emph', 'Emph')}
          ${btn('color', 'Color')}
          ${btn('large', 'Larger')}
          ${btn('small', 'Smaller')}
        </div>
        <div class="tb-group">
          <span class="tb-label">Structure</span>
          ${btn('section', 'Heading')}
          ${btn('subsection', 'Subhead')}
          ${btn('itemize', 'Bullets')}
          ${btn('enumerate', 'Numbers')}
          ${btn('item', 'Item')}
          ${btn('link', 'Link')}
          ${btn('hline', 'Line')}
          ${btn('vspace', 'Space')}
        </div>
        <div class="tb-group">
          <span class="tb-label">Math</span>
          ${btn('mathInline', 'Inline $')}
          ${btn('mathBlock', 'Block')}
          ${btn('fraction', 'Fraction')}
          ${btn('sqrt', 'Sqrt')}
        </div>
        <div class="tb-group">
          <span class="tb-label">Resume</span>
          ${btn('resumeHeader', 'Header')}
          ${btn('resumeSection', 'Section')}
          ${btn('resumeJob', 'Job')}
          ${btn('resumeSkill', 'Skills')}
        </div>
        <div class="tb-group">
          <span class="tb-label">More</span>
          ${btn('table', 'Table')}
          ${btn('image', 'Image')}
          ${btn('quote', 'Quote')}
          ${btn('center', 'Center')}
          ${btn('footnote', 'Footnote')}
          ${btn('comment', 'Comment')}
          ${btn('geometry', 'Margins')}
        </div>
        <p class="toolbar-hint">Select text, then click Bold/Italic/Color — or click a button to insert a starter snippet. You do not need to know LaTeX commands.</p>
      </div>`;
  }

  function bindToolbar() {
    document.getElementById('insertToolbar')?.querySelectorAll('[data-snip]').forEach((btn) => {
      btn.addEventListener('click', () => insertSnippet(btn.getAttribute('data-snip')));
    });
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
      <div class="user-chip">${avatar}<span>${esc(u.name || u.login || 'User')}</span></div>
      ${state.oauthConfigured ? `<button type="button" id="btnLogout" class="ghost">Sign out</button>` : ''}`;
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
    const projects = state.projects.map((p) => `
      <article class="card clickable" data-open="${esc(p.id)}">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.mainFile)} · ${esc(p.engine)}</p>
        <div class="meta">
          <span class="pill">${esc(p.role || 'owner')}</span>
          ${p.hasPdf ? '<span class="pill">PDF ready</span>' : ''}
        </div>
        <div class="card-actions">
          <button type="button" data-open="${esc(p.id)}" class="primary">Open</button>
          <button type="button" data-del="${esc(p.id)}" class="danger">Delete</button>
        </div>
      </article>`).join('');

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
            <p>Start from a template — the editor opens with sample text you can edit using the toolbar buttons.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" id="btnNew" class="primary">New project</button>
            <label class="btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
              Import zip
              <input id="importFile" type="file" accept=".zip,application/zip" hidden />
            </label>
          </div>
        </div>
        <div class="grid">${projects || '<p class="pill">No projects yet — create one from a template.</p>'}</div>
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
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      indentUnit: 2,
      tabSize: 2,
      readOnly: !!readOnly,
      extraKeys: {
        'Ctrl-S': () => { saveActive(); return false; },
        'Cmd-S': () => { saveActive(); return false; },
        'Ctrl-Enter': () => { compileNow(); return false; },
        'Cmd-Enter': () => { compileNow(); return false; },
      },
    });

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
          <div class="pane-label" id="editorLabel">Editor — click here and type, or use the buttons above</div>
          <div id="editorHost"></div>
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
    document.getElementById('btnAddFile')?.addEventListener('click', addFile);
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
    renderFileList();
    renderProblems();
    updateStatusDot();
    createEditor('', !canEdit);
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
        ? ' — click in the editor and type, or use the toolbar buttons'
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
    }
    renderFileList();
  }

  async function saveActive() {
    const path = state.activePath;
    if (!path || !state.dirty[path] || isBinaryFile({ path })) return;
    const content = state.editor ? state.editor.getValue() : (state.contents[path] ?? '');
    state.contents[path] = content;
    await api('/api/files.php?id=' + encodeURIComponent(state.project.id), {
      method: 'PUT',
      json: { path, content },
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
      updateStatusDot(result.status === 'error' ? 'error' : 'ok');
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

  function renderProblems() {
    const body = document.getElementById('problemsBody');
    if (!body) return;
    if (state.problemsTab === 'log') {
      body.innerHTML = `<div class="log-view">${esc(state.build?.log || 'No build log yet. Click Compile to build your PDF.')}</div>`;
      return;
    }
    const diags = state.build?.diagnostics || [];
    if (!diags.length) {
      body.innerHTML = '<div class="pill">No problems from the last build. Click Compile when you are ready.</div>';
      return;
    }
    body.innerHTML = diags.map((d, i) => `
      <div class="diag" data-i="${i}">
        <span class="sev-${esc(d.severity)}">${esc(d.severity)}</span>
        <span>${esc(d.message)}</span>
        <span class="loc">${esc(d.file || state.project.mainFile)}${d.line ? ':' + d.line : ''}</span>
      </div>`).join('');
    body.querySelectorAll('.diag').forEach((el) => {
      el.onclick = async () => {
        const d = diags[Number(el.getAttribute('data-i'))];
        const file = d.file && !String(d.file).includes('texmf') ? d.file : state.project.mainFile;
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
      kind = s === 'error' ? 'error' : s ? 'ok' : '';
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

  async function uploadProjectFiles(fileList, { path = '', prefix = '' } = {}) {
    const files = Array.from(fileList || []);
    if (!files.length) throw new Error('Choose one or more files to upload.');
    const fd = new FormData();
    fd.append('id', state.project.id);
    if (files.length === 1 && path) {
      fd.append('path', path);
      fd.append('file', files[0]);
    } else {
      if (prefix) fd.append('prefix', prefix.replace(/^\/+|\/+$/g, ''));
      files.forEach((f) => fd.append('files[]', f));
    }
    const res = await fetch(BASE + '/api/upload.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-SiamTeX-CSRF': '1' },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
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
          <p>Select <em>multiple</em> files at once. TeX sources, styles, fonts, images, PDF/EPS, and other project assets. Max 5&nbsp;MB each.</p>
          <input id="afUpload" type="file" multiple accept=".tex,.ltx,.sty,.cls,.clo,.dtx,.ins,.fd,.def,.cfg,.bib,.bst,.bbx,.cbx,.lbx,.dbx,.txt,.md,.csv,.tsv,.json,.yaml,.yml,.xml,.svg,.lua,.lco,.ldf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.ico,.pdf,.eps,.ps,.otf,.ttf,.ttc,.woff,.woff2,.pfb,.afm,.tfm,.map,.enc" />
          <p id="afUploadCount" class="upload-count"></p>
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
    const updateCount = () => {
      const n = uploadInput.files?.length || 0;
      uploadCount.textContent = n ? `${n} file${n === 1 ? '' : 's'} selected` : '';
    };
    uploadInput.addEventListener('change', updateCount);

    backdrop.querySelector('#afUploadBtn').onclick = async () => {
      const btn = backdrop.querySelector('#afUploadBtn');
      try {
        const list = uploadInput.files;
        if (!list?.length) throw new Error('Choose one or more files to upload.');
        const path = (backdrop.querySelector('#afUploadPath').value || '').trim();
        const prefix = (backdrop.querySelector('#afUploadPrefix').value || '').trim();
        for (const f of list) {
          const dest = sanitizePath(list.length === 1 && path
            ? path
            : (prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' + f.name : f.name));
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
        const errN = (data.errors || []).length;
        backdrop.remove();
        if (saved.length) {
          await loadFile(saved[saved.length - 1].path);
        }
        if (errN) {
          toast(`Uploaded ${saved.length}, ${errN} failed`, 'error');
        } else {
          toast(saved.length === 1 ? `Uploaded ${saved[0].path}` : `Uploaded ${saved.length} files`, 'ok');
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Upload files';
        toast(e.message, 'error');
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
          json: { path, content },
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
