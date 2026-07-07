<?php

declare(strict_types=1);

namespace SiamTeX;

use RuntimeException;

/** Per-user AI feature gates (admin-managed). */
final class AiPermissions
{
    public const CHAT = 'chat';
    public const CREATE_PROJECT = 'createProject';
    public const ASSIST = 'assist';
    public const FIX_ERRORS = 'fixErrors';
    public const SETTINGS = 'settings';

  /** @var array<string, string> */
    private const COL = [
        self::CHAT => 'ai_chat',
        self::CREATE_PROJECT => 'ai_create_project',
        self::ASSIST => 'ai_assist',
        self::FIX_ERRORS => 'ai_fix_errors',
        self::SETTINGS => 'ai_settings',
    ];

    public function __construct(private Store $store)
    {
    }

    public function isAdmin(array $user): bool
    {
        return !empty($user['is_admin']);
    }

    /** @return array{chat:bool, createProject:bool, assist:bool, fixErrors:bool, settings:bool, any:bool} */
    public function forUser(int $userId): array
    {
        $user = $this->store->loadUser($userId);
        if ($user === null) {
            return $this->emptyPermissions();
        }
        if ($this->isAdmin($user)) {
            return $this->allGranted();
        }
        $row = $this->loadRow($userId);
        return $this->rowToPublic($row);
    }

    public function allows(int $userId, string $feature): bool
    {
        if (!Config::aiEnabled()) {
            return false;
        }
        $perms = $this->forUser($userId);
        if ($feature === self::ASSIST) {
            return !empty($perms[self::ASSIST]) || !empty($perms[self::CHAT]);
        }
        return !empty($perms[$feature]);
    }

    public function assert(int $userId, string $feature): void
    {
        if (!$this->allows($userId, $feature)) {
            $label = match ($feature) {
                self::CHAT => 'AI Chat',
                self::CREATE_PROJECT => 'AI create project',
                self::ASSIST => 'AI assist',
                self::FIX_ERRORS => 'AI fix errors',
                self::SETTINGS => 'AI settings',
                default => 'AI',
            };
            throw new RuntimeException($label . ' is not enabled for your account. Ask an administrator.');
        }
    }

    /** null or ≤0 = unlimited */
    public function tokenQuotaForUser(int $userId): ?int
    {
        $row = $this->loadRow($userId);
        if ($row === null || $row['token_quota'] === null) {
            return null;
        }
        $q = (int) $row['token_quota'];
        return $q > 0 ? $q : null;
    }

    public function assertWithinTokenQuota(int $userId): void
    {
        $quota = $this->tokenQuotaForUser($userId);
        if ($quota === null) {
            return;
        }
        $usage = $this->usageForUser($userId);
        if ($usage['totalTokens'] >= $quota) {
            throw new RuntimeException(
                'AI token quota reached for your account (' . number_format($quota) . ' tokens). Ask an administrator.'
            );
        }
    }

    /** @return array{promptTokens:int, completionTokens:int, totalTokens:int, callCount:int} */
    public function siteUsageTotals(): array
    {
        $row = $this->store->pdo()->query(
            'SELECT COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c, COUNT(*) AS n FROM ai_calls'
        )->fetch() ?: ['p' => 0, 'c' => 0, 'n' => 0];
        $prompt = (int) $row['p'];
        $completion = (int) $row['c'];
        return [
            'promptTokens' => $prompt,
            'completionTokens' => $completion,
            'totalTokens' => $prompt + $completion,
            'callCount' => (int) $row['n'],
        ];
    }

    public function updateTokenQuota(int $targetUserId, ?int $tokenQuota, int $adminUserId): ?int
    {
        $target = $this->store->loadUser($targetUserId);
        if ($target === null) {
            throw new RuntimeException('User not found.');
        }
        $stored = ($tokenQuota === null || $tokenQuota <= 0) ? null : $tokenQuota;
        $now = Store::now();
        $existing = $this->loadRow($targetUserId);
        if ($existing) {
            $st = $this->store->pdo()->prepare(
                'UPDATE user_ai_permissions SET token_quota = ?, updated_at = ?, updated_by = ? WHERE user_id = ?'
            );
            $st->execute([$stored, $now, $adminUserId, $targetUserId]);
        } else {
            $st = $this->store->pdo()->prepare(
                'INSERT INTO user_ai_permissions (user_id, ai_chat, ai_create_project, ai_assist, ai_fix_errors, ai_settings, token_quota, updated_at, updated_by)
                 VALUES (?,0,0,0,0,0,?,?,?)'
            );
            $st->execute([$targetUserId, $stored, $now, $adminUserId]);
        }
        return $stored;
    }

