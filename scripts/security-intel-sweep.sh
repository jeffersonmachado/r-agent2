#!/usr/bin/env bash
#
# Ciclo completo da inteligência de versões/segurança, em UMA entrada.
#
# Por que existe: as etapas têm ORDEM que importa (descobrir antes de correlacionar,
# sincronizar a base antes de avaliar) e, espalhadas, alguém acaba rodando `scan`
# contra uma base velha e lendo um número que não significa nada. Aqui a ordem é
# fixa, o egress é opt-in explícito e cada falha para o ciclo.
#
# Egress: `advisories --scope installed` é a ÚNICA etapa que toca a rede e só roda
# quando o operador NÃO passa --no-egress. O worker contínuo (6h) mantém a correlação
# fresca sem rede; este script é para a atualização deliberada da base.
#
# Uso:
#   bash scripts/security-intel-sweep.sh [--no-egress] [--tenant system] [--rate 5]
#
# Exit: 0 = ciclo concluído; 1 = alguma etapa falhou (nomeada no log); 2 = uso inválido.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TENANT="system"
RATE="5"
EGRESS="1"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-egress) EGRESS="0"; shift ;;
    --tenant) TENANT="${2:-}"; shift 2 ;;
    --rate) RATE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "uso: bash scripts/security-intel-sweep.sh [--no-egress] [--tenant system] [--rate 5]" >&2; exit 2 ;;
  esac
done

if [ -z "$TENANT" ]; then
  echo "tenant vazio é inválido: o ciclo não assume tenant" >&2
  exit 2
fi

# Log FORA do workspace (regra do repo): estado transitório não entra no pacote.
LOG_DIR="${SECURITY_SWEEP_LOG_DIR:-$HOME/.local/state/ragent2-security-intel}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/sweep-$STAMP.log"

NODE_ENV_ARGS="--env-file-if-exists=.env"
run_step() {
  local label="$1"; shift
  local started_ms
  started_ms="$(date +%s%3N)"
  echo "=== $label ===" | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then
    echo "    ok ($(( $(date +%s%3N) - started_ms )) ms)" | tee -a "$LOG"
    return 0
  fi
  local code=$?
  echo "    FALHOU (exit $code) — ciclo interrompido; log: $LOG" | tee -a "$LOG"
  return 1
}

echo "ciclo de segurança: tenant=$TENANT egress=$EGRESS log=$LOG"

run_step "inventário (descoberta de componentes)" node $NODE_ENV_ARGS scripts/security-intel.js discover --persist --tenant "$TENANT" || exit 1
run_step "SBOM CycloneDX" node $NODE_ENV_ARGS scripts/security-intel.js sbom --persist --tenant "$TENANT" || exit 1

if [ "$EGRESS" = "1" ]; then
  run_step "base de advisories (OSV + KEV + EPSS, escopo instalado)" node $NODE_ENV_ARGS scripts/security-intel.js advisories --scope installed --rate "$RATE" --tenant "$TENANT" || exit 1
else
  echo "=== base de advisories: PULADA (--no-egress) — a correlação usa a base atual, que pode estar vencida ===" | tee -a "$LOG"
fi

run_step "correlação (inventário × advisories)" node $NODE_ENV_ARGS scripts/security-intel.js scan --scope installed --tenant "$TENANT" || exit 1
run_step "plano de correção" node $NODE_ENV_ARGS scripts/security-intel.js patches --tenant "$TENANT" || exit 1
run_step "fila de triagem" node $NODE_ENV_ARGS scripts/security-intel.js triage --tenant "$TENANT" || exit 1

# A decisão do gate é LIDA aqui, não inventada: o ciclo não "aprova" release.
echo "=== decisão do gate (informativa) ===" | tee -a "$LOG"
GATE_EXIT=0
npm run --silent validate:security-release-gate >>"$LOG" 2>&1 || GATE_EXIT=$?
if [ "$GATE_EXIT" -eq 0 ]; then
  echo "    gate: GO" | tee -a "$LOG"
else
  echo "    gate: NO_GO (exit $GATE_EXIT) — esperado enquanto houver bloqueio; decisão em reports/security-release-gate-report.json" | tee -a "$LOG"
fi

echo "ciclo concluído. relatórios: reports/security-intel-*.json, reports/security-release-gate-report.json"
echo "log: $LOG"
exit 0
