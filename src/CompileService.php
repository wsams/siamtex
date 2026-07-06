<?php

declare(strict_types=1);

namespace SiamTeX;

use RuntimeException;

final class CompileService
{
    public function __construct(private ProjectService $projects)
    {
    }

    /**
     * @return array{status:string, exitCode:?int, durationMs:int, log:string, diagnostics:list<array>, hasPdf:bool, buildId:int, entry:string}
     */
    public function compile(array $project, ?string $entry = null): array
    {
        $work = Config::tmpDir() . '/job-' . $project['id'] . '-' . bin2hex(random_bytes(4));
        if (!mkdir($work, 0770, true) && !is_dir($work)) {
            throw new RuntimeException('Could not create work directory.');
        }

        $started = (int) floor(microtime(true) * 1000);
        $log = '';
        $exitCode = null;
        $status = 'error';
        $hasPdf = false;

        try {
            $this->projects->materialize($project, $work);
            $main = $this->projects->resolveCompileEntry($project, $entry);
            $engine = $project['engine'] ?: 'pdflatex';
            $pdfName = preg_replace('/\\.tex$/i', '', $main) . '.pdf';

            $uid = posix_geteuid();
            $gid = posix_getegid();
            $image = Config::dockerImage();
            $mem = Config::compileMemory();
            $timeout = Config::compileTimeoutSeconds();

            $cmd = [
                Config::dockerBinary(), 'run', '--rm',
                '--network=none',
                '--memory=' . $mem,
                '--cpus=1',
                '--read-only',
                '--tmpfs', '/tmp:size=128m,mode=1777',
                '--tmpfs', '/home/texuser:size=64m,uid=' . $uid . ',gid=' . $gid . ',mode=1777',
                '--security-opt', 'no-new-privileges',
                '--user', $uid . ':' . $gid,
                '-e', 'HOME=/home/texuser',
                '-e', 'TEXMFVAR=/home/texuser/texmf-var',
                '-v', $work . ':/work',
                '-w', '/work',
                $image,
                '-' . $this->latexmkEngineFlag($engine),
                '-interaction=nonstopmode',
                '-halt-on-error',
                $main,
            ];

            $descriptors = [
                0 => ['pipe', 'r'],
                1 => ['pipe', 'w'],
                2 => ['pipe', 'w'],
            ];
            $proc = proc_open($cmd, $descriptors, $pipes, null, null);
            if (!is_resource($proc)) {
                throw new RuntimeException('Failed to start compile worker.');
            }
            fclose($pipes[0]);

            $stdout = '';
            $stderr = '';
            $deadline = microtime(true) + $timeout;
            stream_set_blocking($pipes[1], false);
            stream_set_blocking($pipes[2], false);

            while (true) {
                $stdout .= stream_get_contents($pipes[1]) ?: '';
                $stderr .= stream_get_contents($pipes[2]) ?: '';
                $statusProc = proc_get_status($proc);
                if (!$statusProc['running']) {
                    $exitCode = $statusProc['exitcode'];
                    break;
                }
                if (microtime(true) > $deadline) {
                    proc_terminate($proc, 9);
                    $exitCode = 124;
                    $stderr .= "\nCompile timed out after {$timeout}s.\n";
                    break;
                }
                usleep(50000);
            }
            $stdout .= stream_get_contents($pipes[1]) ?: '';
            $stderr .= stream_get_contents($pipes[2]) ?: '';
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);

            $logFile = $work . '/' . preg_replace('/\\.tex$/i', '', $main) . '.log';
            $fileLog = is_file($logFile) ? (string) file_get_contents($logFile) : '';
            $log = trim($fileLog . "\n" . $stdout . "\n" . $stderr);

            $pdfPath = $work . '/' . $pdfName;
            if (is_file($pdfPath) && filesize($pdfPath) > 0) {
                $this->projects->storePdf($project, (string) file_get_contents($pdfPath), $main);
                $hasPdf = true;
                $status = ($exitCode === 0) ? 'ok' : 'ok_with_warnings';
            } else {
                $status = 'error';
            }
        } finally {
            $this->rrmdir($work);
        }

        $duration = (int) floor(microtime(true) * 1000) - $started;
        $diagnostics = LogParser::parse($log);
        $buildId = $this->projects->saveBuild(
            $project['id'],
            $main,
            $status,
            $project['engine'],
            $exitCode,
            $duration,
            $log,
            $diagnostics
        );
        $this->projects->touchProject($project['id']);

        return [
            'status' => $status,
            'exitCode' => $exitCode,
            'durationMs' => $duration,
            'log' => $log,
            'diagnostics' => $diagnostics,
            'hasPdf' => $hasPdf,
            'buildId' => $buildId,
            'entry' => $main,
        ];
    }

    private function latexmkEngineFlag(string $engine): string
    {
        return match ($engine) {
            'xelatex' => 'xelatex',
            'lualatex' => 'lualatex',
            default => 'pdf',
        };
    }

    private function rrmdir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $file) {
            $path = $file->getPathname();
            if ($file->isDir()) {
                @rmdir($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
