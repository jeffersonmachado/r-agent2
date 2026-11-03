#!/bin/sh
# Instala os hooks VERSIONADOS de scripts/git-hooks/ em .git/hooks/.
#
# Por que versionar: `.git/hooks/` não acompanha o clone. A prevenção da
# mutilação de worktree precisa existir em TODO clone, não só na estação onde o
# defeito foi medido. O instalador preserva um backup de qualquer hook local
# diferente antes de sobrescrever.
#
# Uso: bash scripts/install-git-hooks.sh
set -eu

cd "$(git rev-parse --show-toplevel)"

HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"

for hook in pre-commit pre-push; do
  src="scripts/git-hooks/$hook"
  dst="$HOOKS_DIR/$hook"

  if [ ! -f "$src" ]; then
    echo "[install-git-hooks] fonte ausente: $src" >&2
    exit 1
  fi

  if [ -f "$dst" ] && ! cmp -s "$src" "$dst"; then
    backup="$dst.local-backup-$(date +%Y%m%d-%H%M%S)"
    cp "$dst" "$backup"
    echo "[install-git-hooks] backup do hook local anterior: $backup"
  fi

  cp "$src" "$dst"
  chmod +x "$dst"
  echo "[install-git-hooks] instalado: $dst"
done
