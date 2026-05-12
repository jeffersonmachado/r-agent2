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

echo "[Entrypoint] Aguardando Redis estar pronto..."
# Redis é usado por rate-limit e contexto efêmero. Se REDIS_URL não estiver definido, não bloqueia.
if [ -n "${REDIS_URL:-}" ] || [ -n "${RATE_LIMIT_REDIS_URL:-}" ]; then
  MAX_ATTEMPTS=30
  ATTEMPT=0
  until node -e "
    const Redis = require('ioredis');
    const url = process.env.REDIS_URL || process.env.RATE_LIMIT_REDIS_URL;
    if (!url) process.exit(0);
    const r = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, connectTimeout: 3000, maxRetriesPerRequest: 1 });
    r.connect()
      .then(() => r.ping())
      .then(() => { console.log('[Entrypoint] Redis pronto'); return r.quit(); })
      .then(() => process.exit(0))
      .catch(async (err) => {
        console.error('[Entrypoint] Redis não disponível:', err.message);
        try { await r.quit(); } catch {}
        process.exit(1);
      });
  "; do
    ATTEMPT=$((ATTEMPT + 1))
    if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
      echo "[Entrypoint] ⚠️ Timeout: Redis não ficou pronto após $MAX_ATTEMPTS tentativas (seguindo assim mesmo)"
      break
    fi
    echo "[Entrypoint] Redis não está pronto, aguardando... (tentativa $ATTEMPT/$MAX_ATTEMPTS)"
    sleep 1
  done
else
  echo "[Entrypoint] REDIS_URL/RATE_LIMIT_REDIS_URL não definidos; pulando espera do Redis"
fi

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

echo "[Entrypoint] Recarregando módulos PBX após migrations/seed..."
node -e "
  const enabled = String(process.env.PBX_AUTO_RELOAD_AFTER_MIGRATIONS || 'true').toLowerCase() !== 'false';
  const hasAmi = !!process.env.AMI_HOST && !!process.env.AMI_PORT && !!process.env.AMI_USERNAME && !!process.env.AMI_SECRET;
  if (!enabled || !hasAmi) {
    console.log('[Entrypoint] Reload PBX desabilitado ou AMI não configurado');
    process.exit(0);
  }

  const ami = require('./api/services/asterisk/amiClient');
  (async () => {
    try {
      await ami.command('core reload');
      await ami.command('pjsip reload');
      await ami.command('module reload res_odbc.so res_config_odbc.so');
      await ami.command('module reload cdr_adaptive_odbc.so');
      console.log('[Entrypoint] Reload PBX concluído');
    } catch (err) {
      console.warn('[Entrypoint] Reload PBX best-effort falhou:', err && err.message ? err.message : err);
    }
    process.exit(0);
  })();
" || true

echo "[Entrypoint] Iniciando servidor..."
exec node api/server.js
