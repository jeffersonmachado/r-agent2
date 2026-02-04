#!/usr/bin/env node
/**
 * Seed mínimo de flows para execução de testes RPA em stack local/CI.
 *
 * Problema que resolve:
 * - Seeds RPA navegam para `/chat?flowId=flow-...` e a UI chama `/flows/:id`.
 * - Em ambiente de teste (docker-compose.test.yml), esses flows podem não existir.
 * - Resultado: HTTP 404 flow_not_found e falha imediata dos asserts.
 *
 * Solução:
 * - Varre `tests/rpa/seeds/*.json`, extrai `flowId` de URLs.
 * - Cria (POST /flows) um flow simples (start -> message -> user_input -> end)
 *   para cada `flowId` encontrado.
 *
 * Observação:
 * - Em `NODE_ENV=test`, `STRICT_TENANT_MODE` é `false` por padrão, então podemos
 *   criar flows sem autenticação, desde que `tenantId` esteja presente.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEEDS_DIR = path.join(ROOT, 'tests', 'rpa', 'seeds');

const API_URL = (process.env.TEST_API_URL || process.env.TEST_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const TENANT_ID = (process.env.TEST_TENANT_ID || process.env.RPA_TENANT_ID || 'system').trim();

function extractFlowIdsFromSeed(seed) {
  const ids = new Set();
  const steps = Array.isArray(seed?.steps) ? seed.steps : [];
  for (const step of steps) {
    const candidates = [step?.url, step?.value, step?.selector].filter((v) => typeof v === 'string' && v.includes('flowId='));
    for (const c of candidates) {
      try {
        const u = new URL(c);
        const flowId = u.searchParams.get('flowId');
        if (flowId && typeof flowId === 'string') ids.add(flowId.trim());
      } catch (_) {
        // ignora URLs inválidas (não bloqueia seed)
      }
    }
  }
  return [...ids].filter(Boolean);
}

function buildMinimalGreetingFlow(flowId) {
  const now = new Date().toISOString();
  return {
    id: flowId,
    name: `RPA Auto Flow (${flowId})`,
    description: 'Flow mínimo auto-seeded para testes RPA (CI/stack).',
    version: '1.0.0',
    tenantId: TENANT_ID,
    nodes: [
      {
        id: 'start-1',
        type: 'start',
        label: 'Início',
        position: { x: 100, y: 100 },
        next: 'message-1',
      },
      {
        id: 'message-1',
        type: 'message',
        label: 'Mensagem Inicial',
        position: { x: 300, y: 100 },
        config: {
          // Alinha com os seeds RPA atuais
          text: 'Olá! Como posso ajudar?',
        },
        next: 'user-input-1',
      },
      {
        id: 'user-input-1',
        type: 'user_input',
        label: 'Aguardar Resposta',
        position: { x: 500, y: 100 },
        config: {
          variable: 'userMessage',
        },
        next: 'end-1',
      },
      {
        id: 'end-1',
        type: 'end',
        label: 'Fim',
        position: { x: 700, y: 100 },
      },
    ],
    connections: [
      { from: 'start-1', to: 'message-1' },
      { from: 'message-1', to: 'user-input-1' },
      { from: 'user-input-1', to: 'end-1' },
    ],
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy: 'rpa-auto-seed',
      generated: false,
    },
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  return { ok: res.ok, status: res.status, body: parsed };
}

async function main() {
  if (!fs.existsSync(SEEDS_DIR)) {
    console.log(`[seed-rpa-flows] Diretório de seeds não encontrado: ${SEEDS_DIR}`);
    process.exit(0);
  }

  const files = fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.json'));
  const flowIds = new Set();

  for (const f of files) {
    const full = path.join(SEEDS_DIR, f);
    try {
      const seed = JSON.parse(fs.readFileSync(full, 'utf8'));
      for (const id of extractFlowIdsFromSeed(seed)) flowIds.add(id);
    } catch (e) {
      console.warn(`[seed-rpa-flows] Ignorando seed inválido (${f}): ${e.message}`);
    }
  }

  const list = [...flowIds].sort();
  if (list.length === 0) {
    console.log('[seed-rpa-flows] Nenhum flowId encontrado nos seeds; nada a seedar.');
    return;
  }

  console.log(`[seed-rpa-flows] API: ${API_URL} | tenantId: ${TENANT_ID}`);
  console.log(`[seed-rpa-flows] Flows detectados: ${list.length}`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const flowId of list) {
    const flow = buildMinimalGreetingFlow(flowId);
    const { ok, status, body } = await postJson(`${API_URL}/flows`, flow);
    if (ok) {
      created += 1;
      console.log(`[seed-rpa-flows] ✅ criado: ${flowId}`);
      continue;
    }
    if (status === 409) {
      skipped += 1;
      console.log(`[seed-rpa-flows] ↩️  já existe: ${flowId}`);
      continue;
    }
    failed += 1;
    console.warn(`[seed-rpa-flows] ❌ falhou: ${flowId} (status=${status})`, body);
  }

  console.log(`[seed-rpa-flows] Resultado: created=${created} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[seed-rpa-flows] Erro inesperado:', e);
  process.exit(1);
});

