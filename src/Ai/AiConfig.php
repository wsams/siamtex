<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

use InvalidArgumentException;
use SiamTeX\Config;

/** Resolved AI provider settings (server env + optional per-user overrides). */
final class AiConfig
{
    public function __construct(
        public readonly bool $enabled,
        public readonly string $provider,
        public readonly string $baseUrl,
        public readonly string $model,
        public readonly string $apiKey,
        public readonly int $maxTokens,
        public readonly int $timeoutSeconds,
        public readonly bool $fromEnv,
    ) {
    }

    public static function fromEnv(): self
    {
        return new self(
            enabled: Config::aiEnabled(),
            provider: Config::aiProvider(),
            baseUrl: Config::aiBaseUrl(),
            model: Config::aiModel(),
            apiKey: Config::aiApiKey(),
            maxTokens: Config::aiMaxTokens(),
            timeoutSeconds: Config::aiTimeoutSeconds(),
            fromEnv: true,
        );
    }

    public static function forUser(?array $row): self
    {
        $env = self::fromEnv();
        if ($row === null) {
            return $env;
        }
        $enabled = !empty($row['enabled']) || ($env->enabled && empty($row['id']));
        $provider = trim((string) ($row['provider'] ?? '')) ?: $env->provider;
        $baseUrl = rtrim(trim((string) ($row['base_url'] ?? '')), '/');
        if ($baseUrl === '') {
            $baseUrl = $env->baseUrl;
        }
        $model = trim((string) ($row['model'] ?? '')) ?: $env->model;
        $apiKey = trim((string) ($row['api_key'] ?? '')) ?: $env->apiKey;
        if (!$enabled && $env->enabled && $baseUrl !== '' && $model !== '') {
            $enabled = true;
        }
        return new self(
            enabled: $enabled && $baseUrl !== '' && $model !== '',
            provider: $provider,
            baseUrl: $baseUrl,
            model: $model,
            apiKey: $apiKey,
            maxTokens: (int) ($row['max_tokens'] ?? $env->maxTokens) ?: $env->maxTokens,
            timeoutSeconds: (int) ($row['timeout_seconds'] ?? $env->timeoutSeconds) ?: $env->timeoutSeconds,
            fromEnv: $baseUrl === $env->baseUrl && $model === $env->model,
        );
    }

    /** @return array<string, mixed> */
    public function publicView(bool $hasUserKey = false): array
    {
        return [
            'enabled' => $this->enabled,
            'provider' => $this->provider,
            'baseUrl' => $this->baseUrl,
            'model' => $this->model,
            'hasApiKey' => $this->apiKey !== '' || $hasUserKey,
            'maxTokens' => $this->maxTokens,
            'timeoutSeconds' => $this->timeoutSeconds,
            'configuredBy' => $this->fromEnv ? 'server' : 'user',
        ];
    }

    public function withModel(string $model): self
    {
        $model = trim($model);
        return new self(
            enabled: $this->enabled,
            provider: $this->provider,
            baseUrl: $this->baseUrl,
            model: $model,
            apiKey: $this->apiKey,
            maxTokens: $this->maxTokens,
            timeoutSeconds: $this->timeoutSeconds,
            fromEnv: false,
        );
    }

    public function validate(): void
    {
        if (!$this->enabled) {
            throw new InvalidArgumentException('AI is not enabled. Set SIAMTEX_AI_* in the server environment.');
        }
        if ($this->baseUrl === '' || $this->model === '') {
            throw new InvalidArgumentException('AI base URL and model are required.');
        }
        UrlGuard::assertAllowedBaseUrl($this->baseUrl);
    }
}
