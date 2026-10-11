#!/usr/bin/env bash
#
# Supervisão dos serviços de DESENVOLVIMENTO do r-agent2 (api, rag, frontend).
#
# PROBLEMA QUE ESTE SCRIPT ELIMINA
#   1. Serviço preso ao terminal morre quando o terminal é reaproveitado/limpo (o `&`
#      aplica-se à CADEIA inteira e o job leva SIGTERM): a queda é SILENCIOSA — o log
#      corta no meio, sem stack trace, e o proxy do Vite passa a devolver 500. Medido
#      em 2026-10-01 e 2026-10-11 com a API.
#   2. O smoke prod-like precisa das portas 3001/5173/8001 livres; matar por PID não
#      resolve quando existe supervisão (o systemd revive em segundos) e matar por
#      `grep` de linha de comando pode atingir OUTRA instalação do RAP.
#
# DESENHO
#   - Cada serviço tem UMA unidade systemd --user (Restart=always), renderizada de um
#     template versionado. Quem manda no serviço é a unidade.
#   - Identidade de instância: um processo só é tratado como "deste ambiente" quando o
#     `cwd` está dentro de ROOT. Linha de comando NÃO é identidade (a mesma
#     `api/server.js` existe em outra instalação) — e, se o `cwd` não for legível,
#     a resposta é NÃO mexer (fail-closed).
#
# Uso:
#   bash scripts/dev/service.sh <install|start|stop|restart|status|logs|check|uninstall> [servico] [extra]
#     servico: api | rag | frontend | all   (default: api)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
LOG_DIR="${RAGENT2_LOG_DIR:-$HOME/seal-logs}"

# ── Tabela de serviços ────────────────────────────────────────────────────────────
# Campos: unidade | diretório | template | log | health URL | descrição
servicos_disponiveis() { printf 'api rag frontend'; }

svc_unit() {
  case "$1" in
    api) printf 'ragent2-api-dev' ;;
    rag) printf 'ragent2-rag-dev' ;;
    frontend) printf 'ragent2-frontend-dev' ;;
    *) return 1 ;;
  esac
}

svc_dir() {
  case "$1" in
    api) printf '%s' "$ROOT" ;;
    rag) printf '%s/rag-service' "$ROOT" ;;
    frontend) printf '%s/frontend' "$ROOT" ;;
    *) return 1 ;;
  esac
}

svc_template() {
  case "$1" in
    api) printf '%s/scripts/dev/ragent2-api-dev.service.template' "$ROOT" ;;
    rag) printf '%s/scripts/dev/ragent2-rag-dev.service.template' "$ROOT" ;;
    frontend) printf '%s/scripts/dev/ragent2-frontend-dev.service.template' "$ROOT" ;;
    *) return 1 ;;
  esac
}

svc_log() {
  case "$1" in
    api) printf '%s/ragent2-api-dev.service.log' "$LOG_DIR" ;;
    rag) printf '%s/ragent2-rag-dev.service.log' "$LOG_DIR" ;;
    frontend) printf '%s/ragent2-frontend-dev.service.log' "$LOG_DIR" ;;
    *) return 1 ;;
  esac
}

svc_health() {
  case "$1" in
    api) printf 'http://127.0.0.1:3001/health' ;;
    rag) printf 'http://127.0.0.1:8001/health' ;;
    frontend) printf 'http://127.0.0.1:5173/' ;;
    *) return 1 ;;
  esac
}

svc_label() {
  case "$1" in
    api) printf 'API (node api/server.js)' ;;
    rag) printf 'RAG (uvicorn main:app)' ;;
    frontend) printf 'frontend (vite dev server)' ;;
    *) return 1 ;;
  esac
}

info() { printf '[service] %s\n' "$*"; }
warn() { printf '[service] AVISO: %s\n' "$*" >&2; }
fail() { printf '[service] ERRO: %s\n' "$*" >&2; exit 1; }

require_systemd() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl não encontrado — a supervisão exige systemd --user."
  systemctl --user show-environment >/dev/null 2>&1 \
    || fail "systemctl --user indisponível nesta sessão (sem D-Bus de usuário)."
}

