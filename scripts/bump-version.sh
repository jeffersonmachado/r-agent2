#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v npm >/dev/null 2>&1; then
  echo "[erro] npm não encontrado no PATH."
  exit 1
fi

TARGET="${1:-patch}"
SERVER_FILE="api/server.js"

is_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([\-+][0-9A-Za-z\.-]+)?$ ]]
}

case "$TARGET" in
  patch|minor|major|prepatch|preminor|premajor|prerelease) ;;
  *)
    if ! is_semver "$TARGET"; then
      cat <<'EOF'
Uso:
  scripts/bump-version.sh [patch|minor|major|prepatch|preminor|premajor|prerelease|X.Y.Z]

Exemplos:
  scripts/bump-version.sh
  scripts/bump-version.sh minor
  scripts/bump-version.sh 1.4.0
EOF
      exit 2
    fi
    ;;
esac

OLD_VERSION="$(node -p "require('./package.json').version")"
echo "[info] versão atual: $OLD_VERSION"
echo "[info] atualizando versão com: npm version $TARGET --no-git-tag-version"

npm version "$TARGET" --no-git-tag-version >/dev/null

NEW_VERSION="$(node -p "require('./package.json').version")"

if [[ ! -f "$SERVER_FILE" ]]; then
  echo "[erro] arquivo $SERVER_FILE não encontrado."
  exit 1
fi

if ! grep -q "const SERVER_API_VERSION = '" "$SERVER_FILE"; then
  echo "[erro] constante SERVER_API_VERSION não encontrada em $SERVER_FILE."
  exit 1
fi

sed -i -E "s/const SERVER_API_VERSION = '[^']+';/const SERVER_API_VERSION = '${NEW_VERSION}';/" "$SERVER_FILE"

echo "[ok] nova versão: $NEW_VERSION"
echo "[ok] arquivos alterados: package.json, package-lock.json e $SERVER_FILE"
