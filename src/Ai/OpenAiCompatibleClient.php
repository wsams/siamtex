<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

use RuntimeException;

final class OpenAiCompatibleClient
{
    /**
     * @param list<array{role:string, content:string}> $messages
     */
    public function chat(AiConfig $config, array $messages): AiChatResult
    {
        $url = rtrim($config->baseUrl, '/') . '/chat/completions';
        $payload = [
            'model' => $config->model,
            'messages' => $messages,
            'max_tokens' => $config->maxTokens,
            'stream' => false,
        ];
        if ($config->provider === 'ollama') {
            $payload['format'] = 'json';
            $payload['temperature'] = 0.1;
        }

        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
        if ($config->apiKey !== '') {
            $headers .= 'Authorization: Bearer ' . $config->apiKey . "\r\n";
        }

        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => $headers,
                'content' => $body,
                'timeout' => $config->timeoutSeconds,
                'ignore_errors' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) {
            throw new RuntimeException('Could not reach the AI provider. Check the base URL and network (e.g. Tailscale).');
        }

        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }

        $data = json_decode($raw, true);
        if ($code >= 400 || !is_array($data)) {
            $msg = is_array($data) ? (string) ($data['error']['message'] ?? $data['error'] ?? '') : trim($raw);
            throw new RuntimeException($msg !== '' ? $msg : 'AI provider returned HTTP ' . $code);
        }

        $choice = $data['choices'][0] ?? [];
        $finish = (string) ($choice['finish_reason'] ?? '');
        $content = $this->extractMessageContent($data);
        $usage = AiUsage::fromProviderJson($data) ?? AiUsage::estimateFromMessages($messages, $content);

        return new AiChatResult($content, $usage, $finish !== '' ? $finish : null);
    }

    /**
     * @param list<array{role:string, content:string}> $messages
     * @param callable(string): void $onDelta
     * @param callable(AiUsage): void|null $onUsage
     */
    public function chatStream(
        AiConfig $config,
        array $messages,
        callable $onDelta,
        ?callable $shouldAbort = null,
        ?callable $onUsage = null,
        ?callable $onReasoningDelta = null,
    ): AiChatResult {
        return $this->streamRequest($config, $messages, false, $onDelta, null, $shouldAbort, $onUsage, $onReasoningDelta);
    }

    /**
     * @param list<array{role:string, content:string}> $messages
     * @param callable(AiUsage): void $onUsage
     */
    public function chatWithProgress(
        AiConfig $config,
        array $messages,
        callable $onUsage,
        ?callable $shouldAbort = null,
        ?callable $onDelta = null,
    ): AiChatResult {
        $delta = $onDelta ?? static function (): void {};
        return $this->streamRequest(
            $config,
            $messages,
            true,
            $delta,
            $onUsage,
            $shouldAbort,
            $onUsage,
            null,
        );
    }

    public function ping(AiConfig $config): string
    {
        return $this->chat($config, [
            ['role' => 'user', 'content' => 'Reply with JSON only: {"status":"ok"}'],
        ])->content;
    }

    /**
     * @param list<array{role:string, content:string}> $messages
     * @param callable(string): void $onDelta
     * @param callable(AiUsage): void|null $onProgress
     */
    private function streamRequest(
        AiConfig $config,
        array $messages,
        bool $ollamaJsonFormat,
        callable $onDelta,
        ?callable $onProgress,
        ?callable $shouldAbort,
        ?callable $onUsage,
        ?callable $onReasoningDelta = null,
    ): AiChatResult {
        if (!function_exists('curl_init')) {
            if ($ollamaJsonFormat) {
                return $this->chat($config, $messages);
            }
            throw new RuntimeException('PHP curl extension is required for AI streaming.');
        }

        $url = rtrim($config->baseUrl, '/') . '/chat/completions';
        $payload = [
            'model' => $config->model,
            'messages' => $messages,
            'max_tokens' => $config->maxTokens,
            'stream' => true,
        ];
        if ($config->provider === 'ollama') {
            $payload['temperature'] = 0.1;
            if ($ollamaJsonFormat) {
                $payload['format'] = 'json';
            }
        }

        $headers = ['Content-Type: application/json', 'Accept: text/event-stream'];
        if ($config->apiKey !== '') {
            $headers[] = 'Authorization: Bearer ' . $config->apiKey;
        }

        $lineBuffer = '';
        $fullContent = '';
        $fullReasoning = '';
        $usage = new AiUsage();
        $finishReason = null;
        $httpCode = 0;
        $curlError = '';
        $lastProgressAt = 0.0;

        $emitUsage = static function (AiUsage $next) use (&$usage, $onProgress, $onUsage, &$lastProgressAt): void {
            $usage = $usage->merge($next);
            $now = microtime(true);
            if (($onProgress !== null || $onUsage !== null) && ($now - $lastProgressAt) >= 1.0) {
                $lastProgressAt = $now;
                $onProgress?->__invoke($usage);
                $onUsage?->__invoke($usage);
            }
        };

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => $config->timeoutSeconds,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $header) use (&$httpCode): int {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $header, $m)) {
                    $httpCode = (int) $m[1];
                }
                return strlen($header);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, string $data) use (
                &$lineBuffer,
                &$fullContent,
                &$fullReasoning,
                &$finishReason,
                $onDelta,
                $onReasoningDelta,
                $shouldAbort,
                $emitUsage,
            ): int {
                if ($shouldAbort !== null && $shouldAbort()) {
                    return -1;
                }
                $lineBuffer .= $data;
                while (($pos = strpos($lineBuffer, "\n")) !== false) {
                    $line = rtrim(substr($lineBuffer, 0, $pos), "\r");
                    $lineBuffer = substr($lineBuffer, $pos + 1);
                    $piece = $this->parseSseDataLine($line);
                    if ($piece === null) {
                        continue;
                    }
                    if (!empty($piece['finish'])) {
                        $finishReason = (string) $piece['finish'];
                    }
                    if (($piece['usage'] ?? null) instanceof AiUsage) {
                        $emitUsage($piece['usage']);
                    }
                    if ($piece['content'] !== '') {
                        $fullContent .= $piece['content'];
                        $onDelta($piece['content']);
                        $emitUsage(AiUsage::estimateCompletionChars(strlen($fullContent) + strlen($fullReasoning)));
                    }
                    if ($piece['reasoning'] !== '') {
                        $fullReasoning .= $piece['reasoning'];
                        if ($onReasoningDelta !== null) {
                            $onReasoningDelta($piece['reasoning']);
                        } else {
                            $onDelta($piece['reasoning']);
                        }
                        $emitUsage(AiUsage::estimateCompletionChars(strlen($fullContent) + strlen($fullReasoning)));
                    }
                }
                return strlen($data);
            },
        ]);

        $ok = curl_exec($ch);
        if ($ok === false) {
            $curlError = curl_error($ch);
        }
        curl_close($ch);

        if ($shouldAbort !== null && $shouldAbort()) {
            throw new RuntimeException('AI request cancelled.');
        }
        if ($ok === false) {
            throw new RuntimeException($curlError !== '' ? $curlError : 'Could not reach the AI provider.');
        }
        if ($httpCode >= 400) {
            $errBody = trim($lineBuffer);
            $parsed = json_decode($errBody, true);
            $msg = is_array($parsed)
                ? (string) ($parsed['error']['message'] ?? $parsed['error'] ?? '')
                : $errBody;
            throw new RuntimeException($msg !== '' ? $msg : 'AI provider returned HTTP ' . $httpCode);
        }

        $content = $fullContent !== '' ? $fullContent : $fullReasoning;
        if ($content === '') {
            throw new RuntimeException('AI provider returned an empty response. Try again or switch models.');
        }

        if ($usage->total() === 0) {
            $usage = AiUsage::estimateFromMessages($messages, $content);
        }

        $onProgress?->__invoke($usage);
        $onUsage?->__invoke($usage);

        return new AiChatResult($content, $usage, $finishReason, $fullReasoning);
    }

    /**
     * @return array{content:string, reasoning:string, usage:?AiUsage, finish:string}|null
     */
    private function parseSseDataLine(string $line): ?array
    {
        $line = trim($line);
        if ($line === '' || $line === 'data: [DONE]') {
            return null;
        }
        if (!str_starts_with($line, 'data: ')) {
            return null;
        }
        $json = json_decode(substr($line, 6), true);
        if (!is_array($json)) {
            return null;
        }
        $choice = $json['choices'][0] ?? [];
        $delta = is_array($choice['delta'] ?? null) ? $choice['delta'] : [];
        return [
            'content' => (string) ($delta['content'] ?? ''),
            'reasoning' => (string) ($delta['reasoning'] ?? ''),
            'usage' => AiUsage::fromProviderJson($json),
            'finish' => (string) ($choice['finish_reason'] ?? ''),
        ];
    }

    /**
     * @param array<string, mixed> $data
     */
    private function extractMessageContent(array $data): string
    {
        $choice = $data['choices'][0] ?? [];
        $msg = is_array($choice['message'] ?? null) ? $choice['message'] : [];
        $content = trim((string) ($msg['content'] ?? ''));
        $reasoning = trim((string) ($msg['reasoning'] ?? ''));
        $finish = (string) ($choice['finish_reason'] ?? '');

        if ($content === '' && $reasoning !== '') {
            $content = $reasoning;
        }
        if ($content === '') {
            if ($finish === 'length') {
                throw new RuntimeException(
                    'AI response was cut off (token limit). Try one file at a time or increase SIAMTEX_AI_MAX_TOKENS.'
                );
            }
            throw new RuntimeException('AI provider returned an empty response. Try again or switch models.');
        }
        return $content;
    }

    /**
     * @return list<string>
     */
    public function listModels(AiConfig $config): array
    {
        $config->validate();
        $names = [];
        if ($config->provider === 'ollama') {
            $names = array_merge($names, $this->fetchOllamaTagModels($config));
        }
        $names = array_merge($names, $this->fetchOpenAiModels($config));
        $names = array_values(array_unique(array_filter(array_map('trim', $names))));
        sort($names, SORT_NATURAL | SORT_FLAG_CASE);
        if ($config->model !== '' && !in_array($config->model, $names, true)) {
            array_unshift($names, $config->model);
        }
        return $names;
    }

    /** @return list<string> */
    private function fetchOllamaTagModels(AiConfig $config): array
    {
        $root = preg_replace('#/v1/?$#', '', rtrim($config->baseUrl, '/'));
        if ($root === '') {
            return [];
        }
        $url = $root . '/api/tags';
        $raw = $this->httpGet($url, $config->apiKey);
        if ($raw === null) {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return [];
        }
        $out = [];
        foreach ($data['models'] ?? [] as $m) {
            if (is_array($m) && !empty($m['name'])) {
                $out[] = (string) $m['name'];
            }
        }
        return $out;
    }

    /** @return list<string> */
    private function fetchOpenAiModels(AiConfig $config): array
    {
        $url = rtrim($config->baseUrl, '/') . '/models';
        $raw = $this->httpGet($url, $config->apiKey);
        if ($raw === null) {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return [];
        }
        $out = [];
        foreach ($data['data'] ?? [] as $m) {
            if (is_array($m) && !empty($m['id'])) {
                $out[] = (string) $m['id'];
            }
        }
        return $out;
    }

    private function httpGet(string $url, string $apiKey): ?string
    {
        UrlGuard::assertAllowedBaseUrl($url);
        $headers = "Accept: application/json\r\n";
        if ($apiKey !== '') {
            $headers .= 'Authorization: Bearer ' . $apiKey . "\r\n";
        }
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => $headers,
                'timeout' => min(30, max(5, (int) (getenv('SIAMTEX_AI_TIMEOUT') ?: 30))),
                'ignore_errors' => true,
            ],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) {
            return null;
        }
        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }
        if ($code >= 400) {
            return null;
        }
        return $raw;
    }
}
