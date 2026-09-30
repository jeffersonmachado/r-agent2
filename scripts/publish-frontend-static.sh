#!/usr/bin/env bash
#
# publish-frontend-static.sh — publica o build do frontend no DocumentRoot do
# Apache de produção (rap.results.com.br) de forma reprodutível.
#
# Por que este script existe (medido em 2026-09-30):
#   - Em produção o site NÃO é servido pelo container `frontend` (nginx :8086) e
#     sim ESTATICAMENTE pelo container `secure-httpd`, a partir de /var/www/r-agent2
#     (camada de escrita do container — não há volume; ver RISCO abaixo).
#   - O build do container (`frontend/Dockerfile`) usa VITE_BASE_PATH=/r-agent2/ e
#     NÃO serve para este vhost, que publica na RAIZ: o index.html gerado pede
#     /r-agent2/assets/... e cada asset volta como HTML (tela em branco).
#     O build correto AQUI é base "/" + API sob /r-agent2/api/.
#   - O config.json do ambiente (basePath/apiBaseUrl/wsUrl) vive no DocumentRoot e
#     NÃO pode ser sobrescrito pelo do build — este script o preserva.
#
# RISCO conhecido: /var/www/r-agent2 não é volume/bind. Recriar o container
# `secure-httpd` (compose do projeto infra) apaga o site publicado; por isso todo
# publish gera backup no host antes de escrever.
#
# Uso:
#   scripts/publish-frontend-static.sh [--host HOST] [--user USER] [--dir DIR]
#                                      [--skip-build] [--no-backup] [--dry-run]
#
# Pré-requisitos: build local (npm) disponível e acesso SSH por chave ao host.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REMOTE_HOST="${REMOTE_HOST:-10.10.2.30}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/results/ria/r-agent2}"
APACHE_CONTAINER="${APACHE_CONTAINER:-secure-httpd}"
DOCROOT="${DOCROOT:-/var/www/r-agent2}"
# O container do Apache publica as portas 80/18443 em um IP dedicado do host
# (medido: 10.10.2.60), não em 127.0.0.1 — as verificações usam este alvo.
PUBLIC_HOST="${PUBLIC_HOST:-10.10.2.60}"
STAGE_DIR="${STAGE_DIR:-/tmp/r-agent2-frontend-stage}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups-www}"
API_PREFIX="/r-agent2/api"
VHOST_NAME="rap.results.com.br"

SKIP_BUILD=false
DO_BACKUP=true
DRY_RUN=false

usage() {
    cat <<'EOF'
Publica o build do frontend no DocumentRoot do Apache de produção.

Uso: scripts/publish-frontend-static.sh [opções]

Opções:
  --host HOST     Host remoto (default: $REMOTE_HOST / env REMOTE_HOST)
  --user USER     Usuário SSH (default: $REMOTE_USER / env REMOTE_USER)
  --dir DIR       Diretório do repositório no host (default: /opt/results/ria/r-agent2)
  --skip-build    Reaproveita frontend/dist existente (não roda npm run build)
  --no-backup     Não gera backup do DocumentRoot antes de publicar
  --dry-run       Mostra o que seria feito e sai sem alterar nada
  -h|--help       Esta ajuda

O build é feito com VITE_BASE_PATH=/ e VITE_API_BASE_URL=/r-agent2/api, que é o
contrato do vhost de produção (site na raiz + API sob prefixo dedicado).
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host) REMOTE_HOST="$2"; shift 2 ;;
        --user) REMOTE_USER="$2"; shift 2 ;;
        --dir) REMOTE_DIR="$2"; shift 2 ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        --no-backup) DO_BACKUP=false; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Opção desconhecida: $1" >&2; usage >&2; exit 1 ;;
    esac
done

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=no -o ServerAliveInterval=15)
SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"
remote() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }

section() { echo ""; echo "=== $* ==="; }
info() { echo "  $*"; }

TS="$(date +%Y%m%d-%H%M%S)"
DIST_DIR="${ROOT_DIR}/frontend/dist"

