#!/usr/bin/env bash
# =============================================================================
# verify-enterprise-governance.sh — Wrapper oficial para verificação rígida v2
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "$SCRIPT_DIR/verify-enterprise-governance-v2.sh" "$@"
