/* SiamTeX native spell check — Typo.js overlay for CodeMirror (TeX-aware). */
(function (global) {
  'use strict';

  const DICT_LANG = 'en_US';
  const SUGGEST_LIMIT = 6;
  const TEX_WHITELIST = new Set([
    'latex', 'tex', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber',
    'tikz', 'beamer', 'siunitx', 'microtype', 'hyperref', 'amsmath', 'amssymb',
    'natbib', 'biblatex', 'fancyhdr', 'geometry', 'graphicx', 'booktabs',
    'overleaf', 'siamtex', 'includegraphics', 'textwidth',
    'linewidth', 'baselineskip', 'footnotesize', 'scriptsize', 'normalsize',
    'textbf', 'textit', 'texttt', 'emph', 'subsubsection', 'subparagraph',
  ]);

  /** Commands whose braced / bracketed args are not prose. */
  const SKIP_ARG_CMDS = new Set([
    'begin', 'end', 'cite', 'citep', 'citepauthor', 'citepyear', 'citepalt',
    'citepyear', 'citet', 'citepp', 'citepalp', 'citeyearpar',
    'ref', 'pageref', 'eqref', 'autoref', 'cref', 'Cref', 'label',
    'includegraphics', 'input', 'include', 'includeonly',
    'bibliography', 'addbibresource', 'bibliographystyle', 'nocite',
    'usepackage', 'RequirePackage', 'documentclass', 'ProvidesPackage',
    'newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand',
    'newenvironment', 'renewenvironment',
    'definecolor', 'color', 'textcolor', 'colorbox', 'pagecolor',
    'href', 'url', 'path', 'nolinkurl',
    'verb', 'lstinline', 'texttt',
    'tag', 'setcounter', 'addtocounter', 'setlength', 'addtolength',
    'fontsize', 'selectfont', 'fontfamily', 'fontseries', 'fontshape',
    'addcontentsline', 'pdfbookmark', 'hypersetup', 'geometry',
    'newtheorem', 'theoremstyle',
  ]);

  let dictPromise = null;
  let dict = null;
  let ignoreWords = loadIgnoreWords();

  function loadIgnoreWords() {
    try {
      const raw = localStorage.getItem('siamtex_spell_ignore');
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.map((w) => String(w).toLowerCase()) : []);
    } catch {
      return new Set();
    }
  }

  function saveIgnoreWords() {
    try {
      localStorage.setItem('siamtex_spell_ignore', JSON.stringify([...ignoreWords]));
    } catch { /* */ }
  }

  function dictBase(appBase) {
    return (appBase || '') + '/assets/spell/dictionaries/' + DICT_LANG + '/' + DICT_LANG;
  }

  function ensureDictionary(appBase) {
    if (dict && dict.loaded) return Promise.resolve(dict);
    if (dictPromise) return dictPromise;
    if (typeof Typo === 'undefined') {
      return Promise.reject(new Error('Typo.js failed to load'));
    }
    const base = dictBase(appBase);
    dictPromise = Promise.all([
      fetch(base + '.aff').then((r) => {
        if (!r.ok) throw new Error('Could not load spell dictionary (.aff)');
        return r.text();
      }),
      fetch(base + '.dic').then((r) => {
        if (!r.ok) throw new Error('Could not load spell dictionary (.dic)');
        return r.text();
      }),
    ]).then(([aff, dic]) => {
      dict = new Typo(DICT_LANG, aff, dic);
      return dict;
    }).catch((err) => {
      dictPromise = null;
      throw err;
    });
    return dictPromise;
  }

  function isWordOk(word) {
    if (!word || word.length < 2) return true;
    if (!/[A-Za-z]/.test(word)) return true;
    if (/\d/.test(word)) return true;
    const lower = word.toLowerCase();
    if (ignoreWords.has(lower)) return true;
    if (TEX_WHITELIST.has(lower)) return true;
    // Single-letter after strip (e.g. "a") — dictionary handles; keep short words
    if (!dict || !dict.loaded) return true;
    if (dict.check(word)) return true;
    // Title Case / ALL CAPS: try lowercase form
    if (word !== lower && dict.check(lower)) return true;
    return false;
  }

  function suggest(word) {
    if (!dict || !dict.loaded || !word) return [];
    try {
      return dict.suggest(word, SUGGEST_LIMIT) || [];
    } catch {
      return [];
    }
  }

  function createOverlay() {
    return {
      startState() {
        return {
          inMath: false,
          mathKind: null, // '$' | '$$' | '\\(' | '\\['
          skipDepth: 0,
          skipCmd: null,
        };
      },
      copyState(s) {
        return {
          inMath: s.inMath,
          mathKind: s.mathKind,
          skipDepth: s.skipDepth,
          skipCmd: s.skipCmd,
        };
      },
      token(stream, state) {
        // Line comment
        if (stream.peek() === '%' && !state.inMath) {
          stream.skipToEnd();
          return null;
        }

        // Closing / opening display & inline math delimiters
        if (!state.inMath && stream.match('$$')) {
          state.inMath = true;
          state.mathKind = '$$';
          return null;
        }
        if (state.inMath && state.mathKind === '$$' && stream.match('$$')) {
          state.inMath = false;
          state.mathKind = null;
          return null;
        }
        if (!state.inMath && stream.match('\\[')) {
          state.inMath = true;
          state.mathKind = '\\[';
          return null;
        }
        if (state.inMath && state.mathKind === '\\[' && stream.match('\\]')) {
          state.inMath = false;
          state.mathKind = null;
          return null;
        }
        if (!state.inMath && stream.match('\\(')) {
          state.inMath = true;
          state.mathKind = '\\(';
          return null;
        }
        if (state.inMath && state.mathKind === '\\(' && stream.match('\\)')) {
          state.inMath = false;
          state.mathKind = null;
          return null;
        }
        if (!state.inMath && stream.match('$')) {
          state.inMath = true;
          state.mathKind = '$';
          return null;
        }
        if (state.inMath && state.mathKind === '$' && stream.match('$')) {
          state.inMath = false;
          state.mathKind = null;
          return null;
        }

        if (state.inMath) {
          stream.next();
          return null;
        }

        // Backslash command
        if (stream.peek() === '\\') {
          stream.next();
          if (stream.match(/[a-zA-Z@]+/)) {
            const cmd = stream.current().slice(1);
            if (SKIP_ARG_CMDS.has(cmd) || SKIP_ARG_CMDS.has(cmd.replace(/\*$/, ''))) {
              state.skipCmd = cmd;
              state.skipDepth = 0;
            }
            return null;
          }
          // Single-char command (\, \_, etc.)
          if (!stream.eol()) stream.next();
          return null;
        }

        // Skip braced / bracketed args after skip commands
        if (state.skipCmd) {
          // Allow whitespace / * between command and its args
          if (state.skipDepth === 0) {
            if (stream.eatSpace()) return null;
            if (stream.peek() === '*') {
              stream.next();
              return null;
            }
            const ch0 = stream.peek();
            if (ch0 !== '{' && ch0 !== '[') {
              state.skipCmd = null;
            }
          }
        }
        if (state.skipCmd) {
          const ch = stream.peek();
          if (ch === '{' || ch === '[') {
            state.skipDepth += 1;
            stream.next();
            return null;
          }
          if ((ch === '}' || ch === ']') && state.skipDepth > 0) {
            state.skipDepth -= 1;
            stream.next();
            if (state.skipDepth === 0) {
              // More [ ] { } groups for \newcommand / \href etc.
              const next = stream.peek();
              if (next === '{' || next === '[') {
                return null;
              }
              state.skipCmd = null;
            }
            return null;
          }
          if (state.skipDepth > 0) {
            stream.next();
            return null;
          }
        }

        // Word token
        if (stream.match(/[A-Za-z][A-Za-z']*/)) {
          const word = stream.current();
          if (!isWordOk(word)) return 'spell-error';
          return null;
        }

        stream.next();
        return null;
      },
    };
  }

  function wordAt(cm, pos) {
    const line = cm.getLine(pos.line) || '';
    let start = pos.ch;
    let end = pos.ch;
    while (start > 0 && /[A-Za-z']/.test(line.charAt(start - 1))) start -= 1;
    while (end < line.length && /[A-Za-z']/.test(line.charAt(end))) end += 1;
    if (start === end) return null;
    const word = line.slice(start, end);
    if (!/[A-Za-z]/.test(word)) return null;
    return { word, from: { line: pos.line, ch: start }, to: { line: pos.line, ch: end } };
  }

  function tokenIsSpellError(cm, pos) {
    const tok = cm.getTokenTypeAt(pos);
    return !!(tok && tok.split(/\s+/).includes('spell-error'));
  }

  function hideMenu() {
    const el = document.getElementById('siamtexSpellMenu');
    if (el) el.remove();
    document.removeEventListener('click', hideMenu, true);
    document.removeEventListener('keydown', onMenuKey, true);
  }

  function onMenuKey(e) {
    if (e.key === 'Escape') hideMenu();
  }

  function showSuggestionMenu(cm, evt, hit) {
    hideMenu();
    const suggestions = isWordOk(hit.word) ? [] : suggest(hit.word);
    const menu = document.createElement('div');
    menu.id = 'siamtexSpellMenu';
    menu.className = 'spell-suggest-menu';
    menu.setAttribute('role', 'menu');

    if (suggestions.length) {
      suggestions.forEach((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spell-suggest-item';
        btn.textContent = s;
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          cm.replaceRange(s, hit.from, hit.to);
          hideMenu();
          cm.focus();
        };
        menu.appendChild(btn);
      });
    } else if (!isWordOk(hit.word)) {
      const none = document.createElement('div');
      none.className = 'spell-suggest-empty';
      none.textContent = 'No suggestions';
      menu.appendChild(none);
    }

    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.className = 'spell-suggest-item spell-suggest-ignore';
    ignore.textContent = 'Ignore “' + hit.word + '”';
    ignore.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      ignoreWords.add(hit.word.toLowerCase());
      saveIgnoreWords();
      refreshOverlay(cm);
      hideMenu();
    };
    menu.appendChild(ignore);

    document.body.appendChild(menu);
    const x = Math.min(evt.clientX, window.innerWidth - 220);
    const y = Math.min(evt.clientY, window.innerHeight - 200);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    setTimeout(() => {
      document.addEventListener('click', hideMenu, true);
      document.addEventListener('keydown', onMenuKey, true);
    }, 0);
  }

  function onContextMenu(cm, evt) {
    const pos = cm.coordsChar({ left: evt.clientX, top: evt.clientY }, 'window');
    const hit = wordAt(cm, pos);
    if (!hit || isWordOk(hit.word)) return;
    const probeCh = hit.from.ch + Math.max(0, Math.floor((hit.to.ch - hit.from.ch) / 2));
    const probe = { line: hit.from.line, ch: probeCh };
    if (!tokenIsSpellError(cm, probe) && !tokenIsSpellError(cm, hit.from)) return;
    evt.preventDefault();
    showSuggestionMenu(cm, evt, hit);
  }

  function refreshOverlay(cm) {
    if (!cm || !cm.state || !cm.state._siamtexSpell) return;
    const st = cm.state._siamtexSpell;
    if (st.overlay) {
      try { cm.removeOverlay(st.overlay); } catch { /* */ }
    }
    st.overlay = createOverlay();
    cm.addOverlay(st.overlay);
  }

  function detach(cm) {
    if (!cm) return;
    hideMenu();
    const st = cm.state && cm.state._siamtexSpell;
    if (!st) return;
    if (st.overlay) {
      try { cm.removeOverlay(st.overlay); } catch { /* */ }
    }
    if (st.onContext) {
      cm.getWrapperElement()?.removeEventListener('contextmenu', st.onContext);
    }
    if (cm.state) delete cm.state._siamtexSpell;
  }

  function attach(cm, appBase) {
    if (!cm || typeof cm.addOverlay !== 'function') return Promise.resolve(false);
    detach(cm);
    return ensureDictionary(appBase).then(() => {
      const overlay = createOverlay();
      const onContext = (evt) => onContextMenu(cm, evt);
      cm.state = cm.state || {};
      cm.state._siamtexSpell = { overlay, onContext };
      cm.addOverlay(overlay);
      cm.getWrapperElement()?.addEventListener('contextmenu', onContext);
      return true;
    });
  }

  function clearIgnoreList() {
    ignoreWords = new Set();
    saveIgnoreWords();
  }

  global.SiamTeXSpell = {
    ensureDictionary,
    attach,
    detach,
    refreshOverlay,
    clearIgnoreList,
    isReady: () => !!(dict && dict.loaded),
  };
})(typeof window !== 'undefined' ? window : globalThis);
