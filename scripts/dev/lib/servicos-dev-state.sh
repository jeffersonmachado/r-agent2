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
