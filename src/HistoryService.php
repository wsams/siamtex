<?php

declare(strict_types=1);

namespace SiamTeX;

use RuntimeException;

/** Encrypted per-file revision tree (Vim-style branching undo). */
final class HistoryService
{
    public function __construct(private Store $store)
    {
    }

    public function recordChange(
        array $project,
        string $path,
        string $projectKey,
        string $newContent,
        ?int $userId,
        string $source = 'save',
        ?string $label = null,
        ?string $oldContent = null,
    ): ?int {
        $projectId = (string) $project['id'];
        $path = $this->normalizePath($path);
        if (ProjectService::isBinaryPath($path)) {
            return null;
        }

        $headId = $this->headId($projectId, $path);
        if ($headId !== null) {
            $headContent = $this->readRevisionBlob($projectKey, $headId);
            if ($headContent === $newContent) {
                return $headId;
            }
        }

        $parentId = $headId;
        if ($headId === null && $oldContent !== null && $oldContent !== $newContent) {
            $parentId = $this->insertRevision(
                $projectId,
                $path,
                $projectKey,
                $oldContent,
                null,
                'initial',
                null,
                $userId,
            );
        }

        $revisionId = $this->insertRevision(
            $projectId,
            $path,
            $projectKey,
            $newContent,
            $parentId,
            $source,
            $label,
            $userId,
        );
        $this->setHead($projectId, $path, $revisionId);
        $this->prune($projectId, $path);
        return $revisionId;
    }

    public function seedInitial(array $project, string $path, string $projectKey, string $content): void
    {
        $projectId = (string) $project['id'];
        $path = $this->normalizePath($path);
        if (ProjectService::isBinaryPath($path) || $this->headId($projectId, $path) !== null) {
            return;
        }
        $revisionId = $this->insertRevision(
            $projectId,
            $path,
            $projectKey,
            $content,
            null,
            'initial',
            'Created',
            null,
        );
        $this->setHead($projectId, $path, $revisionId);
    }

    public function restore(
        array $project,
        string $path,
        string $projectKey,
        int $revisionId,
        ?int $userId,
        callable $writeLive,
    ): array {
        $projectId = (string) $project['id'];
        $path = $this->normalizePath($path);
        $rev = $this->requireRevision($projectId, $path, $revisionId);
        $content = $this->readRevisionBlob($projectKey, $revisionId);
        $writeLive($content);

        $label = 'Restored from ' . self::formatRevisionLabel($rev);
        $newId = $this->insertRevision(
            $projectId,
            $path,
            $projectKey,
            $content,
            $revisionId,
            'restore',
            $label,
            $userId,
        );
        $this->setHead($projectId, $path, $newId);
        $this->prune($projectId, $path);
        return [
            'revisionId' => $newId,
            'content' => $content,
            'label' => $label,
        ];
    }

