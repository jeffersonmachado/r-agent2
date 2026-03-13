/**
 * Garante que flows usados nos testes RPA existam no banco.
 *
 * - Extrai flowIds dos arquivos em tests/rpa/flows e tests/rpa/seeds
 * - Cria um fluxo "genérico" se não existir
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RPA_FLOWS_DIR = path.join(__dirname, 'flows');
const RPA_SEEDS_DIR = path.join(__dirname, 'seeds');

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

function deriveFlowIdFromTestId(testId) {
  const match = String(testId || '').match(/^test-flow-([^-]+)/);
  return match ? `flow-${match[1]}` : null;
}

function extractFlowIdsFromRecording(recording) {
  const ids = new Set();
  if (!recording || typeof recording !== 'object') return ids;
  if (recording.flowId) ids.add(String(recording.flowId));
  if (recording.id) {
    const derived = deriveFlowIdFromTestId(recording.id);
    if (derived) ids.add(derived);
  }
  const steps = Array.isArray(recording.steps) ? recording.steps : [];
  for (const step of steps) {
    const url = step?.url || step?.value || step?.selector || '';
    const match = typeof url === 'string' ? url.match(/flowId=([^&\s]+)/i) : null;
    if (match && match[1]) {
      ids.add(decodeURIComponent(match[1]));
    }
  }
  return ids;
}

function buildGenericFlow(flowId, tenantId = 'system') {
  return {
    tenantId,
    id: flowId,
    name: `RPA Auto Flow (${flowId})`,
    version: 1,
    kind: 'chat',
    metadata: {
      generatedBy: 'rpa-seed',
      generated: true,
      status: 'active',
    },
    nodes: [
      { id: 'start', type: 'message', config: { text: 'Olá! Como posso ajudar?' }, next: 'ask1' },
      { id: 'ask1', type: 'user_input', config: { variable: 'input1' }, next: 'msg1' },
      { id: 'msg1', type: 'message', config: { text: 'Entendido. Pode continuar.' }, next: 'ask2' },
      { id: 'ask2', type: 'user_input', config: { variable: 'input2' }, next: 'msg2' },
      { id: 'msg2', type: 'message', config: { text: 'Entendido. Pode continuar.' }, next: 'ask3' },
      { id: 'ask3', type: 'user_input', config: { variable: 'input3' }, next: 'msg3' },
      { id: 'msg3', type: 'message', config: { text: 'ticket' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };
}

async function ensureRpaFlows() {
  const files = [
    ...listJsonFiles(RPA_FLOWS_DIR),
    ...listJsonFiles(RPA_SEEDS_DIR),
  ];

  const flowIds = new Set();
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(raw);
      const ids = extractFlowIdsFromRecording(json);
      ids.forEach((id) => flowIds.add(id));
    } catch (_) {
      // best-effort
    }
  }

  if (flowIds.size === 0) {
    return { ok: true, created: 0, skipped: 0 };
  }

  const { connect } = require('../../api/db/sequelize');
  const { Flow } = require('../../api/db/models');
  await connect();
  const FlowModel = Flow();

  let created = 0;
  let skipped = 0;

  for (const flowId of flowIds) {
    const existing = await FlowModel.findByPk(String(flowId));
    if (existing) {
      skipped += 1;
      continue;
    }
    const flow = buildGenericFlow(String(flowId));
    await FlowModel.create({
      id: flow.id,
      tenant_key: flow.tenantId,
      name: flow.name,
      data: flow,
    });
    created += 1;
  }

  return { ok: true, created, skipped };
}

module.exports = { ensureRpaFlows };

if (require.main === module) {
  ensureRpaFlows()
    .then((res) => {
      console.log(`[RPA Seed] Flows criados: ${res.created}, já existentes: ${res.skipped}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[RPA Seed] Erro ao garantir flows:', err);
      process.exit(1);
    });
}
