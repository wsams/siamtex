<?php

declare(strict_types=1);

namespace SiamTeX;

use RuntimeException;
use ZipArchive;

final class ProjectService
{
    private ?HistoryService $history = null;

    public function __construct(private Store $store)
    {
    }

    private function history(): HistoryService
    {
        return $this->history ??= new HistoryService($this->store);
    }

    public function roleFor(array $user, string $projectId): ?string
    {
        $st = $this->store->pdo()->prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL');
        $st->execute([$projectId]);
        $p = $st->fetch();
        if (!$p) {
            return null;
        }
        if ((int) $p['owner_id'] === (int) $user['id']) {
            return 'owner';
        }
        $m = $this->store->pdo()->prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?');
        $m->execute([$projectId, $user['id']]);
        $row = $m->fetch();
        return $row ? (string) $row['role'] : null;
    }

    public function requireRole(array $user, string $projectId, array $allowed): array
    {
        $project = $this->getProject($projectId);
        if (!$project) {
            throw new RuntimeException('Project not found.');
        }
        $role = $this->roleFor($user, $projectId);
        if ($role === null || !in_array($role, $allowed, true)) {
            // Share-token access is handled separately by callers when needed.
            throw new RuntimeException('Access denied.');
        }
        $project['_role'] = $role;
        return $project;
    }

    public function getProject(string $id): ?array
    {
        $st = $this->store->pdo()->prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL');
        $st->execute([$id]);
        $row = $st->fetch();
        return $row ?: null;
    }

    public function listProjects(array $user): array
    {
        $st = $this->store->pdo()->prepare(<<<'SQL'
SELECT p.*, 'owner' AS role FROM projects p
WHERE p.owner_id = ? AND p.deleted_at IS NULL
UNION
SELECT p.*, m.role AS role FROM projects p
JOIN project_members m ON m.project_id = p.id
WHERE m.user_id = ? AND p.deleted_at IS NULL
ORDER BY updated_at DESC
SQL);
        $st->execute([$user['id'], $user['id']]);
        return array_map(fn ($r) => $this->publicProject($r), $st->fetchAll());
    }

    public function publicProject(array $p): array
    {
        return [
            'id' => $p['id'],
            'name' => $p['name'],
            'mainFile' => $p['main_file'],
            'engine' => $p['engine'],
            'role' => $p['role'] ?? $p['_role'] ?? null,
            'shareToken' => !empty($p['share_token']) ? $p['share_token'] : null,
            'shareRole' => $p['share_role'] ?? null,
            'createdAt' => $p['created_at'],
            'updatedAt' => $p['updated_at'],
            'hasPdf' => $this->hasPdf($p['id'], (string) $p['main_file']),
            'pdfEntries' => $this->listPdfEntries($p['id']),
        ];
    }

    /** Top-level .tex files that can be compiled as standalone documents. */
    public static function isCompileEntry(string $path): bool
    {
        return preg_match('/\.tex$/i', $path) === 1 && !str_contains($path, '/');
    }

    public function pdfPath(string $id, string $texPath): string
    {
        $dir = $this->projectDir($id) . '/pdfs';
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        return $dir . '/' . $this->pdfStorageKey($texPath) . '.pdf.enc';
    }

    private function pdfStorageKey(string $texPath): string
    {
        return rawurlencode(str_replace('\\', '/', $this->safePath($texPath)));
    }

    /** @return list<string> */
    public function listPdfEntries(string $projectId): array
    {
        $out = [];
        $dir = $this->projectDir($projectId) . '/pdfs';
        if (is_dir($dir)) {
            foreach (scandir($dir) ?: [] as $name) {
                if (!str_ends_with($name, '.pdf.enc')) {
                    continue;
                }
                $key = substr($name, 0, -strlen('.pdf.enc'));
                $path = rawurldecode($key);
                if ($path !== '') {
                    $out[] = $path;
                }
            }
        }
        $legacy = $this->projectDir($projectId) . '/output.pdf.enc';
        if (is_file($legacy)) {
            $project = $this->getProject($projectId);
            $main = (string) ($project['main_file'] ?? 'main.tex');
            if (!in_array($main, $out, true)) {
                $out[] = $main;
            }
        }
        sort($out);
        return $out;
    }

