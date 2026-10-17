#!/usr/bin/env bash
# bug-closure-guard.sh — guarda de ENTRADA para processos extensivos
# (BUG CLOSURE FIRST, missão 2026-10-17 §4/§7/§13).
#
# Regra que esta guarda implementa:
#   "nenhum mecanismo de engenharia poderá executar processos de validação
#    extensivos, convergência completa, QA Waves massivas, replay de
#    certificação, selagem ou empacotamento enquanto existirem defeitos P0 ou P1
#    bloqueantes que ainda possam ser corrigidos."
#
# Uso (o chamador DEVE abortar quando esta função não retorna 0):
#
#   source scripts/governance/lib/bug-closure-guard.sh
#   exigir_elegibilidade CONVERGENCIA_COMPLETA "converge-governance.sh" || exit 3
#
# Não existe variável de ambiente que desligue esta guarda. Desligá-la exigiria
# editar este arquivo — e a alteração fica visível no diff e derruba o selo
# (sourceFingerprint), exatamente como qualquer outra mudança de governança.
#
# Códigos: 0 = autorizado, !=0 = recusado/erro (o chamador deve abortar).

# shellcheck shell=bash

RAP_ROOT_GUARDA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

exigir_elegibilidade() {
  local operacao="$1"
  local ator="${2:-$(basename "$0")}"
  local escopo="${3:-${BUG_CLOSURE_SCOPE:-}}"

  echo "[bug-closure-guard] verificando elegibilidade: operacao=${operacao} ator=${ator}${escopo:+ escopo=${escopo}}"

  local args=( "--operation" "$operacao" "--actor" "$ator" )
  if [ -n "$escopo" ]; then
    args+=( "--scope" "$escopo" )
  fi

  # `set -e` do chamador não pode derrubar o script no meio da checagem: o
  # código de saída é capturado explicitamente e o modo é restaurado depois.
  local saida codigo tinha_errexit=0
  case "$-" in *e*) tinha_errexit=1 ;; esac
  set +e
  saida="$(cd "$RAP_ROOT_GUARDA" && node scripts/governance/evaluate-execution-eligibility.js "${args[@]}" 2>&1)"
  codigo=$?
  if [ "$tinha_errexit" -eq 1 ]; then set -e; fi

  if [ "$codigo" -eq 0 ]; then
    echo "[bug-closure-guard] AUTORIZADO: ${operacao}"
    return 0
  fi
  echo "$saida" >&2
  echo "" >&2
  echo "[bug-closure-guard] RECUSADO (exit ${codigo}): ${operacao} não pode começar." >&2
  echo "[bug-closure-guard] Motivo: existem defeitos abertos que bloqueiam esta operação." >&2
  echo "[bug-closure-guard] Próximo passo correto: corrigir e VERIFICAR o defeito" >&2
  echo "[bug-closure-guard]   node scripts/governance/evaluate-execution-eligibility.js --operation CORRECAO_CODIGO" >&2
  echo "[bug-closure-guard]   npx jest <teste de regressão do defeito>" >&2
  echo "[bug-closure-guard]   (registrar regressionTest/verificationCommit na fila AI_MEMORY/hardening-queue.json)" >&2
  return "$codigo"
}

export -f exigir_elegibilidade 2>/dev/null || true
