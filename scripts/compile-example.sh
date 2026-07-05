#!/usr/bin/env bash
# Smoke-test the sandboxed TeX worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${ROOT}/work"
mkdir -p "$WORK"
cat > "$WORK/main.tex" <<'EOF'
\documentclass{article}
\title{SiamTeX}
\begin{document}
\maketitle
Containerized compile works.
\end{document}
EOF

# Host UID so output files are writable without root-owned mess in ./work
UID_GID="$(id -u):$(id -g)"

docker run --rm \
  --network=none \
  --memory=512m \
  --cpus=1 \
  --read-only \
  --tmpfs /tmp:size=128m,mode=1777 \
  --tmpfs /home/texuser:size=64m,uid="$(id -u)",gid="$(id -g)",mode=1777 \
  --security-opt no-new-privileges \
  --user "$UID_GID" \
  -e HOME=/home/texuser \
  -e TEXMFVAR=/home/texuser/texmf-var \
  -v "$WORK:/work" \
  -w /work \
  siamtex-tex-worker:local \
  -pdf -interaction=nonstopmode -halt-on-error main.tex

echo "PDF: $WORK/main.pdf"
