#!/usr/bin/env bash

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
SCRIPT_DIR="$PROJECT_DIR/scripts"
source "$SCRIPT_DIR/release-payload-blocklist.sh"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DEFAULT_OUTPUT_DIR="$PROJECT_DIR/dist"
DEFAULT_ZIP_NAME="${PROJECT_NAME}-${TIMESTAMP}.zip"

REQUIRED_PROOF_ENTRIES=(
  'qa/smoke-evidence.json'
  'qa/l01-physical-queue-evidence.json'
  'qa/l02-ura-publish-rollback-evidence.json'
  'qa/l03-pbx-voice-tts-asr-evidence.json'
  'qa/l04-pbx-call-events-runtime-evidence.json'
  'qa/l05-chatpro-omnichannel-evidence.json'
  'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json'
  'qa/enterprise/human-handoff-full-validation.json'
  'qa/enterprise/human-handoff-screenshots.json'
  'qa/enterprise/pbx-voice-flow-prod-like.json'
  'qa/enterprise/pbx-asr-transcript.json'
  'qa/enterprise/pbx-tts-prompts.json'
  'qa/enterprise/pbx-recordings-metadata.json'
  'qa/enterprise/omnichannel-unified-replay.json'
  'qa/enterprise/omnichannel-crm-mutations.json'
  'qa/enterprise/digital-twin-snapshots.json'
  'qa/qa-waves-enterprise-governance.json'
  'governance/evidence-manifest.json'
  'governance/final-proof-report.json'
  'governance/package-validation-report.json'
  'governance/final-readiness-report.json'
  'governance/proof-signature.json'
  'governance/cleanup-proof.json'
)

REQUIRED_PROOF_REGEX='^(r-agent2/)?(qa/(smoke/?|smoke/prod-like/?|smoke-evidence\.json|l0[1-5]-.*-evidence\.json|smoke/prod-like/qa-waves-operational-prod-like-smoke\.json|enterprise/(human-handoff-full-validation|human-handoff-screenshots|pbx-voice-flow-prod-like|pbx-asr-transcript|pbx-tts-prompts|pbx-recordings-metadata|omnichannel-unified-replay|omnichannel-crm-mutations|digital-twin-snapshots)\.json|qa-waves-enterprise-governance\.json)|governance/(evidence-manifest|final-proof-report|package-validation-report|final-readiness-report|proof-signature|cleanup-proof)\.json)$'

OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
ZIP_NAME="$DEFAULT_ZIP_NAME"
INCLUDE_NODE_MODULES=false
INCLUDE_COVERAGE=false
INCLUDE_DIST=false
CUSTOM_INCLUDES=()
CUSTOM_EXCLUDES=()

usage() {
  cat <<'EOF'
Uso: ./scripts/generate-zip.sh [opcoes]

Opcoes:
  -o, --output-dir DIR       Diretorio de saida do ZIP (padrao: ./dist)
  -n, --name NOME.zip        Nome do arquivo ZIP
  -i, --include PADRAO       Include customizado no zip final (pode repetir)
  -e, --exclude PADRAO       Exclude customizado no staging (pode repetir)
      --include-node-modules Inclui node_modules
      --include-coverage     Inclui coverage
      --include-dist         Inclui dist/build
  -h, --help                 Exibe esta ajuda
EOF
}

require_arg() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo -e "${RED}Erro: ${flag} requer um valor.${NC}" >&2
    usage
    exit 1
  fi
}

ensure_zip_extension() {
  local name="$1"
  if [[ "$name" != *.zip ]]; then
    echo "${name}.zip"
    return
  fi
  echo "$name"
}

to_project_pattern() {
  local pattern="$1"
  local cleaned="${pattern#./}"
  if [[ "$cleaned" == "$PROJECT_NAME/"* ]]; then
    echo "$cleaned"
  else
    echo "${PROJECT_NAME}/${cleaned}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output-dir)
      require_arg "$1" "${2:-}"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -n|--name)
      require_arg "$1" "${2:-}"
      ZIP_NAME="$(ensure_zip_extension "$2")"
      shift 2
      ;;
    -i|--include)
      require_arg "$1" "${2:-}"
      CUSTOM_INCLUDES+=("$(to_project_pattern "$2")")
      shift 2
      ;;
    -e|--exclude)
      require_arg "$1" "${2:-}"
      CUSTOM_EXCLUDES+=("$2")
      shift 2
      ;;
    --include-node-modules)
      INCLUDE_NODE_MODULES=true
      shift
      ;;
    --include-coverage)
      INCLUDE_COVERAGE=true
      shift
      ;;
    --include-dist)
      INCLUDE_DIST=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Erro: opcao invalida '$1'${NC}" >&2
      usage
      exit 1
      ;;
  esac
