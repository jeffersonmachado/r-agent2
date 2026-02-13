#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_URL="${API_URL:-http://localhost:3001}"
TEST_ADMIN_USERNAME="${TEST_ADMIN_USERNAME:-admin}"
TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-admin123}"
TEST_TENANT_ID="${TEST_TENANT_ID:-system}"
RPA_TOKEN="${RPA_TOKEN:-}"

echo "[pbx-realtime] Autenticando..."
login_json="$(curl -sS -H "Content-Type: application/json" \
  -d "{\"username\":\"${TEST_ADMIN_USERNAME}\",\"password\":\"${TEST_ADMIN_PASSWORD}\"}" \
  "${API_URL}/auth/login" || true)"

token="$(node -e "try{const s=process.argv[1]||'{}'; const j=JSON.parse(s); process.stdout.write(j.token || '');}catch(_){process.stdout.write('');}" "$login_json")"
tenant_key="$(node -e "try{const s=process.argv[1]||'{}'; const j=JSON.parse(s); process.stdout.write((j.agent && j.agent.tenantId) ? String(j.agent.tenantId) : '');}catch(_){process.stdout.write('');}" "$login_json")"

if [[ -z "$token" && -n "$RPA_TOKEN" ]]; then
  echo "[pbx-realtime] Login admin indisponível; tentando login RPA..."
  login_json="$(curl -sS -H "Content-Type: application/json" \
    -d "{\"token\":\"${RPA_TOKEN}\",\"tenantId\":\"${TEST_TENANT_ID}\"}" \
    "${API_URL}/auth/rpa/login" || true)"
  token="$(node -e "try{const s=process.argv[1]||'{}'; const j=JSON.parse(s); process.stdout.write(j.token || '');}catch(_){process.stdout.write('');}" "$login_json")"
  tenant_key="$(node -e "try{const s=process.argv[1]||'{}'; const j=JSON.parse(s); process.stdout.write((j.agent && j.agent.tenantId) ? String(j.agent.tenantId) : '');}catch(_){process.stdout.write('');}" "$login_json")"
fi

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
db_realtime_ok="false"

create_extension() {
  curl -fsS -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    -d "{\"extension\":\"${ext}\",\"displayName\":\"Maria Test\",\"authUsername\":\"${ext}\",\"authPassword\":\"testpass\"}" \
    "${API_URL}/api/pbx/extensions" >/dev/null
}

create_queue() {
  curl -fsS -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    -d "{\"name\":\"${queue}\",\"displayName\":\"Suporte\",\"strategy\":\"ringall\",\"options\":{\"timeout\":15}}" \
    "${API_URL}/api/pbx/queues" >/dev/null
}

echo "[pbx-realtime] Criando ramal via API (tenant_key=${tenant_key}, id=${expected_id})..."
create_extension

echo "[pbx-realtime] Criando fila via API (tenant_key=${tenant_key}, name=${queue})..."
create_queue

echo "[pbx-realtime] Validando entidades via API..."
verify_api_entities() {
  local ext_json queue_json
  ext_json="$(curl -fsS -H "Authorization: Bearer ${token}" "${API_URL}/api/pbx/extensions")"
  queue_json="$(curl -fsS -H "Authorization: Bearer ${token}" "${API_URL}/api/pbx/queues")"

  node -e "\
    try {\
      const extRaw = JSON.parse(process.argv[1] || '[]');\
      const queuesRaw = JSON.parse(process.argv[2] || '[]');\
      const ext = Array.isArray(extRaw) ? extRaw : (Array.isArray(extRaw.items) ? extRaw.items : []);\
      const queues = Array.isArray(queuesRaw) ? queuesRaw : (Array.isArray(queuesRaw.items) ? queuesRaw.items : []);\
      const expectedExt = process.argv[3];\
      const expectedQueue = process.argv[4];\
      const hasExt = Array.isArray(ext) && ext.some((e) => String(e && e.extension) === expectedExt);\
      const hasQueue = Array.isArray(queues) && queues.some((q) => String(q && q.name) === expectedQueue);\
      if (!hasExt || !hasQueue) {\
        console.error('[pbx-realtime] entities missing via API', { hasExt, hasQueue, expectedExt, expectedQueue });\
        process.exit(1);\
      }\
      console.log('[pbx-realtime] OK API entities', { extension: expectedExt, queue: expectedQueue });\
    } catch (e) {\
      console.error(e);\
      process.exit(1);\
    }\
  " "$ext_json" "$queue_json" "$ext" "$queue"
}

