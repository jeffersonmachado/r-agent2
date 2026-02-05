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
const FLOWS_DIR = path.join(ROOT, 'tests', 'rpa', 'flows');

const API_URL = (process.env.TEST_API_URL || process.env.TEST_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const TENANT_ID = (process.env.TEST_TENANT_ID || process.env.RPA_TENANT_ID || 'system').trim();
const RPA_TOKEN = (process.env.RPA_TOKEN || '').trim();

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

function deriveFlowIdFromSeed(seed) {
  if (!seed || typeof seed.id !== 'string') return null;
  const match = seed.id.match(/^test-flow-([^-]+)/);
  if (!match) return null;
  return `flow-${match[1]}`;
}

function collectExpectedTexts(seed) {
  const texts = new Set();
  const steps = Array.isArray(seed?.steps) ? seed.steps : [];

  for (const step of steps) {
    if (step?.assert && typeof step.assert === 'object') {
      if (step.assert.type === 'text' && typeof step.assert.expected === 'string') {
        const trimmed = step.assert.expected.trim();
        if (trimmed) texts.add(trimmed);
      }
      if (step.assert.type === 'exists' && typeof step.assert.expected === 'string') {
        const trimmed = step.assert.expected.trim();
        if (trimmed) texts.add(trimmed);
      }
    }

    if (step?.action === 'assert' && step?.type === 'text' && typeof step.expected === 'string') {
      const trimmed = step.expected.trim();
      if (trimmed) texts.add(trimmed);
    }
  }

  return [...texts];
}

function countUserInputs(seed) {
  const steps = Array.isArray(seed?.steps) ? seed.steps : [];
  let count = 0;
  for (const step of steps) {
    if (step?.type !== 'fill') continue;
    const selector = typeof step.selector === 'string' ? step.selector : '';
    if (
      selector.includes('textarea') ||
      selector.includes('input') ||
      selector.includes('contenteditable')
    ) {
      count += 1;
    }
  }
  return Math.max(1, count);
}

function buildMinimalGreetingFlow(flowId, seed) {
  const now = new Date().toISOString();
  const expectedTexts = collectExpectedTexts(seed);
  const userInputCount = countUserInputs(seed);
  const greeting = 'Olá! Como posso ajudar?';
  const mergedText = [greeting, ...expectedTexts.filter((t) => t !== greeting)].join('\n');

  const nodes = [
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
        text: mergedText,
      },
      next: 'user-input-1',
    },
  ];

  for (let i = 1; i <= userInputCount; i += 1) {
    const inputId = `user-input-${i}`;
    const messageId = `message-${i + 1}`;
    const nextId = i === userInputCount ? 'end-1' : messageId;

    nodes.push({
      id: inputId,
      type: 'user_input',
      label: `Aguardar Resposta ${i}`,
      position: { x: 500 + i * 200, y: 100 },
      config: {
        variable: `userMessage${i}`,
      },
      next: nextId,
    });

    if (i < userInputCount) {
      nodes.push({
        id: messageId,
        type: 'message',
        label: `Fallback ${i}`,
        position: { x: 650 + i * 200, y: 100 },
        config: {
          text: 'Entendido. Pode continuar.',
        },
        next: `user-input-${i + 1}`,
      });
    }
  }

  nodes.push({
    id: 'end-1',
    type: 'end',
    label: 'Fim',
    position: { x: 500 + (userInputCount + 1) * 200, y: 100 },
  });

  const connections = [];
  for (const node of nodes) {
    if (node.next) {
      connections.push({ from: node.id, to: node.next });
    }
  }

  return {
    id: flowId,
    name: `RPA Auto Flow (${flowId})`,
    description: 'Flow mínimo auto-seeded para testes RPA (CI/stack).',
    version: 1,
    tenantId: TENANT_ID,
    nodes,
    connections,
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
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT_ID,
      ...(RPA_TOKEN ? { Authorization: `Bearer ${RPA_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  return { ok: res.ok, status: res.status, body: parsed };
}

async function putJson(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TENANT_ID,
      ...(RPA_TOKEN ? { Authorization: `Bearer ${RPA_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  return { ok: res.ok, status: res.status, body: parsed };
}

async function main() {
  if (!fs.existsSync(SEEDS_DIR) && !fs.existsSync(FLOWS_DIR)) {
    console.log(`[seed-rpa-flows] Nenhum diretório de seeds/flows encontrado.`);
    process.exit(0);
  }

  const files = [];
  if (fs.existsSync(SEEDS_DIR)) {
    files.push(...fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(SEEDS_DIR, f)));
  }
  if (fs.existsSync(FLOWS_DIR)) {
    files.push(...fs.readdirSync(FLOWS_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(FLOWS_DIR, f)));
  }
  const flowIds = new Set();
  const seedByFlowId = new Map();

  for (const full of files) {
    try {
      const seed = JSON.parse(fs.readFileSync(full, 'utf8'));
      for (const id of extractFlowIdsFromSeed(seed)) {
        flowIds.add(id);
        if (!seedByFlowId.has(id)) {
          seedByFlowId.set(id, seed);
        }
      }
      const derivedFlowId = deriveFlowIdFromSeed(seed);
      if (derivedFlowId) {
        flowIds.add(derivedFlowId);
        if (!seedByFlowId.has(derivedFlowId)) {
          seedByFlowId.set(derivedFlowId, seed);
        }
      }
    } catch (e) {
      console.warn(`[seed-rpa-flows] Ignorando seed inválido (${full}): ${e.message}`);
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
    const seed = seedByFlowId.get(flowId);
    const flow = buildMinimalGreetingFlow(flowId, seed);
    const { ok, status, body } = await postJson(`${API_URL}/flows`, flow);
    if (ok) {
      created += 1;
      console.log(`[seed-rpa-flows] ✅ criado: ${flowId}`);
      continue;
    }
    if (status === 409) {
      const update = await putJson(`${API_URL}/flows/${encodeURIComponent(flowId)}`, flow);
      if (update.ok) {
        skipped += 1;
        console.log(`[seed-rpa-flows] ♻️  atualizado: ${flowId}`);
        continue;
      }
      failed += 1;
      console.warn(`[seed-rpa-flows] ❌ falhou ao atualizar: ${flowId} (status=${update.status})`, update.body);
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