    public function requireAdmin(array $user): void
    {
        if (!$this->isAdmin($user)) {
            throw new RuntimeException('Administrator access required.');
        }
    }

    /**
     * @return list<array{
     *   id:int, name:string, login:?string, provider:string, avatarUrl:?string,
     *   isAdmin:bool, permissions:array, aiUsage:array, tokenQuota:?int
     * }>
     */
    public function listUsersForAdmin(): array
    {
        $st = $this->store->pdo()->query(
            'SELECT u.id, u.provider, u.provider_login, u.name, u.avatar_url, u.is_admin,
                    p.ai_chat, p.ai_create_project, p.ai_assist, p.ai_fix_errors, p.ai_settings, p.token_quota
             FROM users u
             LEFT JOIN user_ai_permissions p ON p.user_id = u.id
             ORDER BY u.is_admin DESC, COALESCE(u.provider_login, u.name), u.id'
        );
        $out = [];
        foreach ($st->fetchAll() as $row) {
            $id = (int) $row['id'];
            $isAdmin = !empty($row['is_admin']);
            $perms = $isAdmin ? $this->allGranted() : $this->rowToPublic($row);
            $usage = $this->usageForUser($id);
            $tokenQuota = $row['token_quota'] !== null && (int) $row['token_quota'] > 0
                ? (int) $row['token_quota'] : null;
            if ($tokenQuota !== null) {
                $usage['tokenQuota'] = $tokenQuota;
                $usage['quotaRemaining'] = max(0, $tokenQuota - $usage['totalTokens']);
            }
            $out[] = [
                'id' => $id,
                'name' => (string) ($row['name'] ?: $row['provider_login'] ?: 'User'),
                'login' => $row['provider_login'] !== null ? (string) $row['provider_login'] : null,
                'provider' => (string) $row['provider'],
                'avatarUrl' => $row['avatar_url'] !== null ? (string) $row['avatar_url'] : null,
                'isAdmin' => $isAdmin,
                'permissions' => $perms,
                'aiUsage' => $usage,
                'tokenQuota' => $tokenQuota,
            ];
        }
        return $out;
    }

