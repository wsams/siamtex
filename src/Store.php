<?php

declare(strict_types=1);

namespace SiamTeX;

use PDO;
use RuntimeException;

final class Store
{
    private PDO $db;

    public function __construct(?string $path = null)
    {
        $path ??= Config::dbPath();
        $isNew = !is_file($path);
        $this->db = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->db->exec('PRAGMA foreign_keys = ON');
        $this->db->exec('PRAGMA journal_mode = WAL');
        if ($isNew) {
            chmod($path, 0660);
        }
        $this->migrate();
    }

    private function migrate(): void
    {
        $this->db->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login TEXT,
  name TEXT,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  main_file TEXT NOT NULL DEFAULT 'main.tex',
  engine TEXT NOT NULL DEFAULT 'pdflatex',
  wrapped_key TEXT NOT NULL,
  share_token TEXT,
  share_role TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY(owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_files (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, path),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  engine TEXT NOT NULL,
  exit_code INTEGER,
  duration_ms INTEGER,
  log_text TEXT,
  diagnostics_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_builds_project ON builds(project_id, created_at);

CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'ollama',
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  max_tokens INTEGER,
  timeout_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_calls_user_time ON ai_calls(user_id, created_at);

CREATE TABLE IF NOT EXISTS file_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_id INTEGER,
  source TEXT NOT NULL DEFAULT 'save',
  label TEXT,
  user_id INTEGER,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES file_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS file_revision_heads (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  revision_id INTEGER NOT NULL,
  PRIMARY KEY(project_id, path),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id) REFERENCES file_revisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_revisions_lookup ON file_revisions(project_id, path, created_at);
SQL);
        $this->migrateAiCallsColumns();
    }

    private function migrateAiCallsColumns(): void
    {
        $cols = $this->db->query('PRAGMA table_info(ai_calls)')->fetchAll(PDO::FETCH_ASSOC);
        $names = array_column($cols, 'name');
        if (!in_array('project_id', $names, true)) {
            $this->db->exec('ALTER TABLE ai_calls ADD COLUMN project_id TEXT');
        }
        if (!in_array('prompt_tokens', $names, true)) {
            $this->db->exec('ALTER TABLE ai_calls ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0');
        }
        if (!in_array('completion_tokens', $names, true)) {
            $this->db->exec('ALTER TABLE ai_calls ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0');
        }
        $this->db->exec('CREATE INDEX IF NOT EXISTS idx_ai_calls_project ON ai_calls(project_id, created_at)');
    }

    public function pdo(): PDO
    {
        return $this->db;
    }

    public function loadUser(int $id): ?array
    {
        $st = $this->db->prepare('SELECT * FROM users WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        return $row ?: null;
    }

    public function upsertOAuthUser(string $provider, string $providerUserId, array $meta): array
    {
        $now = self::now();
        $existing = $this->db->prepare('SELECT * FROM users WHERE provider = ? AND provider_user_id = ?');
        $existing->execute([$provider, $providerUserId]);
        $row = $existing->fetch();
        if ($row) {
            $st = $this->db->prepare('UPDATE users SET provider_login=?, name=?, email=?, email_verified=?, avatar_url=?, updated_at=? WHERE id=?');
            $st->execute([
                $meta['login'] ?? null,
                $meta['name'] ?? null,
                $meta['email'] ?? null,
                !empty($meta['emailVerified']) ? 1 : 0,
                $meta['avatarUrl'] ?? null,
                $now,
                $row['id'],
            ]);
            return $this->loadUser((int) $row['id']) ?? throw new RuntimeException('User missing after update');
        }
        $st = $this->db->prepare('INSERT INTO users (provider, provider_user_id, provider_login, name, email, email_verified, avatar_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
        $st->execute([
            $provider,
            $providerUserId,
            $meta['login'] ?? null,
            $meta['name'] ?? null,
            $meta['email'] ?? null,
            !empty($meta['emailVerified']) ? 1 : 0,
            $meta['avatarUrl'] ?? null,
            $now,
            $now,
        ]);
        return $this->loadUser((int) $this->db->lastInsertId()) ?? throw new RuntimeException('User missing after insert');
    }

    public function ensureLocalUser(): array
    {
        return $this->upsertOAuthUser(Auth::PROVIDER_LOCAL, 'local-1', [
            'login' => 'local',
            'name' => 'Local User',
            'email' => null,
            'emailVerified' => false,
            'avatarUrl' => null,
        ]);
    }

    public static function now(): string
    {
        return gmdate('c');
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(16));
    }
}
