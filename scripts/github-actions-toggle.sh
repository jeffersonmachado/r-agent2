#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOWS_DIR="$ROOT_DIR/.github/workflows"
DISABLED_DIR="$ROOT_DIR/.github/workflows-disabled"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[gh-actions-toggle]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err() { echo -e "${RED}[fail]${NC} $*" >&2; }

usage() {
  cat <<'EOF'
Usage:
  ./scripts/github-actions-toggle.sh <disable|enable|status>

Commands:
  disable  Move workflows from .github/workflows to .github/workflows-disabled
  enable   Move workflows from .github/workflows-disabled to .github/workflows
  status   Show current state
EOF
}

count_files() {
  local dir="$1"
  shopt -s nullglob
  local files=("$dir"/*.yml "$dir"/*.yaml)
  echo "${#files[@]}"
}

disable_actions() {
  mkdir -p "$DISABLED_DIR"
  shopt -s nullglob
  local files=("$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml)

  if [[ ${#files[@]} -eq 0 ]]; then
    warn "No active workflow files found in .github/workflows"
    return 0
  fi

  for f in "${files[@]}"; do
    mv "$f" "$DISABLED_DIR/"
  done

  ok "GitHub Actions disabled (${#files[@]} workflow files moved)"
}

enable_actions() {
  mkdir -p "$WORKFLOWS_DIR"
  shopt -s nullglob
  local files=("$DISABLED_DIR"/*.yml "$DISABLED_DIR"/*.yaml)

  if [[ ${#files[@]} -eq 0 ]]; then
    warn "No disabled workflow files found in .github/workflows-disabled"
    return 0
  fi

  for f in "${files[@]}"; do
    mv "$f" "$WORKFLOWS_DIR/"
  done

  ok "GitHub Actions enabled (${#files[@]} workflow files restored)"
}

status_actions() {
  local active_count disabled_count
  active_count="$(count_files "$WORKFLOWS_DIR")"
  disabled_count="$(count_files "$DISABLED_DIR")"

  info "Status"
  echo "  active workflows: $active_count"
  echo "  disabled workflows: $disabled_count"

  if [[ "$active_count" -gt 0 ]]; then
    ok "GitHub Actions: ENABLED"
  else
    warn "GitHub Actions: DISABLED"
  fi
}

main() {
  local cmd="${1:-status}"

  case "$cmd" in
    disable)
      disable_actions
      ;;
    enable)
      enable_actions
      ;;
    status)
      status_actions
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      err "Unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
