<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

use RuntimeException;
use SiamTeX\Config;
use SiamTeX\Crypto;
use SiamTeX\ProjectService;
use SiamTeX\Store;

final class AiService
{
    private OpenAiCompatibleClient $client;

    public function __construct(
        private Store $store,
        private ProjectService $projects,
        ?OpenAiCompatibleClient $client = null,
    ) {
        $this->client = $client ?? new OpenAiCompatibleClient();
    }

    public function configForUser(int $userId): AiConfig
    {
        $st = $this->store->pdo()->prepare('SELECT * FROM user_ai_settings WHERE user_id = ?');
        $st->execute([$userId]);
        $row = $st->fetch();
        if ($row && !empty($row['api_key_enc'])) {
            $row['api_key'] = Crypto::decrypt(Config::masterKey(), (string) $row['api_key_enc']);
        }
        return AiConfig::forUser($row ?: null);
    }

    public function assertRateLimit(int $userId): void
    {
        $since = gmdate('c', time() - 3600);
        $st = $this->store->pdo()->prepare('SELECT COUNT(*) FROM ai_calls WHERE user_id = ? AND created_at >= ?');
        $st->execute([$userId, $since]);
        $count = (int) $st->fetchColumn();
        if ($count >= Config::aiMaxCallsPerHour()) {
            throw new RuntimeException('AI rate limit reached. Try again later.');
        }
    }

    public function recordCall(int $userId, string $kind, ?string $projectId, AiUsage $usage): void
    {
        $st = $this->store->pdo()->prepare(
            'INSERT INTO ai_calls (user_id, kind, project_id, prompt_tokens, completion_tokens, created_at) VALUES (?,?,?,?,?,?)'
        );
        $st->execute([
            $userId,
            $kind,
            $projectId,
            $usage->promptTokens,
            $usage->completionTokens,
            Store::now(),
        ]);
    }

    /**
     * @return array{promptTokens:int, completionTokens:int, totalTokens:int, callCount:int}
     */
    public function usageSummaryForUser(int $userId): array
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

