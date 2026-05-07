#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo -e "${BLUE}[deploy-gate]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
fail() { echo -e "${RED}[fail]${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="official"
SKIP_INSTALL="false"
DEPLOY_CMD=""
ROLLBACK_CMD=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-gate.sh [options]

Options:
  --profile <official|quick>   Gate profile (default: official)
  --skip-install               Skip npm ci + frontend install
  --deploy-cmd "<command>"     Command to execute after gate PASS
  --rollback-cmd "<command>"   Optional rollback if deploy command fails
  -h, --help                   Show this help

Examples:
  ./scripts/deploy-gate.sh --profile quick
  ./scripts/deploy-gate.sh --deploy-cmd "npm run deploy:prod:nobuild"
  ./scripts/deploy-gate.sh --deploy-cmd "npm run deploy:prod" --rollback-cmd "npm run deploy:down && npm run deploy:up"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL="true"
      shift
      ;;
    --deploy-cmd)
      DEPLOY_CMD="${2:-}"
      shift 2
      ;;
    --rollback-cmd)
      ROLLBACK_CMD="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "$PROFILE" != "official" && "$PROFILE" != "quick" ]]; then
  fail "Invalid --profile '$PROFILE' (use official or quick)"
fi

command -v npm >/dev/null 2>&1 || fail "npm not found"
command -v node >/dev/null 2>&1 || fail "node not found"

step "Starting local release gate on server"
echo "  root: $ROOT_DIR"
echo "  profile: $PROFILE"
echo "  skip-install: $SKIP_INSTALL"
if [[ -n "$DEPLOY_CMD" ]]; then
  echo "  deploy-cmd: $DEPLOY_CMD"
else
  echo "  deploy-cmd: <none>"
fi
if [[ -n "$ROLLBACK_CMD" ]]; then
  echo "  rollback-cmd: $ROLLBACK_CMD"
else
  echo "  rollback-cmd: <none>"
fi

if [[ "$SKIP_INSTALL" != "true" ]]; then
  step "Installing root dependencies (npm ci)"
  npm ci
  ok "Root dependencies installed"

  step "Installing frontend dependencies"
  npm run frontend:install
  ok "Frontend dependencies installed"
else
  warn "Skipping dependency install by flag"
fi

if [[ "$PROFILE" == "official" ]]; then
  step "Running official release flow (validate + package + gate + go/no-go)"
  npm run system:release
  ok "Official release flow PASS"
else
  step "Running quick release gate flow"
  npm run system:validate
  npm run zip:release:clean
  npm run system:release-gate
  ok "Quick release gate PASS"
fi

if [[ -z "$DEPLOY_CMD" ]]; then
  ok "Gate finished. No deploy command configured; deployment remains blocked by default"
  exit 0
fi

step "Gate PASS. Running deploy command"
set +e
bash -lc "$DEPLOY_CMD"
DEPLOY_EXIT=$?
set -e

if [[ "$DEPLOY_EXIT" -eq 0 ]]; then
  ok "Deploy command completed successfully"
  exit 0
fi

warn "Deploy command failed with exit code $DEPLOY_EXIT"

if [[ -n "$ROLLBACK_CMD" ]]; then
  step "Running rollback command"
  set +e
  bash -lc "$ROLLBACK_CMD"
  ROLLBACK_EXIT=$?
  set -e
  if [[ "$ROLLBACK_EXIT" -eq 0 ]]; then
    ok "Rollback command completed"
  else
    warn "Rollback command failed with exit code $ROLLBACK_EXIT"
  fi
fi

fail "Deployment failed after gate PASS"
