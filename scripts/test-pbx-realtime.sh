#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_URL="${API_URL:-http://localhost:3001}"

echo "[pbx-realtime] Autenticando..."
login_json="$(curl -fsS -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  "${API_URL}/auth/login")"

token="$(node -e "const s=process.argv[1]; const j=JSON.parse(s); process.stdout.write(j.token || '');" "$login_json")"
tenant_key="$(node -e "const s=process.argv[1]; const j=JSON.parse(s); process.stdout.write((j.agent && j.agent.tenantId) ? String(j.agent.tenantId) : '');" "$login_json")"

if [[ -z "$token" ]]; then
  echo "[pbx-realtime] ERRO: token vazio no login"
  echo "$login_json"
  exit 1
fi
if [[ -z "$tenant_key" ]]; then
  echo "[pbx-realtime] ERRO: tenantId/tenant_key vazio no login"
  echo "$login_json"
  exit 1
fi

ext="1101"
expected_id="${tenant_key}__${ext}"
queue="support"
expected_queue="${tenant_key}__${queue}"

echo "[pbx-realtime] Criando ramal via API (tenant_key=${tenant_key}, id=${expected_id})..."
curl -fsS -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${token}" \
  -d "{\"extension\":\"${ext}\",\"displayName\":\"Maria Test\",\"authUsername\":\"${ext}\",\"authPassword\":\"testpass\"}" \
  "${API_URL}/api/pbx/extensions" >/dev/null

echo "[pbx-realtime] Criando fila via API (tenant_key=${tenant_key}, name=${queue})..."
curl -fsS -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${token}" \
  -d "{\"name\":\"${queue}\",\"displayName\":\"Suporte\",\"strategy\":\"ringall\",\"options\":{\"timeout\":15}}" \
  "${API_URL}/api/pbx/queues" >/dev/null

echo "[pbx-realtime] Validando que o endpoint existe no Realtime (DB)..."
docker compose -f docker-compose.test.yml exec -T api node -e "\
  const {connect,getSequelize,close}=require('./api/db/sequelize');\
  (async()=>{\
    await connect();\
    const sq=getSequelize();\
    const [rows]=await sq.query('SELECT COUNT(*)::int AS n FROM ps_endpoints WHERE id = :id',{replacements:{id:process.argv[1]}});\
    const [qrows]=await sq.query('SELECT COUNT(*)::int AS n FROM pbx_rt_queues WHERE name = :name',{replacements:{name:process.argv[2]}});\
    await close();\
    if(!rows || !rows[0] || rows[0].n !== 1){\
      console.error('[pbx-realtime] expected ps_endpoints row missing', rows && rows[0]);\
      process.exit(1);\
    }\
    if(!qrows || !qrows[0] || qrows[0].n !== 1){\
      console.error('[pbx-realtime] expected pbx_rt_queues row missing', qrows && qrows[0]);\
      process.exit(1);\
    }\
    console.log('[pbx-realtime] OK DB ps_endpoints', rows[0]);\
    console.log('[pbx-realtime] OK DB pbx_rt_queues', qrows[0]);\
  })().catch(e=>{console.error(e);process.exit(1);});\
" "$expected_id" "$expected_queue"

echo "[pbx-realtime] Validando que o Asterisk enxerga o endpoint via realtime..."
out="$(docker compose -f docker-compose.test.yml exec -T asterisk asterisk -rx "pjsip show endpoint ${expected_id}" || true)"
echo "$out" | rg -q "Endpoint:\\s+${expected_id}/" || {
  echo "[pbx-realtime] ERRO: Asterisk não retornou endpoint esperado"
  echo "$out"
  exit 1
}

echo "[pbx-realtime] ✅ OK"

