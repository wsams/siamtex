<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

final class AiChatResult
{
    public function __construct(
        public readonly string $content,
        public readonly AiUsage $usage,
        public readonly ?string $finishReason = null,
    ) {
    }

    public function wasTruncated(): bool
    {
        return $this->finishReason === 'length';
    }
}
