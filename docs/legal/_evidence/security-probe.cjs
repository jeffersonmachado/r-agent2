'use strict';
const path = require('path');
const repo = path.resolve(__dirname, '../../..');
const loggerPath = require.resolve(path.join(repo, 'api/utils/logger'));
const logger = { debug() {}, info() {}, warn() {}, error() {} };
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: logger };
const { handleRagCoreRoutes } = require(path.join(repo, 'api/modules/rag-documents/rag/ragCoreRoutes'));
const { createToolRegistry, registerDefaultTools } = require(path.join(repo, 'src/core/cognitive/tool-registry'));
const doc = { id: 'synthetic-system-doc', tenantId: 'legal-probe', domain: 'SYSTEM', classification: 'DEVELOPMENT', sensitivity: 'RESTRICTED', permissions: { roles: ['super_admin'], agents: ['other-agent'] }, content: 'SYNTHETIC RESTRICTED MARKER' };
async function ragProbe(pathname) {
  let result;
  const res = { setHeader() {}, writeHead(status) { result = { status }; }, end(data) { result.bytes = data.length; } };
  const req = { url: pathname, tenantId: 'legal-probe', agent: { id: 'production-user', tenantId: 'legal-probe', role: 'operator', classification: 'PRODUCTION' }, headers: {}, socket: {} };
  const deps = { requireAuth: () => ({ valid: true }), requirePermission: () => ({ allowed: true }), requireTenant: () => 'legal-probe', logger, sendJson: (_res, status, body) => { result = { status, restrictedContentReturned: JSON.stringify(body).includes(doc.content) }; }, listDocuments: async () => [doc], ragDocumentsService: { getDocumentWithContent: async () => ({ ...doc }), getDocumentFileFromDb: async () => ({ data: Buffer.from(doc.content), filename: 'synthetic.txt' }) } };
  await handleRagCoreRoutes({ req, res, method: 'GET', pathname, deps });
  return { pathname, actor: 'PRODUCTION', storedDomain: doc.domain, storedClassification: doc.classification, storedSensitivity: doc.sensitivity, ...result };
}
async function main() {
  const rows = [];
  for (const p of ['/rag/documents', '/rag/documents/synthetic-system-doc', '/rag/documents/synthetic-system-doc/download']) rows.push(await ragProbe(p));
  const registry = createToolRegistry({ logger });
  let sends = 0;
  let serviceArguments;
  registerDefaultTools(registry, { whatsappService: { sendTextMessage: async (...args) => { sends += 1; serviceArguments = args; return { delivered: true }; } } });
  await registry.execute('messaging.sendWhatsAppMessage', { to: '5511000000000', message: 'SYNTHETIC MESSAGE' }, { tenantId: 'legal-probe', actor: { classification: 'PRODUCTION', permissions: ['channel.send'] }, idempotencyKey: 'synthetic-send' });
  rows.push({ tool: 'messaging.sendWhatsAppMessage', confirmedProvided: false, approvalProvided: false, serviceInvocations: sends, serviceArgumentCount: serviceArguments.length, tenantPropagatedToService: serviceArguments.includes('legal-probe') });
  let guardedInvocations = 0;
  registry.register({ id: 'synthetic.guard', visibility: 'PRODUCTION', permissions: ['channel.send'], description: 'synthetic', confirmationPolicy: 'confirmation_required', execute: async () => { guardedInvocations += 1; return { ok: true }; } });
  let withoutConfirmation;
  try { await registry.execute('synthetic.guard', {}, { tenantId: 'legal-probe', actor: { classification: 'PRODUCTION', permissions: ['channel.send'] } }); } catch (error) { withoutConfirmation = error.code; }
  await registry.execute('synthetic.guard', {}, { tenantId: 'legal-probe', actor: { classification: 'PRODUCTION', permissions: ['channel.send'] }, confirmed: true });
  rows.push({ tool: 'synthetic.guard', withoutConfirmation, bareBooleanAccepted: guardedInvocations === 1, persistedApprovalProvided: false });
  const { planToCanonicalProcessDefinition } = require(path.join(repo, 'src/core/cognitive/execution-router'));
  const { compileCanonicalProcessDefinition } = require(path.join(repo, 'api/core/process-runtime/processCanonicalAdapter'));
  const { ProcessStateMachine } = require(path.join(repo, 'api/core/process-runtime/processStateMachine'));
  const { ProcessExecutionContext } = require(path.join(repo, 'api/core/process-runtime/processExecutionContext'));
  for (const stepType of ['HUMAN_TASK', 'WAIT_EVENT']) {
    const definition = planToCanonicalProcessDefinition({ planId: 'synthetic-plan', intent: 'synthetic', steps: [{ id: 'hold', stepType }] }, { tenantId: 'legal-probe' });
    const compiled = compileCanonicalProcessDefinition(definition);
    const node = definition.nodes.find(n => n.id !== 'start' && n.id !== 'end');
    const machine = new ProcessStateMachine();
    const context = new ProcessExecutionContext({ processId: definition.id, executionId: 'synthetic-execution', currentNodeId: node.id, metadata: { tenantId: 'legal-probe' } });
    let errorMessage = null;
    try { await machine.executeNode(node, context, compiled); } catch (error) { errorMessage = error.message; }
    rows.push({ cognitiveStepType: stepType, generatedCanonicalType: node.type, compiledType: compiled.executionGraph.nodesById[node.id].type, executionError: errorMessage });
  }
  const sequelizePath = require.resolve(path.join(repo, 'api/db/sequelize'));
  require.cache[sequelizePath] = { id: sequelizePath, filename: sequelizePath, loaded: true, exports: { getSequelize: () => null } };
  const { SequelizeProcessInstanceStore } = require(path.join(repo, 'api/core/process-runtime/processInstanceStore'));
  const firstStore = new SequelizeProcessInstanceStore();
  await firstStore.createInstance({ executionId: 'synthetic-no-db', processId: 'synthetic-process', status: 'waiting', metadata: { tenantId: 'legal-probe' } });
  const currentRead = await firstStore.loadInstance('synthetic-no-db', { tenantId: 'legal-probe' });
  const secondRead = await new SequelizeProcessInstanceStore().loadInstance('synthetic-no-db', { tenantId: 'legal-probe' });
  rows.push({ durableStoreClass: 'SequelizeProcessInstanceStore', getSequelizeConfigured: false, writeSucceeded: Boolean(currentRead), freshStoreRetainsRecord: Boolean(secondRead) });
  process.stdout.write(JSON.stringify({ mode: 'isolated-real-handler-with-synthetic-dependencies', externalEffects: false, results: rows }, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

