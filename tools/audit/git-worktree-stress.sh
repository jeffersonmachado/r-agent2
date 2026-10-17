#!/usr/bin/env bash
# Stress concorrente de git worktree no MESMO repositório.
#
# Objetivo: reproduzir a contenção descrita em DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA
# ("CONTENCAO NO GIT"). Cria e remove worktrees em paralelo enquanto a suíte real
# do Router roda. Não toca no working tree principal (tudo em /tmp).
set -u
ROOT="${1:-/opt/results/ria/r-agent2}"
DURATION="${2:-60}"
STAMP="stress-$$"
END=$(( $(date +%s) + DURATION ))
N=0
FAIL=0

cd "$ROOT" || exit 1
while [ "$(date +%s)" -lt "$END" ]; do
  N=$((N + 1))
  dir="/tmp/wt-${STAMP}-${N}"
  if git worktree add --detach "$dir" HEAD >/dev/null 2>&1; then
    git worktree remove --force "$dir" >/dev/null 2>&1 || { git worktree prune >/dev/null 2>&1; }
  else
    FAIL=$((FAIL + 1))
  fi
done
git worktree prune >/dev/null 2>&1
echo "STRESS worktrees=$N falhas_de_add=$FAIL duracao=${DURATION}s"
