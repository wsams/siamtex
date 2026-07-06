<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

use RuntimeException;

final class OpenAiCompatibleClient
{
    /**
     * @param list<array{role:string, content:string}> $messages
     */
    public function chat(AiConfig $config, array $messages): string
    {
        $url = rtrim($config->baseUrl, '/') . '/chat/completions';
        $payload = [
            'model' => $config->model,
            'messages' => $messages,
            'max_tokens' => $config->maxTokens,
            'stream' => false,
        ];
        if ($config->provider === 'ollama') {
            // Reasoning models (e.g. qwythos) otherwise return markdown in `content`
            // or put output in `reasoning` with truncated JSON.
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

    public function ping(AiConfig $config): string
    {
        return $this->chat($config, [
            ['role' => 'user', 'content' => 'Reply with JSON only: {"status":"ok"}'],
        ]);
    }
}