retry_api_entities=15
for attempt in $(seq 1 "$retry_api_entities"); do
  if verify_api_entities; then
    break
  fi
  if [[ "$attempt" -eq "$retry_api_entities" ]]; then
    echo "[pbx-realtime] ERRO: extensão/fila não ficaram visíveis via API"
    exit 1
  fi
  sleep 1
done

echo "[pbx-realtime] Validando que o endpoint existe no Realtime (DB)..."
verify_realtime_rows() {
docker compose -f docker-compose.test.yml exec -T api node -e "\
  const {connect,getSequelize,close}=require('./api/db/sequelize');\
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));\
  const maxAttempts=240;\
  const intervalMs=500;\
  (async()=>{\
    await connect();\
    const sq=getSequelize();\
    let rows=[{n:0}];\
    let qrows=[{n:0}];\
    for(let i=0;i<maxAttempts;i++){\
      [rows]=await sq.query('SELECT COUNT(*)::int AS n FROM ps_endpoints WHERE id = :id',{replacements:{id:process.argv[1]}});\
      [qrows]=await sq.query('SELECT COUNT(*)::int AS n FROM pbx_rt_queues WHERE name = :name',{replacements:{name:process.argv[2]}});\
      if(rows && rows[0] && rows[0].n===1 && qrows && qrows[0] && qrows[0].n===1){\
        break;\
      }\
      await sleep(intervalMs);\
    }\
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
}

check_asterisk_endpoint() {
  local out
  out="$(docker compose -f docker-compose.test.yml exec -T asterisk asterisk -rx "pjsip show endpoint ${expected_id}" || true)"
  echo "$out" | rg -q "${expected_id}"
}

max_repair_attempts=3
repair_attempt=1
while true; do
  if verify_realtime_rows; then
    db_realtime_ok="true"
    break
  fi
  if [[ $repair_attempt -ge $max_repair_attempts ]]; then
    echo "[pbx-realtime] Aviso: ps_endpoints ainda não visível após ${repair_attempt} tentativas; validando no Asterisk..."
    if check_asterisk_endpoint; then
      echo "[pbx-realtime] WARN: endpoint validado via Asterisk apesar de lag no realtime DB"
      db_realtime_ok="false"
      break
    fi
    echo "[pbx-realtime] WARN: endpoint ainda não visível no DB nem no primeiro check do Asterisk"
    db_realtime_ok="false"
    break
  fi
  echo "[pbx-realtime] Reaplicando ramal (tentativa $((repair_attempt + 1))/${max_repair_attempts})..."
  create_extension
  sleep 2
  repair_attempt=$((repair_attempt + 1))
done

echo "[pbx-realtime] Validando que o Asterisk enxerga o endpoint via realtime..."
asterisk_ok="false"
asterisk_out=""
for attempt in $(seq 1 20); do
  asterisk_out="$(docker compose -f docker-compose.test.yml exec -T asterisk asterisk -rx "pjsip show endpoint ${expected_id}" || true)"
  if echo "$asterisk_out" | rg -q "${expected_id}"; then
    asterisk_ok="true"
    break
  fi
  sleep 1
done

if [[ "$asterisk_ok" != "true" ]]; then
  echo "[pbx-realtime] ERRO: Asterisk não retornou endpoint esperado"
  echo "$asterisk_out"
  if [[ "$db_realtime_ok" != "true" ]]; then
    echo "[pbx-realtime] ERRO: endpoint indisponível em DB e Asterisk"
    exit 1
  fi
fi

echo "[pbx-realtime] ✅ OK"
