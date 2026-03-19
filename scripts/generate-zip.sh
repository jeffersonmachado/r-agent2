#!/usr/bin/env bash

# Script para gerar ZIP do projeto com filtros de include/exclude.

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DEFAULT_OUTPUT_DIR="$PROJECT_DIR/dist"
DEFAULT_ZIP_NAME="${PROJECT_NAME}-${TIMESTAMP}.zip"

OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
ZIP_NAME="$DEFAULT_ZIP_NAME"
INCLUDE_NODE_MODULES=false
INCLUDE_COVERAGE=false
INCLUDE_DIST=false
CUSTOM_INCLUDES=()
CUSTOM_EXCLUDES=()

usage() {
  cat <<'EOF'
Uso: ./scripts/generate-zip.sh [opções]

Opções:
  -o, --output-dir DIR      Diretório de saída do ZIP (padrão: ./dist)
  -n, --name NOME.zip       Nome do arquivo ZIP (padrão: r-agent2-YYYYMMDD-HHMMSS.zip)
  -i, --include PADRAO      Include customizado (pode repetir)
  -e, --exclude PADRAO      Exclude customizado (pode repetir)
      --include-node-modules Inclui node_modules
      --include-coverage     Inclui coverage
      --include-dist         Inclui dist
  -h, --help                Exibe esta ajuda

Exemplos:
  ./scripts/generate-zip.sh
  ./scripts/generate-zip.sh -o /tmp/backups -n deploy.zip
  ./scripts/generate-zip.sh -i "api/**" -i "package.json" -n api-only.zip
  ./scripts/generate-zip.sh -e "tests/**" -e "**/*.test.js" -n production.zip
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
      CUSTOM_EXCLUDES+=("$(to_project_pattern "$2")")
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
      echo -e "${RED}Erro: opção inválida '$1'${NC}" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v zip >/dev/null 2>&1; then
  echo -e "${RED}Erro: comando 'zip' não encontrado.${NC}" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
ZIP_FILE="${OUTPUT_DIR}/${ZIP_NAME}"
ZIP_FILE_REAL="$(realpath "$ZIP_FILE")"
PROJECT_PARENT_REAL="$(realpath "$(dirname "$PROJECT_DIR")")"

echo -e "${YELLOW}Gerando ZIP do projeto ${PROJECT_NAME}...${NC}"
echo "Saída: $ZIP_FILE"

if [[ -f "$ZIP_FILE" ]]; then
  rm -f "$ZIP_FILE"
fi

ZIP_EXCLUDES=(
  "${PROJECT_NAME}/.git/*"
  "${PROJECT_NAME}/.vscode/*"
  "${PROJECT_NAME}/.idea/*"
  "${PROJECT_NAME}/.pm2/*"
  "${PROJECT_NAME}/logs/*"
  "${PROJECT_NAME}/recordings/*"
  "${PROJECT_NAME}/replays/*"
  "${PROJECT_NAME}/tests/recordings/*"
  "${PROJECT_NAME}/tests/screenshots/*"
  "${PROJECT_NAME}/tests/videos/*"
  "${PROJECT_NAME}/tests/rpa/screenshots/*"
  "${PROJECT_NAME}/tests/rpa/reports/*"
  "${PROJECT_NAME}/tests/rpa/replay/*"
  "${PROJECT_NAME}/**/__pycache__/*"
  "${PROJECT_NAME}/**/.pytest_cache/*"
  "${PROJECT_NAME}/**/*.pyc"
  "${PROJECT_NAME}/**/*.pyo"
  "${PROJECT_NAME}/**/*.log"
  "${PROJECT_NAME}/**/*.swp"
  "${PROJECT_NAME}/**/*.swo"
  "${PROJECT_NAME}/**/*~"
  "${PROJECT_NAME}/**/.DS_Store"
  "${PROJECT_NAME}/**/Thumbs.db"
  "${PROJECT_NAME}/**/*.tsbuildinfo"
  "${PROJECT_NAME}/**/.env"
  "${PROJECT_NAME}/**/.env.local"
  "${PROJECT_NAME}/**/.env.*.local"
  "${PROJECT_NAME}/**/venv/*"
  "${PROJECT_NAME}/**/env/*"
  "${PROJECT_NAME}/**/.venv/*"
  "${PROJECT_NAME}/rag-service/*.index"
  "${PROJECT_NAME}/rag-service/models/*"
  "${PROJECT_NAME}/rag-service/.cache/*"
  "${PROJECT_NAME}/dist/*.zip"
)

if [[ "$INCLUDE_NODE_MODULES" == false ]]; then
  ZIP_EXCLUDES+=("${PROJECT_NAME}/**/node_modules/*")
fi

if [[ "$INCLUDE_COVERAGE" == false ]]; then
  ZIP_EXCLUDES+=("${PROJECT_NAME}/**/coverage/*")
fi

if [[ "$INCLUDE_DIST" == false ]]; then
  # Keep exclusions scoped to project build artifacts. Dependency packages often
  # ship required runtime code under build/, and excluding those directories
  # corrupts bundled node_modules (for example jest-cli/build/index.js).
  ZIP_EXCLUDES+=(
    "${PROJECT_NAME}/dist/*"
    "${PROJECT_NAME}/build/*"
    "${PROJECT_NAME}/frontend/dist/*"
    "${PROJECT_NAME}/frontend/build/*"
    "${PROJECT_NAME}/apps/mobile/dist/*"
    "${PROJECT_NAME}/apps/mobile/build/*"
    "${PROJECT_NAME}/apps/mobile/android/build/*"
    "${PROJECT_NAME}/apps/mobile/ios/build/*"
  )
fi

# Sempre evita auto-inclusão do ZIP de saída quando o destino está dentro do projeto.
if [[ "$ZIP_FILE_REAL" == "$PROJECT_PARENT_REAL/$PROJECT_NAME/"* ]]; then
  ZIP_EXCLUDES+=("${ZIP_FILE_REAL#"$PROJECT_PARENT_REAL/"}")
fi

if [[ ${#CUSTOM_EXCLUDES[@]} -gt 0 ]]; then
  ZIP_EXCLUDES+=("${CUSTOM_EXCLUDES[@]}")
fi

ZIP_CMD=(zip -rq "$ZIP_FILE" "$PROJECT_NAME")

if [[ ${#CUSTOM_INCLUDES[@]} -gt 0 ]]; then
  ZIP_CMD+=(-i "${CUSTOM_INCLUDES[@]}")
fi

if [[ ${#ZIP_EXCLUDES[@]} -gt 0 ]]; then
  ZIP_CMD+=(-x "${ZIP_EXCLUDES[@]}")
fi

(
  cd "$(dirname "$PROJECT_DIR")"
  "${ZIP_CMD[@]}"
)

if [[ ! -f "$ZIP_FILE" ]]; then
  echo -e "${RED}Erro: falha ao gerar ZIP.${NC}" >&2
  exit 1
fi

FILE_SIZE="$(du -h "$ZIP_FILE" | cut -f1)"
FILE_COUNT="n/d"
TYPE_STATS=""
if command -v unzip >/dev/null 2>&1; then
  ZIP_LIST="$(unzip -Z1 "$ZIP_FILE")"
  FILE_COUNT="$(printf '%s\n' "$ZIP_LIST" | wc -l | tr -d ' ')"
  TYPE_STATS="$(printf '%s\n' "$ZIP_LIST" | awk -F/ '
    {
      name=$NF;
      if (name == "") next;
      n=split(name, parts, ".");
      ext=(n > 1 ? tolower(parts[n]) : "(sem-ext)");
      c[ext]++;
    }
    END {
      for (k in c) printf "%d\t%s\n", c[k], k;
    }
  ' | sort -rn | head -10)"
fi

echo -e "${GREEN}✓ ZIP gerado com sucesso!${NC}"
echo "Arquivo: $ZIP_FILE"
echo "Tamanho: $FILE_SIZE"
echo "Arquivos: $FILE_COUNT"
if [[ -n "$TYPE_STATS" ]]; then
  echo "Top tipos:"
  printf '%s\n' "$TYPE_STATS" | awk -F'\t' '{ printf "  - %s: %s\n", $2, $1 }'
fi
