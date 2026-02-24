#!/bin/bash
# Wrapper para docker-deploy.sh que passa argumentos dinamicamente
# Uso: npm run deploy:remote:ssh -- --frontend-only
#      npm run deploy:remote:ssh -- --api-only
#      npm run deploy:remote:ssh -- --host seu-servidor.com

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
ARGS=()
HAS_MODE=false
HAS_BUILD=false

# Processar argumentos
for arg in "$@"; do
    case "$arg" in
        --prod|--dev)
            HAS_MODE=true
            ARGS+=("$arg")
            ;;
        --build|--no-build)
            HAS_BUILD=true
            ARGS+=("$arg")
            ;;
        *)
            ARGS+=("$arg")
            ;;
    esac
done

# Adicionar defaults se não definidos
[[ "$HAS_MODE" == false ]] && ARGS=(--prod "${ARGS[@]}")
[[ "$HAS_BUILD" == false ]] && ARGS=(--build "${ARGS[@]}")

# Executar docker-deploy.sh com os argumentos finais
exec "$SCRIPT_DIR/docker-deploy.sh" "${ARGS[@]}"
