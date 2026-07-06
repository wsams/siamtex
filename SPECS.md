# SiamTeX — Product & Technical Specifications

**Working title:** SiamTeX (rebuild of the ~2004 original)  
**Purpose:** A modern web application for writing, compiling, and sharing LaTeX documents.  
**Audience:** Students and professionals who need an intuitive, secure, collaborative TeX environment.

This document is the source of truth for product requirements and engineering direction. Implementation should follow current best practices unless a requirement below explicitly constrains the approach.

---

## 1. Vision

Rebuild SiamTeX as a beautiful, responsive, security-first LaTeX IDE in the browser: draft with a rich, syntax-aware editor; compile to PDF with live side-by-side preview; manage multi-file projects, bibliographies, templates, and sharing—while keeping documents encrypted and the experience approachable for newcomers and powerful for experts.

---

## 2. Goals & Non-Goals

### Goals

- Write and render LaTeX in the browser with a PHP backend.
- GitHub-based authentication.
- Real-time (or near–real-time) PDF preview beside the editor.
- Multi-file projects, bibliographies, templates, import/export, and sharing.
- Smart surfacing of compile errors in the UI (not only a raw log).
- Encryption at rest and during processing where feasible.
- Strong security posture across the stack.
- Intuitive UX for students and professionals on many devices.

### Non-Goals (initial release)

- Replacing Overleaf feature-for-feature on day one.
- Guaranteeing support for every TeX engine/package combination.
- Real-time multi-cursor co-editing in v1 (architecture should not block it later).
- Hosting arbitrary untrusted binaries or user-supplied TeX engines.
- Federating third-party template hosts in v1 (first-party curated catalog only).

---

## 3. Functional Requirements

### 3.1 Platform & Architecture

| ID | Requirement |
|----|-------------|
| F-01 | The product is a **website** with a **PHP backend**. |
| F-02 | The site enables users to **write and render LaTeX**. |
| F-03 | The product is a **rebuild of SiamTeX** (original ~2004), modernized in UX, security, and tooling. |
| F-04 | Prefer a clear separation of concerns: presentation (responsive frontend), application API (PHP), compile/worker layer, and encrypted storage. |
| F-05 | Use current best practices for PHP (supported PHP version, Composer, structured app layout, env-based config, PSR-friendly autoloading where practical). |

### 3.2 Authentication & Accounts

| ID | Requirement |
|----|-------------|
| F-10 | Users can **sign in**. |
| F-11 | Authentication uses **GitHub OAuth** (primary identity provider). |
| F-12 | Sessions must be secure (HTTP-only cookies, CSRF protection, appropriate SameSite, short idle timeouts where sensible). |
| F-13 | Account linking is GitHub-centric; profile display may use GitHub name/avatar with user-controlled display preferences. |

### 3.3 Editor Experience

| ID | Requirement |
|----|-------------|
| F-20 | Users can draft `.tex` (and related) files in a **rich text / code editor** with **syntax highlighting**. |
| F-21 | Editor should support modern IDE conveniences appropriate to TeX: line numbers, search/replace, bracket matching, indentation, and optional dark/light themes. |
| F-22 | **Compile errors** must be visible in the editor experience (e.g., gutter markers, inline annotations, click-to-jump to source line when log parsing allows). |
| F-23 | Multi-file navigation within a project (file tree / tabs). |
| F-24 | **Beginner-first authoring:** users may have never used TeX/LaTeX. The UI must provide **menus/buttons** to insert common constructs without typing commands. |
| F-25 | Insert helpers must include at least: **bold, italic, underline, headings, links, bullet/numbered lists, colors, font size, math (inline/block), tables, images, comments**, plus **resume-oriented** snippets (header, section, job entry, skills). |
| F-26 | Creating a project from a template must **open the editor with the template body loaded and editable** immediately (focus in editor, visible starter text). |
| F-27 | Toolbar actions wrap the current selection when present (e.g. select a word → Bold). |

### 3.4 Live Preview & Build

| ID | Requirement |
|----|-------------|
| F-30 | Users can **render the PDF in a side-by-side pane**. |
| F-31 | Preview updates in **real time** (or near–real-time: debounced auto-compile and/or explicit “Compile” with optional auto mode). |
| F-32 | Users can **see build logs**. |
| F-33 | Errors from build logs must **bubble into the UI smartly**—structured diagnostics (file, line, message, severity), not only a plain log file view. Raw log remains available for power users. |
| F-34 | Build pipeline should support common academic workflows (e.g., `pdflatex` / `xelatex` / `lualatex` and bibliography tools such as BibTeX/Biber as configured per project). |

### 3.5 Projects & Files

