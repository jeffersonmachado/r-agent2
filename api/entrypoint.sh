#!/bin/sh
set -e

echo "[Entrypoint] Aguardando PostgreSQL estar pronto..."
# Aguarda PostgreSQL (healthcheck do docker-compose já garante, mas fazemos retry aqui também)
# Timeout máximo: 120 segundos (60 tentativas * 2 segundos)
MAX_ATTEMPTS=60
ATTEMPT=0
until node -e "
  const { connect } = require('./api/db/index');
  connect(10, 2000).then(() => {
    console.log('[Entrypoint] PostgreSQL pronto');
    process.exit(0);
  }).catch(err => {
    console.error('[Entrypoint] PostgreSQL não disponível:', err.message);
    if (err.stack) {
      console.error('[Entrypoint] Stack:', err.stack);
    }
    process.exit(1);
  });
"; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
    echo "[Entrypoint] ❌ Timeout: PostgreSQL não ficou pronto após $MAX_ATTEMPTS tentativas"
    exit 1
  fi
  echo "[Entrypoint] PostgreSQL não está pronto, aguardando... (tentativa $ATTEMPT/$MAX_ATTEMPTS)"
  sleep 2
done

echo "[Entrypoint] Executando migrations..."
node api/db/migrate.js || {
  echo "[Entrypoint] ❌ Falha ao executar migrations"
  exit 1
}

echo "[Entrypoint] Executando seed..."
node api/db/seed.js || {
  echo "[Entrypoint] ❌ Falha ao executar seed"
  exit 1
}

echo "[Entrypoint] Iniciando servidor..."
exec node api/server.js