section "Publicação do frontend estático"
info "host:       ${REMOTE_HOST}"
info "container:  ${APACHE_CONTAINER}:${DOCROOT}"
info "build:      VITE_BASE_PATH=/  VITE_API_BASE_URL=${API_PREFIX}"
info "dry-run:    ${DRY_RUN}"

# ---------------------------------------------------------------- 1) build local
if [[ "$SKIP_BUILD" == true ]]; then
    section "1) Build local (pulado: --skip-build)"
    [[ -f "${DIST_DIR}/index.html" ]] || { echo "ERRO: ${DIST_DIR}/index.html ausente; rode sem --skip-build" >&2; exit 1; }
else
    section "1) Build local"
    if [[ "$DRY_RUN" == true ]]; then
        info "[dry-run] cd frontend && VITE_BASE_PATH=/ VITE_API_BASE_URL=${API_PREFIX} npm run build"
    else
        ( cd "${ROOT_DIR}/frontend" && VITE_BASE_PATH=/ VITE_API_BASE_URL="${API_PREFIX}" npm run build >/tmp/publish-frontend-build.log 2>&1 ) \
            || { echo "ERRO: build falhou (ver /tmp/publish-frontend-build.log)" >&2; tail -20 /tmp/publish-frontend-build.log >&2; exit 1; }
        info "build concluído"
    fi
fi