| ID | Requirement |
|----|-------------|
| F-40 | Projects may include **extra TeX (and related) files** as needed (e.g., chapters, styles, images, `.bib`, `.cls`, `.sty`). |
| F-41 | Users can **import files into a project**. |
| F-41a | Users can **upload** assets (images, PDF, text) into a project via the Add file dialog; binary assets are stored encrypted and materialized at compile time. |
| F-42 | Users can **export and share projects** (downloadable archive and/or share links with access control). |
| F-43 | Clear project model: root/main file, assets, bibliography sources, and build settings. |

### 3.6 Sharing & Collaboration

| ID | Requirement |
|----|-------------|
| F-50 | Users can **share documents with each other**. |
| F-51 | Sharing supports at least: private, link-shared (view/edit as designed), and invite-by-account where practical. |
| F-52 | Permissions must be enforced server-side on every read/write/compile action. |

### 3.7 Bibliographies

| ID | Requirement |
|----|-------------|
| F-60 | Users can use **bibliographies** within projects. |
| F-61 | A **smart UI** assists with bibliography management (e.g., add/edit entries, search within `.bib`, insert citations, validate keys, surface missing citations from compile output). |

### 3.8 Templates & Macro Collection

| ID | Requirement |
|----|-------------|
| F-70 | Built-in **templating options**, especially for **resumes** and **school homework assignments**. |
| F-71 | Users can browse an **online collection of macros, packages guidance, and templates** (curated catalog; link to or embed well-known public resources where licensing allows). |
| F-72 | Starting a project from a template should be a first-class, guided flow. |
| F-73 | Templates are **packages of files** (not a single `.tex` only): e.g. resume partials, `refs.bib`, section inputs. Creating a project copies the whole package. |
| F-74 | **Add file** offers a list of **common starter files** (bibliography, abstract, section partials, macros, etc.) in addition to a custom path. |
| F-75 | The TeX worker image must include packages required by first-party templates (e.g. `titlesec`, `enumitem`, `geometry`, `hyperref`, `natbib`). |

### 3.9 Author & Editor Tools

| ID | Requirement |
|----|-------------|
| F-80 | Built-in tools for authors and editors, such as: |
| | • converters (e.g., common format helpers where safe and useful) |
| | • calculators / estimators for **page length**, **size**, and **margins** |
| | • configuration helpers for fine-tuning papers (geometry, fonts, spacing guidance) |
| F-81 | Tools should be discoverable but non-intrusive; advanced options available without cluttering the default student path. |

### 3.10 UX & Accessibility

| ID | Requirement |
|----|-------------|
| F-90 | The site must be **intuitive for students and professionals**. |
| F-91 | The site must be **beautiful and responsive** on as many devices as practical (desktop, tablet, phone—with sensible mobile editor/preview layouts). |
| F-92 | Prefer progressive disclosure: simple defaults, advanced controls available. |
| F-93 | Follow accessibility best practices (keyboard navigation, contrast, labels, focus management). |
| F-94 | On-screen hints should explain that users can type freely **or** use toolbar buttons; no LaTeX knowledge required to start. |

### 3.11 Optional AI assist (alpha)

| ID | Requirement |
|----|-------------|
| F-95 | Optional **BYOK / server-configured AI** for single-file edits, multi-file project edits, and compile-error fixes. Users must **review and accept** changes before they are written to the project. |
| F-96 | Long-running AI jobs should show **live progress**: token streaming for single-file LaTeX edits; status messages and character counts for multi-file JSON responses (project edit, fix problems). |
| F-97 | AI traffic is proxied server-side (`api/ai_stream.php` SSE); the browser never calls the provider directly. Connection tests may use a short buffered request (`api/ai_test.php`). |

---

## 4. Security & Privacy Requirements

| ID | Requirement |
|----|-------------|
| S-01 | **Security is important at every aspect** of the application (auth, sessions, uploads, compile sandbox, sharing, APIs, headers, dependencies). |
| S-02 | Documents are **encrypted at rest**. |
| S-03 | Documents are protected **during processing as much as possible** (minimize plaintext lifetime; encrypt on disk between steps; secure temp dirs; wipe intermediates). |
| S-04 | Compile jobs run in a **sandbox** with strict resource limits (CPU, memory, time, disk, network isolation). |
| S-05 | Never execute user content outside the controlled TeX toolchain; validate and limit uploads (type, size, path traversal). |
| S-06 | Enforce authorization on all project/document operations. |
| S-07 | Protect against common web threats: XSS, CSRF, SQLi, SSRF, clickjacking, open redirects, insecure direct object references. |
| S-08 | Use TLS in transit; secure cookies; sensible security headers (CSP, HSTS where applicable, etc.). |
| S-09 | Secrets (OAuth client secret, encryption keys) live in environment/secret storage—never in the repo. |
| S-10 | Audit logging for security-relevant events (login, share changes, export, admin actions) without leaking document contents. |
| S-11 | The application source may be a **public git repository**. **No personal information**, secrets, OAuth credentials, encryption keys, or user document data may live in the repo. |
| S-12 | Runtime config and secrets live **outside the web tree** (e.g. `/etc/siamtex.env`) or in gitignored `data/`. Ship only `.env.example` (placeholders) in git. |
| S-13 | The web server must **deny HTTP access** to `.git/` trees, `.gitignore`, `.gitattributes`, `.gitmodules`, `.env` and variants, `vendor/`, and `data/` under the app. |

