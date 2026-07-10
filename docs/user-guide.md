# SiamTeX user guide

How to use SiamTeX day to day. For install and operators, see [AGENTS.md](../AGENTS.md) and [INSTALL_DO.md](../INSTALL_DO.md). Product requirements live in [SPECS.md](../SPECS.md).

Screenshots in `docs/screenshots/` go stale quickly as the UI evolves — prefer the scenarios below over thumbnail galleries.

---

## Getting started

| Scenario | What it shows |
|---|---|
| Welcome & sign-in | GitHub OAuth when you want it, or local solo mode without a sign-in wall. |
| Project dashboard | Searchable project list, template starters, AI project creation, import/export zip. |
| Editor + live PDF | Multi-file editing, Insert menus, compile errors you can click, preview beside source. |
| Add files & assets | Upload images, bibliographies, and extra `.tex` files without leaving the browser. |
| Import Word (.docx) | Extract text and figures safely (no macros); figures saved under `figures/`; save a basic `.tex` or convert with AI and review before accept. |

**Typical first session**

1. Open the base URL (solo mode) or sign in with GitHub.
2. Create a project from the **homework**, **resume**, **article**, or **blank** template.
3. Edit in the CodeMirror editor; use **Insert** menus for bold, headings, math, lists, and tables if you are new to LaTeX. Turn on **Spell** in the editor bar for offline underlines (right-click a misspelling for suggestions; commands and math are skipped).
4. Watch the side-by-side PDF update after compile (debounced auto-compile or explicit Compile).
5. Click a problem in the diagnostics panel to jump to the offending line.
6. Export a zip when you need an offline copy.

---

## AI chat for questions *(alpha)*

Ask plain-English questions in the sidebar chat, attach project files with `@file`, and copy LaTeX from the reply when you just want help thinking or typesetting.

- Replies render as Markdown with copyable fenced code blocks.
- Use `@filename.tex`, `@active`, or `@selection` to attach context.
- Chat does **not** write files until you paste or use a structured AI tool elsewhere.

> Accuracy depends on the model and provider. Always review suggestions.

---

## AI editing flow *(alpha)*

| Scenario | What happens |
|---|---|
| Start from blank | Create a project, open the editor, and let AI draft the first pass from a plain-English instruction. |
| Filter or rewrite | Use the AI sidebar to pick a target file, choose a filter, review token usage/thinking, and apply the result back into the editor. |
| Review before accept | Watch the stream in chat, inspect the generated LaTeX, then re-apply or continue editing manually. |
| Compile the result | Build immediately after the edit and see the PDF preview update beside the source. |

Also available: **AI fix problems** (send build log + sources → review minimal repair → accept) and **create project from prompt** on the dashboard.

On multi-user hosts, an administrator must enable AI features per account (**AI access**). See [ai-providers.md](./ai-providers.md) and [AI.md](../AI.md).

---

## Bibliography & citations

| Scenario | What happens |
|---|---|
| Open Bibliography | Toolbar **Bibliography** lists entries from project `.bib` files (creates `refs.bib` if needed). |
| Add or edit an entry | Fill type, citation key, author, title, year, and related fields; SiamTeX writes valid BibTeX. |
| Search | Filter by key, author, title, or any field text. |
| Insert a citation | Use **Cite** in the Insert menus, or **Cite** on an entry — inserts `\citep{key}` (or `\citet` / `\nocite`) at the cursor. |
| Missing citations | After compile, undefined keys appear in Problems; click one to open Bibliography and add the entry. |

---

## Image workflow

| Scenario | What happens |
|---|---|
| Upload an asset | Add `png`, `jpg`, `pdf`, bibliography, or extra source files to the project. |
| Import Word | **+ File → Import Word**, extract text & figures into `figures/`, then **Save as basic .tex** or **Convert with AI** (review before accept). Download figures from the binary file pane. |
| Ask AI to place it | Tell AI where to insert the figure; it can use the filename already in the project. |
| Tweak layout in place | Ask AI to resize, re-center, or restyle the figure without hunting through LaTeX manually. |
| Rebuild and verify | Compile again and confirm the PDF layout looks right. |

---

## Recover from compile errors

| Scenario | What happens |
|---|---|
| Problems panel catches the error | Structured diagnostics show file, line, and message. |
| AI fix problems | SiamTeX sends the build log and relevant sources to the model. |
| Minimal repair suggestion | Review the proposed fix before it touches the editor. |
| Clean compile again | Accept the fix, rebuild, and confirm the PDF preview comes back. |

---

## Version history

| Scenario | What happens |
|---|---|
| Timeline view | Every save, AI apply, and restore becomes a node on a per-file branching timeline. |
| Diff before restore | Compare the current editor against any earlier revision before jumping back. |
| Branching restore | Restoring does not erase history; it grows a new branch from the point you chose. |

---

## Multiple PDFs in one project

Any **top-level** `.tex` file in the project root (for example `main.tex` and `cover-letter.tex`) can compile to its own PDF. Partials in subfolders are inputs only. The preview, build log, and problems panel follow the active compile entry.

---

## Sharing, import, and tools

- **Share links** — generate a link with view (or API-supported edit) access; permissions are enforced server-side.
- **Import / export zip** — move projects between instances or keep offline backups.
- **Author tools** — page-length estimate, geometry/margins helper, rough word count (Tools panel).

---

## Related docs

| Doc | Audience |
|-----|----------|
| [features.md](./features.md) | Full feature inventory |
| [roadmap.md](./roadmap.md) | Gaps vs competitors and planned work |
| [SPECS.md](../SPECS.md) | Product & security requirements |
| [AI.md](../AI.md) | BYOK architecture |
| [ai-providers.md](./ai-providers.md) | Operator AI setup |