# ------------------------------------------------- 2) sanidade do artefato gerado
section "2) Sanidade do build"
if [[ "$DRY_RUN" == false ]]; then
    INDEX="${DIST_DIR}/index.html"
    [[ -f "$INDEX" ]] || { echo "ERRO: index.html ausente em ${DIST_DIR}" >&2; exit 1; }

    # A base precisa ser a RAIZ: /r-agent2/assets/... quebra este vhost.
    if grep -q 'src="/r-agent2/assets/' "$INDEX"; then
        echo "ERRO: build com base /r-agent2/ — publicar isso deixa a página em branco." >&2
        echo "      Refaça o build com VITE_BASE_PATH=/ (sem --skip-build)." >&2
        exit 1
    fi
    grep -q 'src="/assets/index-' "$INDEX" || { echo "ERRO: index.html não referencia /assets/index-*.js" >&2; exit 1; }

    # A base da API precisa ser o prefixo dedicado.
    if ! grep -rqs "${API_PREFIX}" "${DIST_DIR}/assets"; then
        echo "ERRO: bundle não contém '${API_PREFIX}' — as chamadas de API cairiam no fallback SPA (HTML)." >&2
        exit 1
    fi

    CONFIG_PAGE_COUNT=$(ls "${DIST_DIR}"/assets/ConfigPage-*.js 2>/dev/null | wc -l | tr -d ' ')
    info "index.html -> $(grep -o 'src="/assets/index-[^"]*"' "$INDEX" | head -1)"
    info "assets com '${API_PREFIX}': OK"
    info "chunks ConfigPage: ${CONFIG_PAGE_COUNT}"
else
    info "[dry-run] validaria index.html (base /), presença de ${API_PREFIX} e chunks"
fi

if [[ "$DRY_RUN" == true ]]; then
    section "3) Publicação (dry-run: nada alterado)"
    info "geraria backup em ${BACKUP_DIR}/pre-publish-${TS} (se --no-backup não for usado)"
    info "enviaria ${DIST_DIR} -> ${SSH_TARGET}:${STAGE_DIR}"
    info "docker cp ${STAGE_DIR}/. ${APACHE_CONTAINER}:${DOCROOT}/"
    info "restauraria config.json/features.json do ambiente"
    info "apachectl configtest && apachectl graceful"
    echo ""
    exit 0
fi

# ------------------------------------------------------------------ 3) backup
if [[ "$DO_BACKUP" == true ]]; then
    section "3) Backup do DocumentRoot"
    remote "mkdir -p '${BACKUP_DIR}' && rm -rf '${BACKUP_DIR}/pre-publish-${TS}' && mkdir -p '${BACKUP_DIR}/pre-publish-${TS}' && docker cp '${APACHE_CONTAINER}:${DOCROOT}' '${BACKUP_DIR}/pre-publish-${TS}/' && ls -d '${BACKUP_DIR}/pre-publish-${TS}' && du -sh '${BACKUP_DIR}/pre-publish-${TS}'" \
        | tail -3
    info "backup: ${BACKUP_DIR}/pre-publish-${TS}"
else
    section "3) Backup (pulado: --no-backup)"
fi

# --------------------------------------------------------------- 4) transferência
section "4) Transferência do build"
tar czf - -C "${DIST_DIR}" . | remote "rm -rf '${STAGE_DIR}' && mkdir -p '${STAGE_DIR}' && tar xzf - -C '${STAGE_DIR}' && echo STAGE_OK && ls '${STAGE_DIR}' | head -5"

# ----------------------------------------------------------------- 5) publicação
section "5) Publicação no DocumentRoot"
remote "docker cp '${APACHE_CONTAINER}:${DOCROOT}/config.json' /tmp/config-env.json && docker cp '${APACHE_CONTAINER}:${DOCROOT}/features.json' /tmp/features-env.json && echo CONFIG_ENV_SALVO"
remote "docker cp '${STAGE_DIR}/.' '${APACHE_CONTAINER}:${DOCROOT}/' && echo COPY_OK"
remote "docker cp /tmp/config-env.json '${APACHE_CONTAINER}:${DOCROOT}/config.json' && docker cp /tmp/features-env.json '${APACHE_CONTAINER}:${DOCROOT}/features.json' && echo CONFIG_ENV_RESTAURADO"
info "config.json de runtime preservado (basePath/apiBaseUrl/wsUrl do ambiente)"

# ------------------------------------------------------------------ 6) reload
section "6) Reload do Apache"
remote "docker exec '${APACHE_CONTAINER}' apachectl configtest" | tail -1
remote "docker exec '${APACHE_CONTAINER}' apachectl graceful" | tail -1 || true
sleep 3

# --------------------------------------------------------------- 7) verificação
section "7) Verificação pós-publicação"
INDEX_REMOTE=$(remote "docker exec '${APACHE_CONTAINER}' sh -c \"grep -o 'src=\\\"/assets/index-[^\\\"]*\\\"' '${DOCROOT}/index.html' | head -1\"" | tr -d '\r' || true)
info "index.html no ar: ${INDEX_REMOTE}"

FAIL=0
check() {
    local path="$1" expect="$2" desc="$3"
    local out
    out=$(remote "curl -s -o /dev/null -w '%{http_code} %{content_type}' -H 'Host: ${VHOST_NAME}' 'http://${PUBLIC_HOST}${path}' --max-time 15" | tr -d '\r' || true)
    if [[ "$out" == *"$expect"* ]]; then
        info "OK   ${desc}: ${path} -> ${out}"
    else
        echo "  FALHA ${desc}: ${path} -> ${out} (esperado conter '${expect}')" >&2
        FAIL=1
    fi
}

check "/" "200 text/html" "raiz (SPA)"
check "/r-agent2/api/version" "200 application/json" "API pelo prefixo"
check "/config" "200 text/html" "página SPA (deep-link)"

ASSET_PATH="${INDEX_REMOTE#src=\"}"; ASSET_PATH="${ASSET_PATH%\"}"
if [[ -n "$ASSET_PATH" ]]; then
    check "$ASSET_PATH" "200" "asset do index"
fi

remote "rm -rf '${STAGE_DIR}'" >/dev/null 2>&1 || true

section "Resultado"
if [[ "$FAIL" -eq 0 ]]; then
    echo "  PUBLICAÇÃO CONCLUÍDA — site servindo o novo build com o config de ambiente preservado."
    echo "  Backup: ${BACKUP_DIR}/pre-publish-${TS} (host)"
    echo ""
    echo "  Lembrete: navegadores com service worker podem continuar servindo o build"
    echo "  anterior até o SW atualizar (limpe caches/SW ao validar em browser real)."
else
    echo "  PUBLICAÇÃO COM FALHA DE VERIFICAÇÃO — restaure o backup:" >&2
    echo "    ssh ${SSH_TARGET} 'docker cp ${BACKUP_DIR}/pre-publish-${TS}/r-agent2/. ${APACHE_CONTAINER}:${DOCROOT}/ && docker exec ${APACHE_CONTAINER} apachectl graceful'" >&2
    exit 1
fi