### Encryption notes (implementation guidance)

- Prefer envelope encryption: per-project or per-document data keys, wrapped by a server master key (KMS or equivalent when available).
- Encrypt file blobs and sensitive metadata at rest.
- Decrypt only in memory for authorized sessions and compile workers; avoid writing long-lived plaintext.
- Key rotation and recovery procedures should be designed early.

---

## 5. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| N-01 | Responsive UI across modern browsers and device sizes. |
| N-02 | Compile feedback should feel interactive (debounced auto-build or fast manual build; clear in-progress state). |
| N-03 | Graceful degradation when compile services are busy or fail. |
| N-04 | Observability: application logs, compile job metrics, error rates (no document body in logs by default). |
| N-05 | Maintainable codebase and documented deployment. |
| N-06 | Dependency and PHP runtime kept on supported versions. |

---

## 6. Suggested Technical Approach (Best Practices)

These are recommended defaults; adjust during implementation as needed.

| Area | Recommendation |
|------|----------------|
| Backend | PHP (current stable), Composer, thin HTTP API + server-rendered or SPA shell |
| Auth | GitHub OAuth 2.0 / OpenID-style flow via a maintained OAuth library |
| Frontend editor | CodeMirror (LaTeX/stex mode) with a **beginner insert toolbar**; textarea fallback if CM fails to load |
| Metadata DB | SQLite (`data/siamtex.sqlite`, gitignored) for users, projects, memberships, builds |
| PDF preview | PDF.js in a side pane |
| Real-time compile | Debounced save → job queue → worker → encrypted artifact → preview refresh (WebSocket or SSE optional) |
| Optional AI streaming | `api/ai_stream.php` (SSE proxy to provider); requires PHP **curl** extension; web server must not buffer long responses |
| Storage | Local encrypted disk first; abstract the blob layer so S3-compatible storage can be added later |
| Compile | **Dockerized TeX worker** (see §6.1), no outbound network, timeouts and ulimits |
| Templates catalog | First-party curated templates only in v1 (resume, homework, article) |
| Testing | Unit tests for authz/crypto/log parsing; integration tests for project CRUD and compile happy-path |
| Distribution | `docker compose` (app + db + tex-worker) so anyone can install with one command |

### 6.1 TeX compile worker (containerized)

LaTeX and bibliography tools **must not** be installed ad hoc on the host. They run in a versioned container image so:

- Anyone can install SiamTeX with Docker Compose.
- The host OS stays clean; upgrades are image pulls.
- Compile jobs are sandboxed (read-only rootfs, no network, memory/CPU/time limits, non-root user).

**Guaranteed toolchain (standard profile):**

- Engines: `pdflatex`, `xelatex`, `lualatex`
- Bibliography: `bibtex`, `biber`
- Build driver: `latexmk`
- Package set: TeX Live **scheme-medium** (or equivalent custom image) — not full scheme unless disk allows

**Compose services (target layout):**

| Service | Role |
|---------|------|
| `web` | PHP app (nginx/php-fpm or similar) |
| `db` | Metadata / permissions (e.g. MariaDB or PostgreSQL) |
| `tex-worker` | Ephemeral or long-lived worker that runs compile jobs against a mounted work dir |

PHP enqueues a job; the worker decrypts into a tmpfs/work volume, runs `latexmk`, returns PDF + log + structured diagnostics, then wipes plaintext.

### 6.2 Host resource guidance

| Profile | vCPU | RAM | Disk | Notes |
|---------|------|-----|------|--------|
| Minimum (dev / light solo use) | 2 | 2 GB | 40 GB | Tight; one compile at a time |
| **Recommended (small production)** | 2 | **4 GB** | **50–80 GB** | Comfortable for Docker + PHP + TeX medium image + a few concurrent compiles |
| Comfortable | 4 | 8 GB | 100 GB+ | Multiple users / larger projects |

TeX Live medium images are typically **~1.5–3 GB** on disk; a single compile can spike **hundreds of MB of RAM**. Do not co-locate heavy agents and many PHP apps on a 1 GB droplet with TeX.

---

## 7. Primary User Flows

