<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

final class AiUsage
{
    public function __construct(
        public readonly int $promptTokens = 0,
        public readonly int $completionTokens = 0,
        public readonly bool $estimated = false,
    ) {
    }

    public function total(): int
    {
        return $this->promptTokens + $this->completionTokens;
    }

    public function withCompletion(int $completionTokens, bool $estimated = false): self
    {
        return new self($this->promptTokens, max($this->completionTokens, $completionTokens), $estimated);
    }

    public function merge(self $other): self
    {
        $prompt = max($this->promptTokens, $other->promptTokens);
        $completion = max($this->completionTokens, $other->completionTokens);
        $estimated = $this->estimated || $other->estimated;
        if ($other->promptTokens > 0 || $other->completionTokens > 0) {
            return new self($prompt, $completion, $estimated);
        }
        return $this;
    }

    /**
     * @param list<array{role:string, content:string}> $messages
     */
    public static function estimateFromMessages(array $messages, string $completion): self
    {
        $promptChars = 0;
        foreach ($messages as $msg) {
            $promptChars += strlen((string) ($msg['content'] ?? ''));
        }
        return new self(
            max(1, (int) ceil($promptChars / 4)),
            max(0, (int) ceil(strlen($completion) / 4)),
            true,
        );
    }

    public static function estimateCompletionChars(int $chars): self
    {
        return new self(0, max(0, (int) ceil($chars / 4)), true);
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function fromProviderJson(array $data): ?self
    {
        $usage = $data['usage'] ?? null;
        if (is_array($usage)) {
            $prompt = (int) ($usage['prompt_tokens'] ?? $usage['input_tokens'] ?? 0);
            $completion = (int) ($usage['completion_tokens'] ?? $usage['output_tokens'] ?? 0);
            if ($prompt > 0 || $completion > 0) {
                return new self($prompt, $completion, false);
            }
        }

        $prompt = (int) ($data['prompt_eval_count'] ?? 0);
        $completion = (int) ($data['eval_count'] ?? 0);
        if ($prompt > 0 || $completion > 0) {
            return new self($prompt, $completion, false);
        }

        return null;
    }

    /**
     * @return array{promptTokens:int, completionTokens:int, totalTokens:int, estimated:bool}
     */
    public function toPublicArray(): array
    {
        return [
            'promptTokens' => $this->promptTokens,
            'completionTokens' => $this->completionTokens,
            'totalTokens' => $this->total(),
            'estimated' => $this->estimated,
        ];
    }
}