    public function hasPdf(string $projectId, string $texPath): bool
    {
        if (is_file($this->pdfPath($projectId, $texPath))) {
            return true;
        }
        $project = $this->getProject($projectId);
        $main = (string) ($project['main_file'] ?? 'main.tex');
        if ($texPath === $main && is_file($this->projectDir($projectId) . '/output.pdf.enc')) {
            return true;
        }
        return false;
    }

    public function resolveCompileEntry(array $project, ?string $requested): string
    {
        $main = (string) $project['main_file'];
        $requested = $requested !== null && $requested !== '' ? $this->safePath($requested) : '';
        if ($requested !== '' && self::isCompileEntry($requested)) {
            $paths = array_column($this->listFiles((string) $project['id']), 'path');
            if (in_array($requested, $paths, true)) {
                return $requested;
            }
        }
        return $main;
    }

    public function create(array $user, string $name, string $templateId = 'blank', string $engine = 'pdflatex'): array
    {
        $manifest = Templates::manifest($templateId);
        $main = (string) ($manifest['mainFile'] ?? 'main.tex');
        if ($engine === '' || $engine === 'pdflatex') {
            $engine = (string) ($manifest['engine'] ?? 'pdflatex');
        }
        if (!in_array($engine, ['pdflatex', 'xelatex', 'lualatex'], true)) {
            $engine = 'pdflatex';
        }

        $id = Store::newId();
        $now = Store::now();
        $key = Crypto::generateProjectKey();
        $wrapped = Crypto::wrapProjectKey($key);
        $st = $this->store->pdo()->prepare('INSERT INTO projects (id, owner_id, name, main_file, engine, wrapped_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
        $st->execute([$id, $user['id'], $name, $main, $engine, $wrapped, $now, $now]);

        $dir = $this->projectDir($id);
        mkdir($dir . '/files', 0770, true);

        // Template packages may include many files (partials, .bib, etc.).
        $files = Templates::filesFor($templateId);
        foreach ($files as $path => $content) {
            $this->writeFileRaw($id, $key, $path, $content);
            $project = $this->getProject($id);
            if ($project !== null) {
                $this->history()->seedInitial($project, $path, $key, $content);
            }
        }
        return $this->publicProject($this->getProject($id) + ['_role' => 'owner']);
    }

    /**
     * @param array<string, string> $files
     */
    public function createFromAiFiles(array $user, string $name, string $mainFile, string $engine, array $files): array
    {
        $project = $this->create($user, $name, 'blank', $engine);
        $id = (string) $project['id'];
        $mainFile = $this->safePath($mainFile);
        if ($mainFile !== (string) $project['mainFile'] || $engine !== (string) $project['engine']) {
            $project = $this->updateMeta($user, $id, [
                'mainFile' => $mainFile,
                'engine' => $engine,
                'name' => $name,
            ]);
        }
        foreach ($files as $path => $content) {
            $this->writeFile($user, $id, $this->safePath((string) $path), (string) $content, 'ai');
        }
        return $project;
    }

    public function updateMeta(array $user, string $projectId, array $patch): array
    {
        $p = $this->requireRole($user, $projectId, ['owner', 'edit']);
        $name = array_key_exists('name', $patch) ? trim((string) $patch['name']) : $p['name'];
        $main = array_key_exists('mainFile', $patch) ? $this->safePath((string) $patch['mainFile']) : $p['main_file'];
        $engine = array_key_exists('engine', $patch) ? (string) $patch['engine'] : $p['engine'];
        if (!in_array($engine, ['pdflatex', 'xelatex', 'lualatex'], true)) {
            throw new RuntimeException('Invalid engine.');
        }
        if ($name === '') {
            throw new RuntimeException('Name required.');
        }
        $st = $this->store->pdo()->prepare('UPDATE projects SET name=?, main_file=?, engine=?, updated_at=? WHERE id=?');
        $st->execute([$name, $main, $engine, Store::now(), $projectId]);
        return $this->publicProject($this->getProject($projectId) + ['_role' => $p['_role']]);
    }

    public function softDelete(array $user, string $projectId): void
    {
        $this->requireRole($user, $projectId, ['owner']);
        $st = $this->store->pdo()->prepare('UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?');
        $st->execute([Store::now(), Store::now(), $projectId]);
    }

    public function projectKey(array $project): string
    {
        return Crypto::unwrapProjectKey($project['wrapped_key']);
    }

    public function projectDir(string $id): string
    {
        return Config::projectsDir() . '/' . $id;
    }

    public function listFiles(string $projectId): array
    {
        $st = $this->store->pdo()->prepare('SELECT path, size, updated_at FROM project_files WHERE project_id = ? ORDER BY path');
        $st->execute([$projectId]);
        return array_map(static fn ($r) => [
            'path' => $r['path'],
            'size' => (int) $r['size'],
            'updatedAt' => $r['updated_at'],
            'binary' => self::isBinaryPath($r['path']),
        ], $st->fetchAll());
    }

    /** Extensions opened as binary assets (not in the text editor). */
    public static function binaryExtensions(): array
    {
        return [
            // Images / figures
            'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'svgz',
            // Documents / vector
            'pdf', 'eps', 'ps', 'ai',
            // Fonts (fontspec / xe/lualatex)
            'otf', 'ttf', 'ttc', 'woff', 'woff2', 'pfb', 'pfm', 'afm',
            // TeX font metrics / bitmaps
            'tfm', 'vf', 'pk', 'gf', 'mf', 'map', 'enc',
        ];
    }

    /** Safe text-ish extensions editable in the IDE. */
    public static function textExtensions(): array
    {
        return [
            // Core TeX / LaTeX sources
            'tex', 'ltx', 'sty', 'cls', 'clo', 'dtx', 'ins', 'fd', 'def', 'cfg',
            // Bibliography
            'bib', 'bst', 'bbx', 'cbx', 'lbx', 'dbx',
            // Plain / data / config often used in projects
            'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'svg',
            // LuaTeX / scripts / build helpers
            'lua', 'lualatex', 'mkiv', 'latexmkrc',
            // Misc TeX ecosystem
            'lco', 'ldf', 'uxf', 'asy', 'mp', 'rtex',
        ];
    }

    public static function isBinaryPath(string $path): bool
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        return $ext !== '' && in_array($ext, self::binaryExtensions(), true);
    }