1. **Sign in with GitHub** → land on project dashboard.  
2. **Create project** from blank or template (resume / homework / article).  
3. **Edit** main and auxiliary files with syntax highlighting.  
4. **Auto or manual compile** → PDF updates side-by-side; diagnostics appear in editor and problems panel.  
5. **Manage bibliography** via smart UI; insert citations.  
6. **Import** files or **export** project archive.  
7. **Share** project with another user or link (permissioned).  
8. Use **author tools** (margins, page estimates, converters) as needed.  
9. Browse **templates / macros catalog** to extend the project.

---

## 8. UI Structure (Indicative)

- **Dashboard:** projects, templates, recent activity.  
- **Project workspace:** file tree | editor | PDF preview; problems panel + build log drawer.  
- **Share / export** modals.  
- **Bibliography** panel.  
- **Tools** panel (geometry, estimators, converters).  
- **Catalog** (templates, macros, snippets).  
- Responsive: on small screens, tabbed editor/preview rather than forced side-by-side.

---

## 9. Phased Delivery (Recommended)

### Phase 1 — Core IDE

- GitHub auth, projects, multi-file editor, Dockerized compile, PDF preview, build log, basic error parsing, encryption at rest (local disk).
- Share-with-roles only (no live co-editing); design data model so co-editing can land later.

### Phase 2 — Collaboration & Portability

- Sharing/permissions polish, import/export, first-party templates (resume + homework + article).

### Phase 3 — Smart Authoring

- Bibliography UI, richer diagnostics, author/editor tools, expanded first-party catalog.

### Phase 4 — Hardening & Polish

- Optional S3-compatible storage backend, performance, accessibility, mobile polish, security review, operational runbooks.
- Real-time co-editing (if still desired).

---

## 10. Success Criteria

- A student can sign in with GitHub, start from a homework template, write TeX, see PDF and actionable errors, and export the project—without reading a manual.  
- A professional can manage a multi-file paper with bibliography, tune layout tools, and share securely.  
- Documents remain encrypted at rest; compile runs sandboxed; unauthorized access is denied.  
- UI is responsive and polished across common devices.
- A new operator can install the stack with Docker Compose on a machine meeting §6.2.

---

## 11. Decisions (resolved)

| Topic | Decision |
|-------|----------|
| Collaboration (v1) | **Share with roles only**; design for co-editing later, ship sharing-first. |
| TeX engines | **Standard:** `pdflatex`, `xelatex`, `lualatex` + BibTeX and Biber (`latexmk`). |
| Storage (v1) | **Local encrypted disk now**; abstract blob layer for **S3-compatible later**. |
| Retention | **Soft-delete projects 30 days**, then purge; **build artifacts ~7 days** (latest PDF retained while project is active). |
| Catalog (v1) | **First-party curated templates only** (resume, homework, article). |
| TeX install model | **Containerized worker** via Docker Compose — not bare-metal TeX on the host. |
| Public repository | Source may be public; secrets and `data/` never committed; Apache blocks `.git` / `.env` / `.gitignore` over HTTP. |
| Beginner toolbar | Insert buttons for text, structure, math, resume snippets; selection-aware wrap. |

---

## 12. Requirement Traceability (User List)

| # | User requirement | Spec IDs |
|---|------------------|----------|
| 1 | PHP backend website | F-01, F-04, F-05 |
| 2 | Write and render LaTeX | F-02, F-20–F-34 |
| 3 | Rebuild of SiamTeX (~2004) | F-03 |
| 4 | Sign-in via GitHub auth | F-10–F-13 |
| 5 | Rich/syntax-highlighted editor; compile errors | F-20–F-23, F-33 |
| 6 | Share documents | F-50–F-52 |
| 7 | Side-by-side PDF, real time | F-30–F-31 |
| 8 | Bibliographies + smart UI | F-60–F-61 |
| 9 | Extra TeX files per project | F-40, F-43 |
| 10 | Online macros/templates collection | F-71–F-72 |
| 11 | Build logs | F-32 |
| 12 | Smart error bubbling into UI | F-22, F-33 |
| 13 | Import files into project | F-41 |
| 14 | Export and share projects | F-42, F-50 |
| 15 | Templating (resumes, homework) | F-70, F-72 |
| 16 | Intuitive for students & professionals | F-90, F-92 |
| 17 | Encryption at rest and in processing | S-02, S-03 |
| 18 | Author/editor tools (converters, estimators, margins) | F-80–F-81 |
| 19 | Security throughout | S-01–S-10 |
| 20 | Beautiful, responsive UI | F-91, N-01 |
| 21 | Best judgment & current best practices | §6, F-04–F-05, N-05–N-06 |

---

*Document version: 1.2 — multi-file template packages, common-file picker, TeX package set for templates.*