    /**
     * @return array{promptTokens:int, completionTokens:int, totalTokens:int, callCount:int}
     */
    public function usageSummaryForProject(string $projectId): array
    {
        $st = $this->store->pdo()->prepare(
            'SELECT COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c, COUNT(*) AS n
             FROM ai_calls WHERE project_id = ?'
        );
        $st->execute([$projectId]);
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

    /**
     * @return array<string, array{promptTokens:int, completionTokens:int, totalTokens:int, callCount:int}>
     */
    public function usageByProjectForUser(int $userId): array
    {
        $st = $this->store->pdo()->prepare(
            'SELECT project_id,
                    COALESCE(SUM(prompt_tokens),0) AS p,
                    COALESCE(SUM(completion_tokens),0) AS c,
                    COUNT(*) AS n
             FROM ai_calls
             WHERE user_id = ? AND project_id IS NOT NULL AND project_id != \'\'
             GROUP BY project_id'
        );
        $st->execute([$userId]);
        $out = [];
        foreach ($st->fetchAll() as $row) {
            $pid = (string) $row['project_id'];
            $prompt = (int) $row['p'];
            $completion = (int) $row['c'];
            $out[$pid] = [
                'promptTokens' => $prompt,
                'completionTokens' => $completion,
                'totalTokens' => $prompt + $completion,
                'callCount' => (int) $row['n'],
            ];
        }
        return $out;
    }

    /**
     * @return array{usage: array, usageTotals: array{user: array, project: ?array}}
     */
    private function finalizeUsage(int $userId, string $kind, ?string $projectId, AiUsage $usage): array
    {
        $this->recordCall($userId, $kind, $projectId, $usage);
        return [
            'usage' => $usage->toPublicArray(),
            'usageTotals' => [
                'user' => $this->usageSummaryForUser($userId),
                'project' => $projectId !== null ? $this->usageSummaryForProject($projectId) : null,
            ],
        ];
    }

    public function testConnection(AiConfig $config): array
    {
        $config->validate();
        $reply = trim($this->client->ping($config));
        return [
            'ok' => stripos($reply, 'ok') !== false,
            'reply' => substr($reply, 0, 200),
            'model' => $config->model,
            'baseUrl' => $config->baseUrl,
        ];
    }

    /**
     * @return array{summary:string, path:string, content:string, usage:array, usageTotals:array}
     */
    public function editFileStream(
        array $user,
        string $projectId,
        string $path,
        string $instruction,
        callable $onDelta,
        callable $onUsage,
        ?callable $shouldAbort = null,
    ): array {
        $instruction = trim($instruction);
        if ($instruction === '') {
            throw new RuntimeException('Instruction is required.');
        }
        $project = $this->projects->requireRole($user, $projectId, ['owner', 'edit']);
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $content = $this->projects->readFile($project, $path);
        if (strlen($content) > Config::aiMaxContextChars()) {
            throw new RuntimeException('File is too large for AI context. Split the file or shorten content.');
        }

        $messages = PromptBuilder::singleFileEdit($path, $content, $instruction, (string) $project['engine']);
        $chat = $this->client->chatStream(
            $config,
            $messages,
            $onDelta,
            $shouldAbort,
            static function (AiUsage $u) use ($onUsage): void {
                $onUsage($u);
            },
        );
        $meta = $this->finalizeUsage((int) $user['id'], 'edit_file', $projectId, $chat->usage);

        return array_merge([
            'summary' => 'Updated ' . $path,
            'path' => $path,
            'content' => AiResponseParser::parseSingleFile($chat->content),
        ], $meta);
    }

    /**
     * @return array{summary:string, files:array<string, string>, notes:list<string>, usage:array, usageTotals:array}
     */
    public function editProjectStream(
        array $user,
        string $projectId,
        string $instruction,
        string $extraContext,
        callable $onStatus,
        callable $onUsage,
        ?callable $onDelta = null,
        ?callable $shouldAbort = null,
    ): array {
        $instruction = trim($instruction);
        if ($instruction === '') {
            throw new RuntimeException('Instruction is required.');
        }
        $project = $this->projects->requireRole($user, $projectId, ['owner', 'edit']);
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $onStatus('Collecting project files…');
        $files = [];
        $budget = Config::aiMaxContextChars();
        foreach ($this->projects->listFiles($projectId) as $meta) {
            $p = (string) $meta['path'];
            if (!preg_match('/\.(tex|bib|sty|cls)$/i', $p)) {
                continue;
            }
            $text = $this->projects->readFile($project, $p);
            if (strlen($text) > $budget) {
                throw new RuntimeException('Project is too large for AI context. Edit one file at a time.');
            }
            $files[$p] = $text;
            $budget -= strlen($text);
        }
        if ($files === []) {
            throw new RuntimeException('No editable text files in this project.');
        }
        if (strlen($extraContext) > min(50000, Config::aiMaxContextChars())) {
            $extraContext = substr($extraContext, 0, 50000);
        }

        $messages = PromptBuilder::multiFileEdit($files, $instruction, (string) $project['engine'], $extraContext);
        $onStatus('Waiting for model — tracking token usage while JSON is generated…');
        $chat = $this->client->chatWithProgress(
            $config,
            $messages,
            static function (AiUsage $u) use ($onUsage): void {
                $onUsage($u);
            },
            $shouldAbort,
            $onDelta,
        );
        $meta = $this->finalizeUsage((int) $user['id'], 'edit_project', $projectId, $chat->usage);

        return array_merge(AiResponseParser::parseMultiFileJson($chat->content), $meta);
    }

    /**
     * @return array{summary:string, files:array<string, string>, notes:list<string>, usage:array, usageTotals:array}
     */
    public function fixProblemsStream(
        array $user,
        string $projectId,
        callable $onStatus,
        callable $onUsage,
        ?callable $onDelta = null,
        ?callable $shouldAbort = null,
    ): array {
        $project = $this->projects->requireRole($user, $projectId, ['owner', 'edit']);
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $onStatus('Loading compile errors from the last build…');
        $build = $this->projects->latestBuild($projectId);
        if ($build === null) {
            throw new RuntimeException('No build found. Compile the project first.');
        }

        $diagnostics = array_values(array_filter(
            $build['diagnostics'],
            static fn ($d) => is_array($d) && (($d['severity'] ?? '') === 'error')
        ));
        if ($diagnostics === []) {
            throw new RuntimeException('No compile errors in the last build.');
        }

        $listed = $this->projects->listFiles($projectId);
        $main = (string) $project['main_file'];
        $paths = [$main];
        foreach ($diagnostics as $d) {
            $paths[] = self::resolveDiagnosticPath($listed, $d['file'] ?? null, $main);
        }
        $paths = array_values(array_unique($paths));

        $files = [];
        $budget = Config::aiMaxContextChars();
        foreach ($paths as $p) {
            if (!preg_match('/\.(tex|bib|sty|cls)$/i', $p)) {
                continue;
            }
            $text = $this->projects->readFile($project, $p);
            if (strlen($text) > $budget) {
                throw new RuntimeException('Affected files are too large for AI context. Fix one file at a time.');
            }
            $files[$p] = $text;
            $budget -= strlen($text);
        }

        $logTail = substr((string) ($build['log'] ?? ''), -8000);
        $messages = PromptBuilder::fixCompileProblems($files, $diagnostics, $logTail, (string) $project['engine']);
        $onStatus('Waiting for model — tracking token usage while fixes are generated…');
        $chat = $this->client->chatWithProgress(
            $config,
            $messages,
            static function (AiUsage $u) use ($onUsage): void {
                $onUsage($u);
            },
            $shouldAbort,
            $onDelta,
        );
        $meta = $this->finalizeUsage((int) $user['id'], 'fix_problems', $projectId, $chat->usage);

        return array_merge(AiResponseParser::parseMultiFileJson($chat->content), $meta);
    }

    /**
     * @return array{project: array, summary:string, files:array<string, string>, notes:list<string>, usage:array, usageTotals:array}
     */
    public function createProjectStream(
        array $user,
        string $prompt,
        string $nameHint,
        string $engine,
        callable $onStatus,
        callable $onUsage,
        ?callable $onDelta = null,
        ?callable $shouldAbort = null,
    ): array {
        $prompt = trim($prompt);
        if ($prompt === '') {
            throw new RuntimeException('Describe what you want the project to contain.');
        }
        if (!in_array($engine, ['pdflatex', 'xelatex', 'lualatex'], true)) {
            $engine = 'pdflatex';
        }
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $onStatus('Planning a new LaTeX project from your prompt…');
        $messages = PromptBuilder::createProject($prompt, $engine, $nameHint);
        $chat = $this->client->chatWithProgress(
            $config,
            $messages,
            static function (AiUsage $u) use ($onUsage): void {
                $onUsage($u);
            },
            $shouldAbort,
            $onDelta,
        );
        $parsed = AiResponseParser::parseNewProjectJson($chat->content);
        $onStatus('Creating project files…');
        $project = $this->projects->createFromAiFiles(
            $user,
            $nameHint !== '' ? $nameHint : $parsed['name'],
            $parsed['mainFile'],
            $parsed['engine'] !== '' ? $parsed['engine'] : $engine,
            $parsed['files'],
        );
        $meta = $this->finalizeUsage((int) $user['id'], 'create_project', (string) $project['id'], $chat->usage);

        return array_merge([
            'project' => $project,
            'summary' => $parsed['summary'],
            'files' => $parsed['files'],
            'notes' => $parsed['notes'],
        ], $meta);
    }

    /**
     * @return array{summary:string, path:string, content:string}
     */
    public function editFile(array $user, string $projectId, string $path, string $instruction): array
    {
        $instruction = trim($instruction);
        if ($instruction === '') {
            throw new RuntimeException('Instruction is required.');
        }
        $project = $this->projects->requireRole($user, $projectId, ['owner', 'edit']);
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $content = $this->projects->readFile($project, $path);
        if (strlen($content) > Config::aiMaxContextChars()) {
            throw new RuntimeException('File is too large for AI context. Split the file or shorten content.');
        }

        $messages = PromptBuilder::singleFileEdit($path, $content, $instruction, (string) $project['engine']);
        $chat = $this->client->chat($config, $messages);
        $this->finalizeUsage((int) $user['id'], 'edit_file', $projectId, $chat->usage);

        return [
            'summary' => 'Updated ' . $path,
            'path' => $path,
            'content' => AiResponseParser::parseSingleFile($chat->content),
        ];
    }

    /**
     * @return array{summary:string, files:array<string, string>, notes:list<string>}
     */
    public function editProject(array $user, string $projectId, string $instruction, string $extraContext = ''): array
    {
        $instruction = trim($instruction);
        if ($instruction === '') {
            throw new RuntimeException('Instruction is required.');
        }
        $project = $this->projects->requireRole($user, $projectId, ['owner', 'edit']);
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $files = [];
        $budget = Config::aiMaxContextChars();
        foreach ($this->projects->listFiles($projectId) as $meta) {
            $p = (string) $meta['path'];
            if (!preg_match('/\.(tex|bib|sty|cls)$/i', $p)) {
                continue;
            }
            $text = $this->projects->readFile($project, $p);
            if (strlen($text) > $budget) {
                throw new RuntimeException('Project is too large for AI context. Edit one file at a time.');
            }
            $files[$p] = $text;
            $budget -= strlen($text);
        }
        if ($files === []) {
            throw new RuntimeException('No editable text files in this project.');
        }
        if (strlen($extraContext) > min(50000, Config::aiMaxContextChars())) {
            $extraContext = substr($extraContext, 0, 50000);
        }

        $messages = PromptBuilder::multiFileEdit($files, $instruction, (string) $project['engine'], $extraContext);
        $chat = $this->client->chat($config, $messages);
        $this->finalizeUsage((int) $user['id'], 'edit_project', $projectId, $chat->usage);

        return AiResponseParser::parseMultiFileJson($chat->content);
    }

    /**
     * @return array{summary:string, files:array<string, string>, notes:list<string>}
     */
    public function fixProblems(array $user, string $projectId): array
    {
        $project = $this->projects->requireRole($user, $projectId, ['owner', 'edit']);
        $config = $this->configForUser((int) $user['id']);
        $config->validate();
        $this->assertRateLimit((int) $user['id']);

        $build = $this->projects->latestBuild($projectId);
        if ($build === null) {
            throw new RuntimeException('No build found. Compile the project first.');
        }

        $diagnostics = array_values(array_filter(
            $build['diagnostics'],
            static fn ($d) => is_array($d) && (($d['severity'] ?? '') === 'error')
        ));
        if ($diagnostics === []) {
            throw new RuntimeException('No compile errors in the last build.');
        }

        $listed = $this->projects->listFiles($projectId);
        $main = (string) $project['main_file'];
        $paths = [$main];
        foreach ($diagnostics as $d) {
            $paths[] = self::resolveDiagnosticPath($listed, $d['file'] ?? null, $main);
        }
        $paths = array_values(array_unique($paths));

        $files = [];
        $budget = Config::aiMaxContextChars();
        foreach ($paths as $p) {
            if (!preg_match('/\.(tex|bib|sty|cls)$/i', $p)) {
                continue;
            }
            $text = $this->projects->readFile($project, $p);
            if (strlen($text) > $budget) {
                throw new RuntimeException('Affected files are too large for AI context. Fix one file at a time.');
            }
            $files[$p] = $text;
            $budget -= strlen($text);
        }

        $logTail = substr((string) ($build['log'] ?? ''), -8000);
        $messages = PromptBuilder::fixCompileProblems($files, $diagnostics, $logTail, (string) $project['engine']);
        $chat = $this->client->chat($config, $messages);
        $this->finalizeUsage((int) $user['id'], 'fix_problems', $projectId, $chat->usage);

        return AiResponseParser::parseMultiFileJson($chat->content);
    }

    /**
     * @param list<array{path:string}> $listed
     */
    private static function resolveDiagnosticPath(array $listed, ?string $file, string $main): string
    {
        if ($file === null || trim($file) === '') {
            return $main;
        }
        $file = ltrim(str_replace('\\', '/', trim($file)), './');
        foreach ($listed as $f) {
            if (($f['path'] ?? '') === $file) {
                return (string) $f['path'];
            }
        }
        foreach ($listed as $f) {
            $path = (string) ($f['path'] ?? '');
            if ($path !== '' && str_ends_with($path, '/' . $file)) {
                return $path;
            }
        }
        $base = basename($file);
        foreach ($listed as $f) {
            $path = (string) ($f['path'] ?? '');
            if ($path !== '' && basename($path) === $base) {
                return $path;
            }
        }
        return $main;
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function saveUserSettings(int $userId, array $patch): AiConfig
    {
        $existing = $this->store->pdo()->prepare('SELECT * FROM user_ai_settings WHERE user_id = ?');
        $existing->execute([$userId]);
        $row = $existing->fetch() ?: [];

        $provider = array_key_exists('provider', $patch)
            ? trim((string) $patch['provider']) : (string) ($row['provider'] ?? '');
        $baseUrl = array_key_exists('baseUrl', $patch)
            ? rtrim(trim((string) $patch['baseUrl']), '/') : (string) ($row['base_url'] ?? '');
        $model = array_key_exists('model', $patch)
            ? trim((string) $patch['model']) : (string) ($row['model'] ?? '');
        $enabled = array_key_exists('enabled', $patch)
            ? (!empty($patch['enabled']) ? 1 : 0) : (int) ($row['enabled'] ?? 1);

        $apiKeyEnc = (string) ($row['api_key_enc'] ?? '');
        if (!empty($patch['apiKey'])) {
            $apiKeyEnc = Crypto::encrypt(Config::masterKey(), trim((string) $patch['apiKey']));
        } elseif (array_key_exists('clearApiKey', $patch) && $patch['clearApiKey']) {
            $apiKeyEnc = '';
        }

        if ($baseUrl !== '') {
            UrlGuard::assertAllowedBaseUrl($baseUrl);
        }

        $now = Store::now();
        if ($row) {
            $st = $this->store->pdo()->prepare(
                'UPDATE user_ai_settings SET provider=?, base_url=?, model=?, api_key_enc=?, enabled=?, updated_at=? WHERE user_id=?'
            );
            $st->execute([$provider, $baseUrl, $model, $apiKeyEnc, $enabled, $now, $userId]);
        } else {
            $st = $this->store->pdo()->prepare(
                'INSERT INTO user_ai_settings (user_id, provider, base_url, model, api_key_enc, enabled, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            $st->execute([$userId, $provider, $baseUrl, $model, $apiKeyEnc, $enabled, $now, $now]);
        }

        return $this->configForUser($userId);
    }
}