    /** @return list<array<string,mixed>> */
    public function listRevisions(string $projectId, string $path): array
    {
        $path = $this->normalizePath($path);
        $headId = $this->headId($projectId, $path);
        $st = $this->store->pdo()->prepare(
            'SELECT id, parent_id, source, label, size, user_id, created_at
             FROM file_revisions
             WHERE project_id = ? AND path = ?
             ORDER BY created_at ASC, id ASC'
        );
        $st->execute([$projectId, $path]);
        $rows = $st->fetchAll();
        $byId = [];
        foreach ($rows as $row) {
            $byId[(int) $row['id']] = $row;
        }
        $depths = [];
        $computeDepth = function (int $id) use (&$computeDepth, &$byId, &$depths): int {
            if (isset($depths[$id])) {
                return $depths[$id];
            }
            $row = $byId[$id] ?? null;
            if ($row === null) {
                return 0;
            }
            $parent = $row['parent_id'] !== null ? (int) $row['parent_id'] : null;
            $depths[$id] = $parent === null ? 0 : $computeDepth($parent) + 1;
            return $depths[$id];
        };
        foreach (array_keys($byId) as $id) {
            $computeDepth($id);
        }

        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row['id'];
            $out[] = [
                'id' => $id,
                'parentId' => $row['parent_id'] !== null ? (int) $row['parent_id'] : null,
                'source' => (string) $row['source'],
                'label' => $row['label'] !== null ? (string) $row['label'] : null,
                'size' => (int) $row['size'],
                'createdAt' => (string) $row['created_at'],
                'isHead' => $headId === $id,
                'depth' => $depths[$id] ?? 0,
                'display' => self::formatRevisionLabel($row),
            ];
        }
        return $out;
    }

    public function readRevisionContent(array $project, string $projectKey, int $revisionId): string
    {
        $projectId = (string) $project['id'];
        $this->requireRevisionById($projectId, $revisionId);
        return $this->readRevisionBlob($projectKey, $revisionId);
    }

    /**
     * @return array{from:array<string,mixed>,to:array<string,mixed>,unified:string,hunks:list<array{type:string,line:int|null,text:string}>}
     */
    public function diff(
        array $project,
        string $projectKey,
        string $path,
        int $fromRevisionId,
        int|string $toRevisionId,
        ?string $liveContent = null,
    ): array {
        $projectId = (string) $project['id'];
        $path = $this->normalizePath($path);
        $fromRev = $this->requireRevision($projectId, $path, $fromRevisionId);
        $fromText = $this->readRevisionBlob($projectKey, $fromRevisionId);
        $fromMeta = self::publicRevision($fromRev, false);

        if ($toRevisionId === 'current' || $toRevisionId === 'live') {
            if ($liveContent === null) {
                throw new RuntimeException('Live content required for current diff.');
            }
            $toText = $liveContent;
            $toMeta = [
                'id' => 'current',
                'display' => 'Current editor',
                'source' => 'current',
                'createdAt' => Store::now(),
            ];
        } else {
            $toId = (int) $toRevisionId;
            $toRev = $this->requireRevision($projectId, $path, $toId);
            $toText = $this->readRevisionBlob($projectKey, $toId);
            $toMeta = self::publicRevision($toRev, $toId === $this->headId($projectId, $path));
        }

        return [
            'from' => $fromMeta,
            'to' => $toMeta,
            'unified' => LineDiff::unified($fromText, $toText, $fromMeta['display'], $toMeta['display']),
            'hunks' => LineDiff::hunks($fromText, $toText),
        ];
    }

    public function deleteFileHistory(string $projectId, string $path): void
    {
        $path = $this->normalizePath($path);
        $st = $this->store->pdo()->prepare('SELECT id FROM file_revisions WHERE project_id = ? AND path = ?');
        $st->execute([$projectId, $path]);
        foreach ($st->fetchAll() as $row) {
            $blob = $this->revisionBlobPath($projectId, (int) $row['id']);
            if (is_file($blob)) {
                unlink($blob);
            }
        }
        $del = $this->store->pdo()->prepare('DELETE FROM file_revisions WHERE project_id = ? AND path = ?');
        $del->execute([$projectId, $path]);
        $delHead = $this->store->pdo()->prepare('DELETE FROM file_revision_heads WHERE project_id = ? AND path = ?');
        $delHead->execute([$projectId, $path]);
    }

    private function insertRevision(
        string $projectId,
        string $path,
        string $projectKey,
        string $content,
        ?int $parentId,
        string $source,
        ?string $label,
        ?int $userId,
    ): int {
        $now = Store::now();
        $st = $this->store->pdo()->prepare(
            'INSERT INTO file_revisions (project_id, path, parent_id, source, label, user_id, size, created_at)
             VALUES (?,?,?,?,?,?,?,?)'
        );
        $st->execute([
            $projectId,
            $path,
            $parentId,
            $source,
            $label,
            $userId,
            strlen($content),
            $now,
        ]);
        $id = (int) $this->store->pdo()->lastInsertId();
        $dir = $this->historyDir($projectId);
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        $blob = $this->revisionBlobPath($projectId, $id);
        file_put_contents($blob, Crypto::encrypt($projectKey, $content));
        chmod($blob, 0660);
        return $id;
    }

    private function prune(string $projectId, string $path): void
    {
        $max = Config::maxFileRevisions();
        $headId = $this->headId($projectId, $path);
        if ($headId === null) {
            return;
        }
        $keep = $this->ancestorIds($headId);
        $st = $this->store->pdo()->prepare(
            'SELECT id FROM file_revisions WHERE project_id = ? AND path = ? ORDER BY created_at ASC, id ASC'
        );
        $st->execute([$projectId, $path]);
        $rows = $st->fetchAll();
        $extra = [];
        foreach ($rows as $row) {
            $id = (int) $row['id'];
            if (!isset($keep[$id])) {
                $extra[] = $id;
            }
        }
        while (count($rows) > $max && $extra !== []) {
            $drop = array_shift($extra);
            $blob = $this->revisionBlobPath($projectId, $drop);
            if (is_file($blob)) {
                unlink($blob);
            }
            $del = $this->store->pdo()->prepare('DELETE FROM file_revisions WHERE id = ?');
            $del->execute([$drop]);
            $rows = array_values(array_filter($rows, static fn ($r) => (int) $r['id'] !== $drop));
        }
    }

    /** @return array<int,true> */
    private function ancestorIds(int $revisionId): array
    {
        $keep = [];
        $st = $this->store->pdo()->prepare('SELECT id, parent_id FROM file_revisions WHERE id = ?');
        $cur = $revisionId;
        while ($cur > 0) {
            $keep[$cur] = true;
            $st->execute([$cur]);
            $row = $st->fetch();
            if (!$row || $row['parent_id'] === null) {
                break;
            }
            $cur = (int) $row['parent_id'];
        }
        return $keep;
    }

    private function headId(string $projectId, string $path): ?int
    {
        $st = $this->store->pdo()->prepare(
            'SELECT revision_id FROM file_revision_heads WHERE project_id = ? AND path = ?'
        );
        $st->execute([$projectId, $path]);
        $row = $st->fetch();
        return $row ? (int) $row['revision_id'] : null;
    }

    private function setHead(string $projectId, string $path, int $revisionId): void
    {
        $st = $this->store->pdo()->prepare(
            'INSERT INTO file_revision_heads (project_id, path, revision_id) VALUES (?,?,?)
             ON CONFLICT(project_id, path) DO UPDATE SET revision_id = excluded.revision_id'
        );
        $st->execute([$projectId, $path, $revisionId]);
    }

    private function readRevisionBlob(string $projectKey, int $revisionId): string
    {
        $st = $this->store->pdo()->prepare('SELECT project_id FROM file_revisions WHERE id = ?');
        $st->execute([$revisionId]);
        $row = $st->fetch();
        if (!$row) {
            throw new RuntimeException('Revision not found.');
        }
        $path = $this->revisionBlobPath((string) $row['project_id'], $revisionId);
        if (!is_file($path)) {
            throw new RuntimeException('Revision data missing.');
        }
        return Crypto::decrypt($projectKey, (string) file_get_contents($path));
    }

    private function requireRevision(string $projectId, string $path, int $revisionId): array
    {
        $st = $this->store->pdo()->prepare(
            'SELECT * FROM file_revisions WHERE id = ? AND project_id = ? AND path = ?'
        );
        $st->execute([$revisionId, $projectId, $path]);
        $row = $st->fetch();
        if (!$row) {
            throw new RuntimeException('Revision not found.');
        }
        return $row;
    }

    private function requireRevisionById(string $projectId, int $revisionId): array
    {
        $st = $this->store->pdo()->prepare('SELECT * FROM file_revisions WHERE id = ? AND project_id = ?');
        $st->execute([$revisionId, $projectId]);
        $row = $st->fetch();
        if (!$row) {
            throw new RuntimeException('Revision not found.');
        }
        return $row;
    }

    private function historyDir(string $projectId): string
    {
        return Config::projectsDir() . '/' . $projectId . '/history';
    }

    private function revisionBlobPath(string $projectId, int $revisionId): string
    {
        return $this->historyDir($projectId) . '/' . $revisionId . '.enc';
    }

    private function normalizePath(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        $path = ltrim($path, '/');
        if ($path === '' || str_contains($path, '..')) {
            throw new RuntimeException('Invalid path.');
        }
        return $path;
    }

    /** @param array<string,mixed> $row */
    public static function formatRevisionLabel(array $row): string
    {
        if (!empty($row['label'])) {
            return (string) $row['label'];
        }
        $source = (string) ($row['source'] ?? 'save');
        $map = [
            'initial' => 'Initial version',
            'save' => 'Saved',
            'compile' => 'Before compile',
            'ai' => 'AI edit',
            'restore' => 'Restored',
            'import' => 'Imported',
        ];
        $base = $map[$source] ?? ucfirst($source);
        $ts = (string) ($row['created_at'] ?? '');
        if ($ts === '') {
            return $base;
        }
        $t = strtotime($ts);
        if ($t === false) {
            return $base;
        }
        return $base . ' · ' . gmdate('Y-m-d H:i:s', $t) . ' UTC';
    }

    /** @param array<string,mixed> $row */
    private static function publicRevision(array $row, bool $isHead): array
    {
        return [
            'id' => (int) $row['id'],
            'parentId' => $row['parent_id'] !== null ? (int) $row['parent_id'] : null,
            'source' => (string) $row['source'],
            'label' => $row['label'] !== null ? (string) $row['label'] : null,
            'createdAt' => (string) $row['created_at'],
            'isHead' => $isHead,
            'display' => self::formatRevisionLabel($row),
        ];
    }
}
