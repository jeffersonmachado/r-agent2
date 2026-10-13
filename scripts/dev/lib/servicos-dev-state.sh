#!/usr/bin/env bash
# =============================================================================
# scripts/dev/lib/servicos-dev-state.sh
#
# Política COMPARTILHADA de estado dos serviços de dev (api/rag/frontend).
#
# POR QUE EXISTE (defeito medido em 2026-10-11, prova de execução do smoke):
#   o teardown do smoke decidia "parar" por `estado != active && health == '000'`.
#   Com o RAG já PARADO, o health vinha VAZIO (curl sem resposta) e a comparação
#   com a string "000" falhava — então o serviço que já estava desligado era
#   "parado" e depois RELIGADO pelo restore. O smoke agendado mudava o estado do
#   ambiente do operador (critério 4 da Fase 2 violado), sem nenhum erro visível.
#
# A decisão é explícita e testável (tabela de estados), em vez de espalhada em
# condicionais de script:
#
#   deve_parar <estado> <health>
#     0 (parar)  → unidade active/activating/reloading, OU health 2xx/3xx/4xx
#                  (processo no ar mesmo sem unidade — é isto que segura a porta)
#     1 (preservar) → qualquer outra combinação (inclui inactive/000, vazio,
#                  sem_unidade), porque parar o que já estava parado só cria
#                  risco de religar o que o operador deixou desligado.
#
# `sem_unidade` nunca é parado: sem unidade não há restauração determinística.
#
# Uso: source este arquivo (é livre de efeitos colaterais).
# =============================================================================

# Unidades systemd --user por serviço.
dev_unidade() {
  case "$1" in
    api) printf 'ragent2-api-dev' ;;
    rag) printf 'ragent2-rag-dev' ;;
    frontend) printf 'ragent2-frontend-dev' ;;
    *) return 1 ;;
  esac
}

# Health respondeu? (2xx/3xx/4xx = servidor no ar; 5xx também conta: o processo
# está vivo e segurando a porta — é isso que impede o stack prod-like de subir.)
health_ocupado() {
  case "${1:-}" in
    2*|3*|4*) return 0 ;;
  esac
  return 1
}

# Deve PARAR este serviço para liberar a porta?
deve_parar() {
  local estado="${1:-}" health="${2:-}"
  case "$estado" in
    sem_unidade) return 1 ;;
    active|activating|reloading) return 0 ;;
  esac
  health_ocupado "$health"
}

# Deve RESTAURAR (religar) este serviço ao fim? Só o que ESTE processo parou.
deve_restaurar() {
  [ "${1:-}" = "parado" ]
}

# Descrição legível do estado, para log (evita "health=" vazio no log).
descrever_estado() {
  local estado="${1:-}" health="${2:-}"
  printf 'unidade=%s health=%s' "${estado:-desconhecido}" "${health:-000}"
}

# ── Identidade de QUEM responde na porta (H9) ──────────────────────────────────
#
# Defeito medido em 2026-10-13, por prova de execução do smoke agendado:
# o `restore_dev_state` declarou "[api] RESTAURADO (health=200)" enquanto quem
# respondia em 127.0.0.1:3001 era o CONTAINER `chatbot-api` da stack prod-like —
# a unidade de dev estava parada. `health` prova que ALGUÉM responde; NÃO prova
# quem. Restaurar (ou parar) sem conferir identidade é falso verde: o ambiente do
# operador fica com a porta servida por outro processo/stack e a unidade de dev
# entra em loop de EADDRINUSE, sem nenhum erro aparecer no log.
#
# A identidade é decidida pelo ControlGroup da unidade (mesma semântica de
# `proc_no_cgroup_da_unidade` em scripts/dev/service.sh) e é FAIL-CLOSED: sem
# `ss`, sem cgroup legível ou sem PID escutando, a resposta é "NÃO comprovado".

# Porta TCP canônica de cada serviço de dev (fonte única — snapshot, restore e
# diagnóstico usam esta função em vez de repetir literais).
dev_porta() {
  case "$1" in
    api) printf '3001' ;;
    rag) printf '8001' ;;
    frontend) printf '5173' ;;
    *) return 1 ;;
  esac
}

# PIDs que ESCUTAM a porta TCP (vazio = ninguém). Saída observável: o chamador
# não pode distinguir "sem processo" de "sem ss" — por isso ambas as situações
# resultam em "identidade não comprovada" em porta_pertence_a_unidade.
dev_pids_na_porta() {
  local porta="${1:-}"
  [ -n "$porta" ] || return 0
  ss -ltnpH "sport = :$porta" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
}

# O PID pertence ao ControlGroup da unidade informada?
dev_pid_no_cgroup() {
  local pid="${1:-}" unidade="${2:-}" cg do_pid
  [ -n "$pid" ] && [ -n "$unidade" ] || return 1
  cg="$(systemctl --user show -p ControlGroup --value "$unidade" 2>/dev/null)"
  [ -n "$cg" ] || return 1
  do_pid="$(sed -n 's/^0:://p' "/proc/$pid/cgroup" 2>/dev/null | head -n1)"
  [ -n "$do_pid" ] || return 1
  [ "$do_pid" = "$cg" ]
}

# A porta do serviço é servida por um processo DA UNIDADE deste serviço?
# 0 = identidade COMPROVADA | 1 = outra origem ou indeterminado (fail-closed).
porta_pertence_a_unidade() {
  local svc="${1:-}" unidade porta pid
  unidade="$(dev_unidade "$svc")" || return 1
  porta="$(dev_porta "$svc")" || return 1
  for pid in $(dev_pids_na_porta "$porta"); do
    dev_pid_no_cgroup "$pid" "$unidade" && return 0
  done
  return 1
}
