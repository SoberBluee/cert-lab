#!/usr/bin/env bash
# Exam-like shell environment for root and ubuntu. Safe to run repeatedly.
set -euo pipefail

MARKER="# >>> cka-lab exam environment >>>"

for home in /root /home/ubuntu; do
  if ! grep -qF "$MARKER" "$home/.bashrc" 2>/dev/null; then
    # Completion turns on in the first shell after kubectl is installed (the os image has none).
    cat >> "$home/.bashrc" <<'EOF'
# >>> cka-lab exam environment >>>
if command -v kubectl >/dev/null; then
  source <(kubectl completion bash)
  complete -o default -F __start_kubectl k
fi
alias k=kubectl
export do="--dry-run=client -o yaml"
export now="--force --grace-period 0"
# <<< cka-lab exam environment <<<
EOF
  fi
  printf 'set tabstop=2\nset expandtab\nset shiftwidth=2\n' > "$home/.vimrc"
done
chown ubuntu:ubuntu /home/ubuntu/.bashrc /home/ubuntu/.vimrc
