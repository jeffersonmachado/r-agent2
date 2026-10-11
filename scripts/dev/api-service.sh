#!/usr/bin/env bash
#
# Compatibilidade: este caminho era a supervisão SÓ da API. A implementação foi
# generalizada para api + rag + frontend em `scripts/dev/service.sh` (uma única
# implementação — duas cópias divergiriam, que é justamente o defeito que o repo
# combate). Este wrapper existe porque smoke, converge e start-dev chamam este
# caminho; ele delega com o serviço fixado em `api`.
#
# Uso: bash scripts/dev/api-service.sh <install|start|stop|restart|status|logs|check|uninstall> [extra]
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$AQUI/service.sh" "${1:-}" api "${2:-}"