    public static function isAllowedUploadPath(string $path): bool
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if ($ext === '') {
            // Allow extensionless files like latexmkrc when named exactly.
            $base = strtolower(basename($path));
            return in_array($base, ['latexmkrc', 'makefile', 'readme'], true);
        }
        return in_array($ext, self::textExtensions(), true)
            || in_array($ext, self::binaryExtensions(), true);
    }

    public static function allowedUploadAcceptList(): string
    {
        $exts = array_merge(self::textExtensions(), self::binaryExtensions());
        sort($exts);
        return implode(',', array_map(static fn ($e) => '.' . $e, $exts));
    }

    public function readFile(array $project, string $path): string
    {
        $path = $this->safePath($path);
        $encPath = $this->encFilePath($project['id'], $path);
        if (!is_file($encPath)) {
            throw new RuntimeException('File not found.');
        }
        $key = $this->projectKey($project);
        return Crypto::decrypt($key, (string) file_get_contents($encPath));
    }

    public function writeFile(
        array $user,
        string $projectId,
        string $path,
        string $content,
        string $source = 'save',
        ?string $label = null,
        bool $recordHistory = true,
    ): array {
        $project = $this->requireRole($user, $projectId, ['owner', 'edit']);
        $path = $this->safePath($path);
        if (strlen($content) > Config::maxUploadBytes()) {
            throw new RuntimeException('File too large (max ' . Config::maxUploadBytes() . ' bytes).');
        }
        $key = $this->projectKey($project);
        $oldContent = null;
        if (!self::isBinaryPath($path)) {
            $encPath = $this->encFilePath($projectId, $path);
            if (is_file($encPath)) {
                $oldContent = Crypto::decrypt($key, (string) file_get_contents($encPath));
            }
        }
        $this->writeFileRaw($projectId, $key, $path, $content);
        if ($recordHistory && !self::isBinaryPath($path)) {
            $this->history()->recordChange(
                $project,
                $path,
                $key,
                $content,
                (int) $user['id'],
                $source,
                $label,
                $oldContent,
            );
        }
        $this->touchProject($projectId);
        return [
            'path' => $path,
            'size' => strlen($content),
            'binary' => self::isBinaryPath($path),
        ];
    }

    public function restoreFileRevision(array $user, string $projectId, string $path, int $revisionId): array
    {
        $project = $this->requireRole($user, $projectId, ['owner', 'edit']);
        $path = $this->safePath($path);
        if (self::isBinaryPath($path)) {
            throw new RuntimeException('History is not available for binary files.');
        }
        $key = $this->projectKey($project);
        $result = $this->history()->restore(
            $project,
            $path,
            $key,
            $revisionId,
            (int) $user['id'],
            function (string $content) use ($projectId, $key, $path): void {
                $this->writeFileRaw($projectId, $key, $path, $content);
                $this->touchProject($projectId);
            },
        );
        return [
            'path' => $path,
            'size' => strlen($result['content']),
            'revisionId' => $result['revisionId'],
            'label' => $result['label'],
            'content' => $result['content'],
        ];
    }

    public function historyService(): HistoryService
    {
        return $this->history();
    }

    /**
     * @param array{name:string,type?:string,tmp_name:string,error:int,size:int} $upload
     */
    public function writeUploadedFile(array $user, string $projectId, array $upload, ?string $path = null): array
    {
        $err = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err !== UPLOAD_ERR_OK) {
            throw new RuntimeException(self::uploadErrorMessage($err));
        }
        $size = (int) ($upload['size'] ?? 0);
        if ($size <= 0) {
            throw new RuntimeException('Empty upload.');
        }
        if ($size > Config::maxUploadBytes()) {
            throw new RuntimeException('File too large (max ' . Config::maxUploadBytes() . ' bytes).');
        }
        $name = (string) ($upload['name'] ?? 'upload.bin');
        $path = $path !== null && trim($path) !== '' ? $path : $name;
        $path = $this->safePath($path);
        if (!self::isAllowedUploadPath($path)) {
            throw new RuntimeException(
                'File type not allowed. Upload TeX sources (.tex/.sty/.cls), bibliographies (.bib), '
                . 'images, fonts (.otf/.ttf), PDF/EPS, or other common project assets.'
            );
        }
        $tmp = (string) ($upload['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            throw new RuntimeException('Invalid upload.');
        }
        $content = file_get_contents($tmp);
        if ($content === false) {
            throw new RuntimeException('Could not read upload.');
        }
        return $this->writeFile($user, $projectId, $path, $content);
    }

    public function deleteFile(array $user, string $projectId, string $path): void
    {
        $project = $this->requireRole($user, $projectId, ['owner', 'edit']);
        $path = $this->safePath($path);
        if ($path === $project['main_file']) {
            throw new RuntimeException('Cannot delete the main file.');
        }
        $encPath = $this->encFilePath($projectId, $path);
        if (is_file($encPath)) {
            unlink($encPath);
        }
        $this->history()->deleteFileHistory($projectId, $path);
        $st = $this->store->pdo()->prepare('DELETE FROM project_files WHERE project_id = ? AND path = ?');
        $st->execute([$projectId, $path]);
        $this->touchProject($projectId);
    }

    private function writeFileRaw(string $projectId, string $key, string $path, string $content): void
    {
        $encPath = $this->encFilePath($projectId, $path);
        $dir = dirname($encPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        file_put_contents($encPath, Crypto::encrypt($key, $content));
        chmod($encPath, 0660);
        $st = $this->store->pdo()->prepare('INSERT INTO project_files (project_id, path, size, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(project_id, path) DO UPDATE SET size=excluded.size, updated_at=excluded.updated_at');
        $st->execute([$projectId, $path, strlen($content), Store::now()]);
    }

    private function encFilePath(string $projectId, string $path): string
    {
        return $this->projectDir($projectId) . '/files/' . $path . '.enc';
    }

    public function touchProject(string $projectId): void
    {
        $st = $this->store->pdo()->prepare('UPDATE projects SET updated_at=? WHERE id=?');
        $st->execute([Store::now(), $projectId]);
    }

    /**
     * Normalize a project-relative path for storage and TeX.
     * Spaces and other awkward characters become underscores (LaTeX-friendly).
     */
    public static function uploadErrorMessage(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE => 'File exceeds server upload limit (PHP upload_max_filesize).',
            UPLOAD_ERR_FORM_SIZE => 'File exceeds the form upload limit.',
            UPLOAD_ERR_PARTIAL => 'Upload was interrupted — try again.',
            UPLOAD_ERR_NO_FILE => 'No file was received.',
            UPLOAD_ERR_NO_TMP_DIR => 'Server upload temp directory is missing.',
            UPLOAD_ERR_CANT_WRITE => 'Server could not write the upload to disk.',
            UPLOAD_ERR_EXTENSION => 'A server extension blocked this upload.',
            default => 'Upload failed (code ' . $code . ').',
        };
    }

    public function safePath(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        $path = str_replace("\0", '', $path);
        $path = ltrim($path, '/');
        if ($path === '' || str_contains($path, '..')) {
            throw new RuntimeException('Invalid path.');
        }

        $parts = explode('/', $path);
        $clean = [];
        foreach ($parts as $part) {
            if ($part === '' || $part === '.' || $part === '..') {
                throw new RuntimeException('Invalid path.');
            }
            // Unicode/odd spaces → underscore, then strip anything unsafe
            $part = preg_replace('/\s+/u', '_', $part) ?? $part;
            $part = preg_replace('/[^A-Za-z0-9._-]+/', '_', $part) ?? $part;
            $part = preg_replace('/_+/', '_', $part) ?? $part;
            $part = preg_replace('/_+(\.[A-Za-z0-9]+)$/', '$1', $part) ?? $part;
            $part = trim($part, '._');
            if ($part === '' || $part === '.' || $part === '..') {
                throw new RuntimeException('Invalid file name.');
            }
            if (!preg_match('/^[A-Za-z0-9._-]+$/', $part)) {
                throw new RuntimeException('Invalid file name.');
            }
            $clean[] = $part;
        }

        return implode('/', $clean);
    }

    public function materialize(array $project, string $destDir): void
    {
        $key = $this->projectKey($project);
        foreach ($this->listFiles($project['id']) as $f) {
            $path = $f['path'];
            $content = Crypto::decrypt($key, (string) file_get_contents($this->encFilePath($project['id'], $path)));
            $out = $destDir . '/' . $path;
            $dir = dirname($out);
            if (!is_dir($dir)) {
                mkdir($dir, 0770, true);
            }
            file_put_contents($out, $content);
        }
    }

    public function storePdf(array $project, string $pdfBytes, string $texPath): void
    {
        $key = $this->projectKey($project);
        $path = $this->pdfPath((string) $project['id'], $texPath);
        file_put_contents($path, Crypto::encrypt($key, $pdfBytes));
        chmod($path, 0660);
    }

    public function readPdf(array $project, string $texPath): ?string
    {
        $id = (string) $project['id'];
        $path = $this->pdfPath($id, $texPath);
        if (is_file($path)) {
            return Crypto::decrypt($this->projectKey($project), (string) file_get_contents($path));
        }
        $main = (string) ($project['main_file'] ?? 'main.tex');
        if ($texPath === $main) {
            $legacy = $this->projectDir($id) . '/output.pdf.enc';
            if (is_file($legacy)) {
                return Crypto::decrypt($this->projectKey($project), (string) file_get_contents($legacy));
            }
        }
        return null;
    }

    public function enableShare(array $user, string $projectId, string $role = 'view'): array
    {
        $this->requireRole($user, $projectId, ['owner']);
        if (!in_array($role, ['view', 'edit'], true)) {
            throw new RuntimeException('Invalid share role.');
        }
        $token = bin2hex(random_bytes(16));
        $st = $this->store->pdo()->prepare('UPDATE projects SET share_token=?, share_role=?, updated_at=? WHERE id=?');
        $st->execute([$token, $role, Store::now(), $projectId]);
        return $this->publicProject($this->getProject($projectId) + ['_role' => 'owner']);
    }

    public function disableShare(array $user, string $projectId): array
    {
        $this->requireRole($user, $projectId, ['owner']);
        $st = $this->store->pdo()->prepare('UPDATE projects SET share_token=NULL, share_role=NULL, updated_at=? WHERE id=?');
        $st->execute([Store::now(), $projectId]);
        return $this->publicProject($this->getProject($projectId) + ['_role' => 'owner']);
    }

    public function projectByShareToken(string $token): ?array
    {
        $st = $this->store->pdo()->prepare('SELECT * FROM projects WHERE share_token = ? AND deleted_at IS NULL');
        $st->execute([$token]);
        $row = $st->fetch();
        return $row ?: null;
    }

    public function exportZip(array $project): string
    {
        $tmp = Config::tmpDir() . '/export-' . $project['id'] . '-' . bin2hex(random_bytes(4)) . '.zip';
        $zip = new ZipArchive();
        if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not create export.');
        }
        $key = $this->projectKey($project);
        foreach ($this->listFiles($project['id']) as $f) {
            $content = Crypto::decrypt($key, (string) file_get_contents($this->encFilePath($project['id'], $f['path'])));
            $zip->addFromString($f['path'], $content);
        }
        $zip->close();
        return $tmp;
    }

    public function importZip(array $user, string $name, string $zipPath): array
    {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new RuntimeException('Invalid zip archive.');
        }
        $project = $this->create($user, $name, 'blank');
        $full = $this->getProject($project['id']);
        $key = $this->projectKey($full);
        // Remove default main if zip has files
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            $path = $stat['name'] ?? '';
            if ($path === '' || str_ends_with($path, '/')) {
                continue;
            }
            $path = $this->safePath($path);
            $content = $zip->getFromIndex($i);
            if ($content === false) {
                continue;
            }
            if (strlen($content) > Config::maxUploadBytes()) {
                continue;
            }
            $this->writeFileRaw($project['id'], $key, $path, $content);
        }
        $zip->close();
        // Prefer main.tex if present
        $files = $this->listFiles($project['id']);
        $paths = array_column($files, 'path');
        $main = in_array('main.tex', $paths, true) ? 'main.tex' : ($paths[0] ?? 'main.tex');
        $st = $this->store->pdo()->prepare('UPDATE projects SET main_file=?, updated_at=? WHERE id=?');
        $st->execute([$main, Store::now(), $project['id']]);
        return $this->publicProject($this->getProject($project['id']) + ['_role' => 'owner']);
    }

    public function saveBuild(
        string $projectId,
        string $entryFile,
        string $status,
        string $engine,
        ?int $exitCode,
        int $durationMs,
        string $log,
        array $diagnostics,
    ): int {
        $st = $this->store->pdo()->prepare(
            'INSERT INTO builds (project_id, entry_file, status, engine, exit_code, duration_ms, log_text, diagnostics_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
        );
        $st->execute([
            $projectId,
            $entryFile,
            $status,
            $engine,
            $exitCode,
            $durationMs,
            $log,
            json_encode($diagnostics, JSON_THROW_ON_ERROR),
            Store::now(),
        ]);
        return (int) $this->store->pdo()->lastInsertId();
    }

    public function latestBuild(string $projectId, ?string $entryFile = null): ?array
    {
        if ($entryFile !== null && $entryFile !== '') {
            $main = (string) ($this->getProject($projectId)['main_file'] ?? 'main.tex');
            $st = $this->store->pdo()->prepare(
                'SELECT * FROM builds WHERE project_id = ? AND COALESCE(NULLIF(entry_file, \'\'), ?) = ? ORDER BY id DESC LIMIT 1'
            );
            $st->execute([$projectId, $main, $entryFile]);
        } else {
            $st = $this->store->pdo()->prepare('SELECT * FROM builds WHERE project_id = ? ORDER BY id DESC LIMIT 1');
            $st->execute([$projectId]);
        }
        $row = $st->fetch();
        if (!$row) {
            return null;
        }
        return $this->rowToBuild($row, $projectId);
    }

    /** @return array<string, array> */
    public function latestBuildsByEntry(string $projectId): array
    {
        $main = (string) ($this->getProject($projectId)['main_file'] ?? 'main.tex');
        $st = $this->store->pdo()->prepare(
            'SELECT b.* FROM builds b
             INNER JOIN (
               SELECT COALESCE(NULLIF(entry_file, \'\'), ?) AS ef, MAX(id) AS max_id
               FROM builds WHERE project_id = ? GROUP BY ef
             ) latest ON b.id = latest.max_id'
        );
        $st->execute([$main, $projectId]);
        $out = [];
        foreach ($st->fetchAll() as $row) {
            $entry = (string) ($row['entry_file'] ?? '');
            if ($entry === '') {
                $entry = $main;
            }
            $out[$entry] = $this->rowToBuild($row, $projectId);
        }
        return $out;
    }

    /** @param array<string, mixed> $row */
    private function rowToBuild(array $row, ?string $projectId = null): array
    {
        $entry = (string) ($row['entry_file'] ?? '');
        if ($entry === '' && $projectId !== null) {
            $entry = (string) ($this->getProject($projectId)['main_file'] ?? 'main.tex');
        }
        return [
            'id' => (int) $row['id'],
            'entry' => $entry,
            'status' => $row['status'],
            'engine' => $row['engine'],
            'exitCode' => $row['exit_code'] !== null ? (int) $row['exit_code'] : null,
            'durationMs' => $row['duration_ms'] !== null ? (int) $row['duration_ms'] : null,
            'log' => $row['log_text'],
            'diagnostics' => json_decode((string) $row['diagnostics_json'], true) ?: [],
            'createdAt' => $row['created_at'],
        ];
    }
}