# Caminhos ABSOLUTOS: a unidade não herda o PATH do shell (e /usr/bin/node é antigo,
# sem --env-file-if-exists — armadilha já medida neste repo).
resolve_bin() {
  local nome="$1" caminho
  caminho="$(command -v "$nome" || true)"
  [ -n "$caminho" ] || fail "$nome não encontrado no PATH."
  case "$caminho" in
    /*) printf '%s' "$caminho" ;;
    *) fail "não consegui resolver o caminho absoluto de $nome (recebi '$caminho')." ;;
  esac
}

render_unit() {
  local servico="$1"; shift
  local template destino
  template="$(svc_template "$servico")"
  destino="$UNIT_DIR/$(svc_unit "$servico").service"
  [ -f "$template" ] || fail "template ausente: $template"
  mkdir -p "$UNIT_DIR" "$(dirname "$(svc_log "$servico")")"
  # Substituição por `sed` com `|` como delimitador (caminhos têm `/`, não `|`).
  sed -e "s|{{ROOT}}|$ROOT|g" \
      -e "s|{{SERVICE_DIR}}|$(svc_dir "$servico")|g" \
      -e "s|{{LOG}}|$(svc_log "$servico")|g" \
      -e "s|{{NODE}}|$1|g" -e "s|{{NPM}}|$2|g" -e "s|{{UVICORN}}|$3|g" \
      "$template" > "$destino.tmp"
  mv "$destino.tmp" "$destino"
  info "unit renderizada: $destino"
}

main_pid() { systemctl --user show -p MainPID --value "$(svc_unit "$1")" 2>/dev/null || true; }

# ── Identidade de instância (H6) ────────────────────────────────────────────────
#
# Um PID só pertence a ESTA instalação quando o `cwd` está dentro de ROOT. Linha de
# comando é evidência FRACA: outra instalação do RAP na mesma máquina roda o mesmo
# `api/server.js` e seria morta por um `pgrep` ingênuo. `cwd` ilegível = NÃO mexer.
proc_pertence_ao_root() {
  local pid="$1" cwd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [ -n "$cwd" ] || return 1
  case "$cwd" in
    "$ROOT"|"$ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Um PID do SERVIÇO não é resíduo: `npm start`/`ExecStart` cria processos FILHOS
# (ex.: `sh -c vite …` + `node …/vite`) que casam o mesmo padrão de linha de
# comando do processo principal. Filhos do serviço vivem no MESMO ControlGroup da
# unidade — medido em 2026-10-11: o frontend aparecia com "2 resíduos" que eram
# justamente o `sh -c` e o `node vite` da própria unidade, e a versão anterior
# (que pulava apenas o MainPID) os MATARIA, derrubando o serviço que estava no ar.
proc_no_cgroup_da_unidade() {
  local pid="$1" servico="$2" cg cgroup_pid
  cg="$(systemctl --user show -p ControlGroup --value "$(svc_unit "$servico")" 2>/dev/null || true)"
  [ -n "$cg" ] || return 1
  cgroup_pid="$(sed -n 's/^0:://p' "/proc/$pid/cgroup" 2>/dev/null | head -n1)"
  [ -n "$cgroup_pid" ] || return 1
  [ "$cgroup_pid" = "$cg" ] && return 0
  # Fallback: descendente do MainPID (cgroup pode não estar legível em ambientes
  # sem cgroup v2 por processo).
  local atual="$pid" ppid i
  for i in 1 2 3 4 5; do
    ppid="$(awk '{print $4}' "/proc/$atual/stat" 2>/dev/null || true)"
    [ -n "$ppid" ] && [ "$ppid" != "0" ] || return 1
    [ "$ppid" = "$(main_pid "$servico")" ] && return 0
    atual="$ppid"
  done
  return 1
}

proc_cmdline() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true; }

# Processo do serviço rodando FORA da unidade (resíduo que segura a porta e faz o
# serviço novo morrer com EADDRINUSE). Só remove o que é DESTA instalação.
reap_strays() {
  local servico="$1" service_pid pid cmd cwd_kill=0
  service_pid="$(main_pid "$servico")"
  local padrao
  case "$servico" in
    api) padrao='api/server\.js' ;;
    rag) padrao='uvicorn main:app' ;;
    frontend) padrao='vite --configLoader' ;;
  esac
  for pid in $(pgrep -f "$padrao" 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    [ -n "$service_pid" ] && [ "$pid" = "$service_pid" ] && continue
    # Filho do próprio serviço (mesmo ControlGroup / descendente do MainPID) não é
    # resíduo — matá-lo derruba o serviço que está no ar.
    proc_no_cgroup_da_unidade "$pid" "$servico" && continue
    cmd="$(proc_cmdline "$pid")"
    case "$cmd" in *"$padrao"*) ;; *) continue ;; esac
    if ! proc_pertence_ao_root "$pid"; then
      warn "processo $pid casa '$padrao' mas NÃO pertence a $ROOT (cwd de outra instalação) — preservado"
      continue
    fi
    kill -TERM "$pid" 2>/dev/null || true
    info "[$servico] resíduo fora da unidade encerrado (pid $pid, cwd em $ROOT)"
    cwd_kill=$((cwd_kill + 1))
  done
  [ "$cwd_kill" -gt 0 ] && sleep 2 || true
}

reap_strays_report() {
  local servico="$1" service_pid pid cmd cnt=0 padrao
  service_pid="$(main_pid "$servico")"
  case "$servico" in
    api) padrao='api/server\.js' ;;
    rag) padrao='uvicorn main:app' ;;
    frontend) padrao='vite --configLoader' ;;
  esac
  for pid in $(pgrep -f "$padrao" 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    [ -n "$service_pid" ] && [ "$pid" = "$service_pid" ] && continue
    proc_no_cgroup_da_unidade "$pid" "$servico" && continue
    cmd="$(proc_cmdline "$pid")"
    case "$cmd" in *"$padrao"*) ;; *) continue ;; esac
    proc_pertence_ao_root "$pid" && cnt=$((cnt + 1))
  done
  printf '%s' "$cnt"
}

# ATENÇÃO (defeito medido em 2026-10-11): `curl ... || printf '000'` DUPLICA o código —
# o `-w '%{http_code}'` já imprime "000" quando a conexão falha, e o `||` acrescenta
# outro. O resultado "000000" não casa nenhum `case 2*|3*|4*` e quebra comparações
# ingênuas com a string "000". Aqui o valor é normalizado ANTES de sair.
health_code() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$(svc_health "$1")" 2>/dev/null)"
  [ -n "$code" ] || code="000"
  printf '%s' "$code"
}

esperar_health() {
  local servico="$1" tentativas="${2:-30}" i code
  for i in $(seq 1 "$tentativas"); do
    code="$(health_code "$servico")"
    case "$code" in 2*|3*|4*) return 0 ;; esac
    sleep 1
  done
  return 1
}

cmd_install() {
  local servico="$1"
  require_systemd
  local node_bin npm_bin uvicorn_bin
  node_bin="$(resolve_bin node)"
  npm_bin="$(resolve_bin npm)"
  if [ -x "$ROOT/rag-service/venv/bin/uvicorn" ]; then uvicorn_bin="$ROOT/rag-service/venv/bin/uvicorn"; else uvicorn_bin="$(resolve_bin uvicorn)"; fi
  render_unit "$servico" "$node_bin" "$npm_bin" "$uvicorn_bin"
  systemctl --user daemon-reload
  systemctl --user enable "$(svc_unit "$servico")" >/dev/null 2>&1 || true
  reap_strays "$servico"
  systemctl --user reset-failed "$(svc_unit "$servico")" >/dev/null 2>&1 || true
  systemctl --user restart "$(svc_unit "$servico")"
  if esperar_health "$servico" 30; then
    info "[$servico] $(svc_label "$servico") no ar sob systemd (health $(health_code "$servico")). Log: $(svc_log "$servico")"
    return 0
  fi
  fail "[$servico] não respondeu em 30s. Veja: journalctl --user -u $(svc_unit "$servico") -n 80"
}

cmd_start() {
  local servico="$1"
  require_systemd
  reap_strays "$servico"
  systemctl --user reset-failed "$(svc_unit "$servico")" >/dev/null 2>&1 || true
  systemctl --user start "$(svc_unit "$servico")"
  esperar_health "$servico" 30 || fail "[$servico] não respondeu após start."
  info "[$servico] no ar (health $(health_code "$servico"))"
}

# `stop` existe porque quem precisa da PORTA livre (o smoke prod-like) não pode apenas
# matar o processo: com Restart=always o systemd o revive em segundos e a porta volta a
# ficar ocupada — o consumidor falha e a causa fica invisível.
cmd_stop() {
  local servico="$1"
  require_systemd
  systemctl --user stop "$(svc_unit "$servico")"
  # Parar a UNIDADE não basta: um processo solto (rodando desde antes da unidade
  # existir) continua segurando a porta e o consumidor falha de forma invisível.
  # `reap_strays` só encerra processo desta instalação (cwd dentro de ROOT).
  reap_strays "$servico"
  info "[$servico] parado pela unidade ($(svc_health "$servico") liberado, residuos_fora_da_unidade=$(reap_strays_report "$servico"))"
}

cmd_restart() {
  local servico="$1"
  require_systemd
  reap_strays "$servico"
  systemctl --user reset-failed "$(svc_unit "$servico")" >/dev/null 2>&1 || true
  systemctl --user restart "$(svc_unit "$servico")"
  info "[$servico] reiniciado"
}

cmd_status() {
  local servico="$1"
  require_systemd
  printf '[service] %s (%s): %s | health=%s | residuos_fora_da_unidade=%s\n' \
    "$servico" "$(svc_label "$servico")" "$(systemctl --user is-active "$(svc_unit "$servico")")" \
    "$(health_code "$servico")" "$(reap_strays_report "$servico")"
}

cmd_logs() {
  local servico="$1" n="${2:-60}"
  tail -n "$n" "$(svc_log "$servico")" 2>/dev/null || info "sem log em $(svc_log "$servico")"
}

cmd_check() {
  local servico="$1"
  require_systemd
  local code
  code="$(health_code "$servico")"
  case "$code" in
    2*|3*|4*)
      if [ "$(reap_strays_report "$servico")" != "0" ]; then
        fail "[$servico] há processo FORA da unidade — rode: service.sh install $servico"
      fi
      info "[$servico] health=$code — OK"
      return 0 ;;
  esac
  info "[$servico] health=$code — restaurando via systemd"
  systemctl --user reset-failed "$(svc_unit "$servico")" >/dev/null 2>&1 || true
  reap_strays "$servico"
  systemctl --user start "$(svc_unit "$servico")"
  esperar_health "$servico" 30 || fail "[$servico] não consegui restaurar (health=$(health_code "$servico"))."
  info "[$servico] restaurado (health $(health_code "$servico"))"
}

cmd_uninstall() {
  local servico="$1"
  require_systemd
  systemctl --user disable --now "$(svc_unit "$servico")" >/dev/null 2>&1 || true
  rm -f "$UNIT_DIR/$(svc_unit "$servico").service"
  systemctl --user daemon-reload
  info "[$servico] unidade removida"
}

expandir_servicos() {
  case "$1" in
    all) servicos_disponiveis ;;
    '') printf 'api' ;;
    *) printf '%s' "$1" ;;
  esac
}

# Validação do serviço ANTES da expansão: `for alvo in $(expandir_servicos …)` roda a
# função em SUBSHELL, então um `fail` lá dentro só encerraria o subshell — o loop
# seguiria com lista vazia e o script sairia com sucesso (fail-closed de mentira,
# medido em 2026-10-11). A checagem tem de acontecer no shell principal.
validar_servico() {
  local s="${1:-}"
  [ -z "$s" ] && return 0
  [ "$s" = "all" ] && return 0
  svc_unit "$s" >/dev/null 2>&1 && return 0
  fail "serviço desconhecido: '$s' (use: $(servicos_disponiveis | tr ' ' '|')|all)"
}

COMANDO="${1:-}"
SERVICO="${2:-}"
EXTRA="${3:-}"

case "$COMANDO" in
  install|start|stop|restart|status|logs|check|uninstall) ;;
  *)
    cat <<'USAGE'
uso: bash scripts/dev/service.sh <install|start|stop|restart|status|logs|check|uninstall> [servico] [extra]

  servico: api | rag | frontend | all   (default: api)

  install    renderiza a unidade versionada, habilita e sobe (health check no fim)
  start      sobe pela unidade e espera health
  stop       PARA pela unidade (é isto que libera a porta; matar o PID não resolve:
             Restart=always revive o processo em segundos)
  restart    reinicia pela unidade
  status     estado da unidade, health e resíduos fora da unidade
  logs [n]   últimas n linhas do log do serviço
  check      health OK? se não, restaura pela unidade (exit != 0 se não conseguir)
  uninstall  remove a unidade

Identidade de instância: só é encerrado processo cujo cwd pertence a este repositório.
USAGE
    exit 2 ;;
esac

validar_servico "$SERVICO"

for alvo in $(expandir_servicos "$SERVICO"); do
  case "$COMANDO" in
    install) cmd_install "$alvo" ;;
    start) cmd_start "$alvo" ;;
    stop) cmd_stop "$alvo" ;;
    restart) cmd_restart "$alvo" ;;
    status) cmd_status "$alvo" ;;
    logs) cmd_logs "$alvo" "$EXTRA" ;;
    check) cmd_check "$alvo" ;;
    uninstall) cmd_uninstall "$alvo" ;;
  esac
done