    /**
     * @param array{chat?:bool, createProject?:bool, assist?:bool, fixErrors?:bool, settings?:bool} $permissions
     */
    public function updateUserPermissions(int $targetUserId, array $permissions, int $adminUserId): array
    {
        $target = $this->store->loadUser($targetUserId);
        if ($target === null) {
            throw new RuntimeException('User not found.');
        }
        if ($this->isAdmin($target)) {
            throw new RuntimeException('Cannot change AI permissions for an administrator.');
        }

        $now = Store::now();
        $vals = [
            !empty($permissions[self::CHAT]) ? 1 : 0,
            !empty($permissions[self::CREATE_PROJECT]) ? 1 : 0,
            !empty($permissions[self::ASSIST]) ? 1 : 0,
            !empty($permissions[self::FIX_ERRORS]) ? 1 : 0,
            !empty($permissions[self::SETTINGS]) ? 1 : 0,
            $now,
            $adminUserId,
            $targetUserId,
        ];

        $existing = $this->loadRow($targetUserId);
        if ($existing) {
            $st = $this->store->pdo()->prepare(
                'UPDATE user_ai_permissions SET ai_chat=?, ai_create_project=?, ai_assist=?, ai_fix_errors=?, ai_settings=?, updated_at=?, updated_by=? WHERE user_id=?'
            );
            $st->execute($vals);
        } else {
            $st = $this->store->pdo()->prepare(
                'INSERT INTO user_ai_permissions (ai_chat, ai_create_project, ai_assist, ai_fix_errors, ai_settings, updated_at, updated_by, user_id)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            $st->execute($vals);
        }

        return $this->forUser($targetUserId);
    }

    public function syncAdminFromLogin(array $user): void
    {
        $login = strtolower(trim((string) ($user['provider_login'] ?? '')));
        if ($login === '' || !in_array($login, Config::adminGithubLogins(), true)) {
            return;
        }
        $id = (int) $user['id'];
        $st = $this->store->pdo()->prepare('UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ?');
        $st->execute([Store::now(), $id]);
        $this->grantAllPermissions($id, $id);
    }

    public function bootstrapLocalAdmin(int $userId): void
    {
        $st = $this->store->pdo()->prepare('UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ?');
        $st->execute([Store::now(), $userId]);
        $this->grantAllPermissions($userId, $userId);
    }

    private function grantAllPermissions(int $userId, int $updatedBy): void
    {
        $now = Store::now();
        $st = $this->store->pdo()->prepare(
            'INSERT INTO user_ai_permissions (user_id, ai_chat, ai_create_project, ai_assist, ai_fix_errors, ai_settings, updated_at, updated_by)
             VALUES (?,1,1,1,1,1,?,?)
             ON CONFLICT(user_id) DO UPDATE SET
               ai_chat=1, ai_create_project=1, ai_assist=1, ai_fix_errors=1, ai_settings=1,
               updated_at=excluded.updated_at, updated_by=excluded.updated_by'
        );
        $st->execute([$userId, $now, $updatedBy]);
    }

    /** @return array<string, mixed>|null */
    private function loadRow(int $userId): ?array
    {
        $st = $this->store->pdo()->prepare('SELECT * FROM user_ai_permissions WHERE user_id = ?');
        $st->execute([$userId]);
        $row = $st->fetch();
        return $row ?: null;
    }

    /** @return array{chat:bool, createProject:bool, assist:bool, fixErrors:bool, settings:bool, any:bool} */
    private function rowToPublic(?array $row): array
    {
        if ($row === null) {
            return $this->emptyPermissions();
        }
        $perms = [
            self::CHAT => !empty($row['ai_chat']),
            self::CREATE_PROJECT => !empty($row['ai_create_project']),
            self::ASSIST => !empty($row['ai_assist']),
            self::FIX_ERRORS => !empty($row['ai_fix_errors']),
            self::SETTINGS => !empty($row['ai_settings']),
        ];
        // Structured AI edit (file/project) ships with chat — same users expect both.
        if ($perms[self::CHAT]) {
            $perms[self::ASSIST] = true;
        }
        $perms['any'] = $perms[self::CHAT] || $perms[self::CREATE_PROJECT] || $perms[self::ASSIST]
            || $perms[self::FIX_ERRORS] || $perms[self::SETTINGS];
        return $perms;
    }

    /** @return array{chat:bool, createProject:bool, assist:bool, fixErrors:bool, settings:bool, any:bool} */
    private function allGranted(): array
    {
        return [
            self::CHAT => true,
            self::CREATE_PROJECT => true,
            self::ASSIST => true,
            self::FIX_ERRORS => true,
            self::SETTINGS => true,
            'any' => true,
        ];
    }

    /** @return array{chat:bool, createProject:bool, assist:bool, fixErrors:bool, settings:bool, any:bool} */
    private function emptyPermissions(): array
    {
        return [
            self::CHAT => false,
            self::CREATE_PROJECT => false,
            self::ASSIST => false,
            self::FIX_ERRORS => false,
            self::SETTINGS => false,
            'any' => false,
        ];
    }

    /** @return array{promptTokens:int, completionTokens:int, totalTokens:int, callCount:int} */
    private function usageForUser(int $userId): array
    {
        $st = $this->store->pdo()->prepare(
            'SELECT COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c, COUNT(*) AS n
             FROM ai_calls WHERE user_id = ?'
        );
        $st->execute([$userId]);
        $row = $st->fetch() ?: ['p' => 0, 'c' => 0, 'n' => 0];
        $prompt = (int) $row['p'];
        $completion = (int) $row['c'];
        return [
            'promptTokens' => $prompt,
            'completionTokens' => $completion,
            'totalTokens' => $prompt + $completion,
            'callCount' => (int) $row['n'],
        ];
    }
}