done

for cmd in zip unzip rsync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${RED}Erro: comando '$cmd' nao encontrado.${NC}" >&2
    exit 1
  fi
done

mkdir -p "$OUTPUT_DIR"
ZIP_FILE="${OUTPUT_DIR}/${ZIP_NAME}"

if [[ -f "$ZIP_FILE" ]]; then
  rm -f "$ZIP_FILE"
fi

STAGE_ROOT="$(mktemp -d -t r-agent2-zip-stage-XXXXXX)"
STAGE_DIR="$STAGE_ROOT/$PROJECT_NAME"
cleanup() {
  rm -rf "$STAGE_ROOT"
}
trap cleanup EXIT

echo -e "${YELLOW}Gerando ZIP deterministico de ${PROJECT_NAME}...${NC}"
echo "Saida: $ZIP_FILE"

RSYNC_EXCLUDES=(
  '.git/'
  '.vscode/'
  '.idea/'
  '.env'
  '.env.*'
  '**/.env'
  '**/.env.*'
  'frontend/.env.production'
  '**/.env.production'
  '.token.env'
  '**/.token.env'
  '.wwebjs_auth/'
  '.wwebjs_cache/'
  'api/data/wa_sessions/'
  'logs/'
  'recordings/'
  'replays/'
  'frontend-e2e/playwright-report/'
  'frontend-e2e/test-results/'
  '**/playwright-report/'
  '**/test-results/'
  'qa/workspace-core/evidence/'
  'rpa/traces/'
  'rpa/screenshots/'
  'rpa/replay/'
  '**/*.trace.zip'
  '**/*.webm'
  '**/*.har'
  'tests/recordings/'
  'tests/screenshots/'
  'tests/videos/'
  'tests/rpa/screenshots/'
  'tests/rpa/reports/'
  'tests/rpa/replay/'
  'tmp_*'
  '**/tmp_*'
  'caches/'
  '**/caches/'
  'backups/'
  '**/backups/'
  'dumps/'
  '**/dumps/'
  'data/executions/'
  'qa/release-evidence/'
  'qa/smoke/'
  'qa/*-report.json'
  'qa/**/*-report.json'
  'qa/*-evidence.json'
  'qa/**/*-evidence.json'
  'qa/runtime-governance-report.json'
  'qa/system-validate-report.json'
  'qa/qa-waves/*-report.json'
  'qa-mesh/meshEvidence/'
  'qa-mesh/meshHistory/'
  'qa-mesh/isolated-run*/'
  'qa-mesh/meshReport.json'
  'qa-mesh/metrics.json'
  'qa-mesh/repairPlan.json'
  'qa-mesh/scheduler-state.json'
  'qa-mesh/system-validate/'
  'qa/deploy-report.json'
  # Somente reports/ da raiz é output gerado. scripts/reports/ contém source
  # coberto pelo sourceFingerprint e precisa existir na extração entregue.
  '/reports/'
  'artifacts/'
  'tmp/'
  'temp/'
  '.cache/'
  'dist-test/'
  'rag-service/.coverage'
  'rag-service/data/vector_store/'
  'rag-service/data/adaptive_learning/'
  'frontend/.vite/'
  '**/__pycache__/'
  '**/.pytest_cache/'
  '**/*.pyc'
  '**/*.pyo'
  '**/*.log'
  '**/*.swp'
  '**/*.swo'
  '**/*~'
  '**/.DS_Store'
  '**/Thumbs.db'
  '**/*.tsbuildinfo'
  '**/venv/'
  '**/env/'
  '**/.venv/'
  'rag-service/*.index'
  'rag-service/.cache/'
  'dist/*.zip'
)

