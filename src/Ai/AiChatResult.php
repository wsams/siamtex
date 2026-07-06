<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

final class AiChatResult
{
    public function __construct(
        public readonly string $content,
        public readonly AiUsage $usage,
    ) {
    }
}
