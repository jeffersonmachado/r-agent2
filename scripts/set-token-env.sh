#!/usr/bin/env bash

# Uso (obrigatório com source para exportar no shell atual):
#   source scripts/set-token-env.sh
#   source scripts/set-token-env.sh --base http://localhost:3001 --username admin --password 'sua_senha'
#   source scripts/set-token-env.sh --no-save

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Este script precisa ser executado com source para exportar TOKEN no shell atual."
  echo "Exemplo: source scripts/set-token-env.sh --base http://localhost:3001 --username admin --password 'sua_senha'"
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3001}"
USERNAME="${TEST_ADMIN_USERNAME:-admin}"
PASSWORD="${TEST_ADMIN_PASSWORD:-admin123}"
SAVE_FILE=".token.env"
SAVE_ENABLED="1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_URL="$2"
      shift 2
      ;;
    --username)
      USERNAME="$2"
      shift 2
      ;;
    --password)
      PASSWORD="$2"
      shift 2
      ;;
    --save-file)
      SAVE_FILE="$2"
      shift 2
      ;;
    --no-save)
      SAVE_ENABLED="0"
      shift
      ;;
    -h|--help)
      echo "Uso: source scripts/set-token-env.sh [opções]"
      echo ""
      echo "Opções:"
      echo "  --base <url>         Base da API (padrão: ${BASE_URL})"
      echo "  --username <user>    Usuário de login (padrão: ${USERNAME})"
      echo "  --password <pass>    Senha de login"
      echo "  --save-file <path>   Arquivo para persistir export TOKEN (padrão: ${SAVE_FILE})"
      echo "  --no-save            Não salva token em arquivo"
      return 0
      ;;
    *)
      echo "Argumento inválido: $1"
      return 1
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado. Instale o curl e tente novamente."
  return 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node não encontrado. Instale Node.js e tente novamente."
  return 1
fi

auth_try_once() {
  local u="$1"
  local p="$2"
  {
    curl -sS -X POST "${BASE_URL%/}/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"${u}\",\"password\":\"${p}\"}" \
      -w '\n%{http_code}'
  } 2>/dev/null
}

login_response="$(auth_try_once "$USERNAME" "$PASSWORD")"

http_code="${login_response##*$'\n'}"
login_body="${login_response%$'\n'*}"

if [[ ! "$http_code" =~ ^[0-9]{3}$ ]]; then
  echo "Falha ao autenticar: resposta HTTP inválida (${http_code})."
  echo "Endpoint: ${BASE_URL%/}/auth/login"
  return 1
fi

if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
  # Fallback automático para reduzir retrabalho em ambientes com credenciais padrão diferentes.
  candidate_users=("$USERNAME" "admin" "systemadmin" "systemadmin@exemplo.com")
  candidate_passwords=("$PASSWORD" "Admin123!" "admin123")
  tried=()

  for candidate_user in "${candidate_users[@]}"; do
    for candidate_password in "${candidate_passwords[@]}"; do
      key="${candidate_user}::${candidate_password}"
      skip="0"
      for prev in "${tried[@]}"; do
        if [[ "$prev" == "$key" ]]; then
          skip="1"
          break
        fi
      done
      [[ "$skip" == "1" ]] && continue
      tried+=("$key")

      login_response="$(auth_try_once "$candidate_user" "$candidate_password")"
      http_code="${login_response##*$'\n'}"
      login_body="${login_response%$'\n'*}"

      if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
        USERNAME="$candidate_user"
        PASSWORD="$candidate_password"
        echo "Login realizado com fallback automático (username=${USERNAME})."
        break 2
      fi
    done
  done
fi

if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
  echo "Falha no login (HTTP ${http_code})."
  echo "Resposta: ${login_body}"
  return 1
fi

token="$(node -e "
try {
  const j = JSON.parse(process.argv[1] || '{}');
  const token = j.token || j.access_token || j.accessToken || (j.data && (j.data.token || j.data.access_token)) || '';
  process.stdout.write(String(token || ''));
} catch (_) {
  process.stdout.write('');
}
" "$login_body")"

if [[ -z "$token" ]]; then
  echo "Login ocorreu, mas token não foi encontrado no payload."
  echo "Resposta: ${login_body}"
  return 1
fi

export TOKEN="$token"
export TOKEN_SOURCE="${BASE_URL%/}/auth/login"
export TOKEN_USERNAME="$USERNAME"
export TOKEN_SET_AT="$(date -Iseconds)"

if [[ "$SAVE_ENABLED" == "1" ]]; then
  {
    echo "export TOKEN='$TOKEN'"
    echo "export TOKEN_SOURCE='$TOKEN_SOURCE'"
    echo "export TOKEN_USERNAME='$TOKEN_USERNAME'"
    echo "export TOKEN_SET_AT='$TOKEN_SET_AT'"
  } > "$SAVE_FILE"
  chmod 600 "$SAVE_FILE" 2>/dev/null || true
fi

echo "TOKEN carregado no ambiente atual."
echo "Fonte: $TOKEN_SOURCE"
echo "Usuário: $TOKEN_USERNAME"
if [[ "$SAVE_ENABLED" == "1" ]]; then
  echo "Persistido em: $SAVE_FILE"
  echo "Reuso rápido: source $SAVE_FILE"
fi