while IFS= read -r pattern; do
  [[ -n "$pattern" ]] && RSYNC_EXCLUDES+=("$pattern")
done < <(release_payload_print_rsync_excludes)

if [[ "$INCLUDE_NODE_MODULES" == false ]]; then
  RSYNC_EXCLUDES+=('node_modules/' '**/node_modules/')
fi

if [[ "$INCLUDE_COVERAGE" == false ]]; then
  # Apenas relatórios de cobertura de teste (raiz e frontend). NÃO usar
  # padrão solto 'coverage/': ele casa qa/coverage/ (código-fonte do
  # Coverage Engine, exigido pela API em runtime).
  RSYNC_EXCLUDES+=('/coverage/' '/frontend/coverage/')
fi

if [[ "$INCLUDE_DIST" == false ]]; then
  RSYNC_EXCLUDES+=(
    'dist/'
    'build/'
    'frontend/dist/'
    'frontend/build/'
    'apps/mobile/dist/'
    'apps/mobile/build/'
    'apps/mobile/android/build/'
    'apps/mobile/ios/build/'
  )
fi

if [[ ${#CUSTOM_EXCLUDES[@]} -gt 0 ]]; then
  for pattern in "${CUSTOM_EXCLUDES[@]}"; do
    RSYNC_EXCLUDES+=("$pattern")
  done
fi

copy_required_proof_entries() {
  local rel_path
  local src_path
  local dest_path
  for rel_path in "${REQUIRED_PROOF_ENTRIES[@]}"; do
    src_path="$PROJECT_DIR/$rel_path"
    dest_path="$STAGE_DIR/$rel_path"
    [[ -f "$src_path" ]] || continue
    mkdir -p "$(dirname "$dest_path")"
    case "$rel_path" in
      'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json')
        node "$PROJECT_DIR/scripts/compact-proof-artifact.js" "$src_path" "$dest_path"
        ;;
      *)
        cp "$src_path" "$dest_path"
        ;;
    esac
  done
}

# ER-V1-SEAL-004 (Self-Proving Deliverable) — injeta o envelope de auditoria do Engineering
# Router V1 (gerado por `npm run engineering-router:audit-envelope:generate`, em
# dist/engineering-router-v1-audit-envelope/) dentro do ZIP entregue, em
# evidence/engineering-router-v1/. `dist/` é excluído do rsync acima (INCLUDE_DIST=false por
# padrão), então sem esta cópia explícita o envelope NUNCA chegaria ao artefato final — era
# exatamente o achado real confirmado na baseline desta missão (ZIP anterior sem
# evidence/engineering-router-v1/).
#
# Best-effort e não-bloqueante aqui de propósito: este script empacota o release do projeto
# INTEIRO, não só o Engineering Router, e gerar o envelope exige rodar os 25 itens de runtime
# evidence reais (minutos, sandbox Docker) — não é razoável forçar TODO empacotamento por este
# gate. Quem precisa da garantia forte de "o envelope está presente e válido dentro do ZIP" usa
# `npm run verify:engineering-router-v1-envelope -- <caminho-do-zip>` explicitamente antes de
# publicar o release (ex.: no pipeline oficial de selagem).
copy_engineering_router_v1_audit_envelope() {
  local src_dir="$PROJECT_DIR/dist/engineering-router-v1-audit-envelope"
  local dest_dir="$STAGE_DIR/evidence/engineering-router-v1"
  if [[ ! -d "$src_dir" ]]; then
    echo -e "${YELLOW}Aviso: dist/engineering-router-v1-audit-envelope/ ausente — ZIP gerado SEM o audit envelope do Engineering Router V1 (rode 'npm run engineering-router:audit-envelope:generate' antes se este release precisa da prova).${NC}" >&2
    return 0
  fi
  mkdir -p "$dest_dir"
  cp "$src_dir"/*.json "$dest_dir/"
}

RSYNC_ARGS=(-a)
for pattern in "${RSYNC_EXCLUDES[@]}"; do
  RSYNC_ARGS+=(--exclude "$pattern")
done

rsync "${RSYNC_ARGS[@]}" "$PROJECT_DIR/" "$STAGE_DIR/"
copy_required_proof_entries
copy_engineering_router_v1_audit_envelope
release_payload_remove_forbidden_from_tree "$STAGE_DIR"

(
  cd "$STAGE_ROOT"
  ZIP_CMD=(zip -qry "$ZIP_FILE" "$PROJECT_NAME")
  if [[ ${#CUSTOM_INCLUDES[@]} -gt 0 ]]; then
    ZIP_CMD+=(-i "${CUSTOM_INCLUDES[@]}")
  fi
  "${ZIP_CMD[@]}"
)

if [[ ! -f "$ZIP_FILE" ]]; then
  echo -e "${RED}Erro: falha ao gerar ZIP.${NC}" >&2
  exit 1
fi

if ! release_payload_validate_zip "$ZIP_FILE" "$ZIP_NAME"; then
  rm -f "$ZIP_FILE"
  echo -e "${RED}Erro: ZIP removido por contaminacao de payload proibida.${NC}" >&2
  exit 1
fi

ZIP_CONTENTS="$(unzip -Z1 "$ZIP_FILE")"
FORBIDDEN_REGEX=(
  '(^|/)node_modules/'
  '(^|/)\.env$'
  '(^|/)\.env\..+$'
  '\.env\.production$'
  # cobertura de teste (raiz/frontend); qa/coverage/ e tests/unit/coverage/
  # são código-fonte e permitidos (paths no ZIP têm prefixo r-agent2/)
  '^([^/]+/)?(frontend/)?coverage/'
  '(^|/)frontend-e2e/playwright-report/'
  '(^|/)frontend-e2e/test-results/'
  '(^|/)playwright-report/'
  '(^|/)test-results/'
  '(^|/)qa/workspace-core/evidence/'
  '(^|/)rpa/traces/'
  '(^|/)rpa/screenshots/'
  '(^|/)rpa/replay/'
  '\.trace\.zip$'
  '\.webm$'
  '\.har$'
  '(^|/)artifacts/'
  '(^|/)logs/'
  '(^|/)tmp/'
  '(^|/)temp/'
  '(^|/)\.cache/'
  '(^|/)dist-test/'
  '(^|/)qa/release-evidence/'
  '(^|/)qa/smoke/'
  '(^|/)qa/.*-report\.json$'
  '(^|/)qa/.*-evidence\.json$'
  '(^|/)qa/runtime-governance-report\.json$'
  '(^|/)qa/system-validate-report\.json$'
  '(^|/)qa-mesh/meshEvidence/'
  '(^|/)qa-mesh/meshHistory/'
  '(^|/)qa-mesh/(meshReport|metrics|repairPlan|scheduler-state)\.json$'
  '^([^/]+/)?reports/'
  '(^|/)rag-service/\.coverage$'
  '(^|/)rag-service/data/vector_store/'
  '(^|/)rag-service/data/adaptive_learning/'
  '(^|/)frontend/\.vite/'
  '(^|/)tmp_'
  '(^|/)api/data/wa_sessions/'
  '(^|/)qa-mesh/isolated-run[^/]*?/'
)

FOUND_FORBIDDEN=false
for pattern in "${FORBIDDEN_REGEX[@]}"; do
  matches="$(printf '%s\n' "$ZIP_CONTENTS" | grep -E "$pattern" | grep -Ev "$REQUIRED_PROOF_REGEX" || true)"
  if [[ -n "$matches" ]]; then
    FOUND_FORBIDDEN=true
    echo -e "${RED}Erro: padrao proibido detectado no ZIP ($pattern):${NC}" >&2
    printf '%s\n' "$matches" | head -10 >&2
  fi
done

if [[ "$FOUND_FORBIDDEN" == true ]]; then
  rm -f "$ZIP_FILE"
  echo -e "${RED}Erro: ZIP removido por contaminacao de conteudo proibido.${NC}" >&2
  exit 1
fi

FILE_SIZE="$(du -h "$ZIP_FILE" | cut -f1)"
FILE_COUNT="$(printf '%s\n' "$ZIP_CONTENTS" | wc -l | tr -d ' ')"

echo -e "${GREEN}✓ ZIP gerado com sucesso!${NC}"
echo "Arquivo: $ZIP_FILE"
echo "Tamanho: $FILE_SIZE"
echo "Arquivos: $FILE_COUNT"
