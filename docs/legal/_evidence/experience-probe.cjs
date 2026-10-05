'use strict';

/**
 * Isolated architecture regression probe. Run from repository root:
 *   node docs/legal/_evidence/experience-probe.cjs --root . --out /tmp/legal-experience-probe.json
 *
 * Real route callback source, real classification policy and real RBAC policy.
 * Express registration, auth/session, logger, DB/domain services are explicit fakes.
 * No HTTP listener, DB connection, external communication, browser or actual seed.
 * VM requires are allowlisted; any new dependency aborts instead of using runtime I/O.
 * Exit 1 = reproduced policy violations; exit 2 = harness execution failed.
 * Diagnostic output is not runtime/certification/coverage evidence.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

const root = path.resolve(option('--root', path.join(__dirname, '..', '..', '..')));
const out = option('--out', null);
const sources = [];
const noOpLogger = Object.freeze({ info() {}, warn() {}, error() {}, debug() {} });

function realModule(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, 'utf8');
  sources.push({ file: relative, sha256: crypto.createHash('sha256').update(source).digest('hex') });
  const localModule = { exports: {} };
  const sandbox = {
    module: localModule,
    exports: localModule.exports,
    require(id) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, id)) {
        throw new Error(`Disallowed dependency in isolated probe: ${relative} -> ${id}`);
      }
      return dependencies[id];
    },
  };
  vm.runInNewContext(source, sandbox, { filename, timeout: 3000 });
  return localModule.exports;
}

function fakeRouter() {
  const routes = [];
  const router = { routes };
  for (const method of ['get', 'post', 'delete']) {
    router[method] = (routePath, handler) => { routes.push({ method: method.toUpperCase(), path: routePath, handler }); return router; };
  }
  return router;
}

function response() {
  return { statusCode: null, body: null, writableEnded: false, sendCount: 0 };
}

function baseDeps(actor, counters = {}) {
  return {
    requireAuth(req) {
      req.agent = { ...actor };
      req.tenantId = actor.tenantId;
      return { valid: true, agent: req.agent };
    },
    requirePermission(req, resource, action) {
      const allowed = rbac.hasPermission(req.agent, resource, action);
      return { allowed, error: allowed ? null : 'forbidden' };
    },
    sendJson(res, status, body) {
      res.statusCode = status;
      res.body = body;
      res.writableEnded = true;
      res.sendCount += 1;
    },
    hasJsonContentType() { return true; },
    async parseJsonBody(req) { return req.body || {}; },
    badRequest(res, message) { res.statusCode = 400; res.body = { error: message }; res.writableEnded = true; },
    logAction() { counters.audit = (counters.audit || 0) + 1; },
    logger: noOpLogger,
  };
}

const policy = realModule('api/modules/agent-os/experience-segregation.js', { '../../utils/logger': noOpLogger });
const classification = realModule('api/middleware/requireClassification.js', {
  '../utils/logger': noOpLogger,
  '../modules/agent-os/experience-segregation': policy,
});
const rbac = realModule('api/services/rbacService.js');
const owner = { id: 'synthetic-owner', role: 'owner', tenantId: 'synthetic-experience-tenant' };
const support = { id: 'synthetic-support', role: 'auditor', platformRole: 'support_n2', tenantId: owner.tenantId };
const developer = { id: 'synthetic-dev', role: 'super_admin', tenantId: owner.tenantId };
assert.equal(policy.getClassificationForAgent(owner), 'PRODUCTION');
assert.equal(policy.getClassificationForAgent(support), 'SUPPORT');
assert.equal(policy.getClassificationForAgent(developer), 'DEVELOPMENT');
assert.equal(rbac.hasPermission(owner, 'agents', 'list_all'), true);
assert.equal(rbac.hasPermission(owner, 'agents', 'create'), true);

const testExecutionRoutes = realModule('api/modules/test-executions/routes.js', {
  express: { Router: fakeRouter },
  '../../middleware/requireClassification': classification,
});

const cases = [];

async function unifiedProbe({ id, actor, method, routePath, action, service, serviceResult, expectedStatus, params = {} }) {
  const counters = { domainServiceCalls: 0 };
  const deps = baseDeps(actor, counters);
  deps[service] = async () => { counters.domainServiceCalls += 1; return serviceResult; };
  // GET callbacks call services synchronously; preserve their real service shape.
  if (method === 'GET') deps[service] = () => { counters.domainServiceCalls += 1; return serviceResult; };
  const router = testExecutionRoutes.createTestExecutionsRoutes({ buildDeps: () => deps });
  const match = router.routes.find((entry) => entry.method === method && entry.path === routePath);
  assert.ok(match, `Route registered: ${method} ${routePath}`);
  const req = { method, url: routePath, originalUrl: routePath, params, query: {}, body: { seedName: 'synthetic-probe', initialUrl: 'https://example.invalid/', kind: 'synthetic-probe' } };
  const res = response();
  await match.handler(req, res);
  assert.equal(res.sendCount, 1, `Exactly one response: ${id}`);
  const expectedCalls = expectedStatus === 403 ? 0 : 1;
  const contractPass = res.statusCode === expectedStatus && counters.domainServiceCalls === expectedCalls;
  cases.push({
    id, blocker: expectedStatus === 403 && policy.getClassificationForAgent(actor) === 'SUPPORT' ? 'VUI-B1' : null,
    actorClassification: policy.getClassificationForAgent(actor), role: actor.role, platformRole: actor.platformRole || null,
    endpoint: `${method} ${routePath}`, action,
    expected: { status: expectedStatus, domainServiceCalls: expectedCalls },
    observed: { status: res.statusCode, domainServiceCalls: counters.domainServiceCalls },
    contractPass, result: contractPass ? 'PASS' : 'POLICY_VIOLATION_REPRODUCED',
  });
}

async function registryProbe() {
  const calls = [];
  const technicalAgent = { id: 'synthetic-technical-agent', tenant_id: owner.tenantId, classification: 'DEVELOPMENT', slug: 'synthetic-qa-engineering' };
  const fakeService = { async listCorporateAgents(input) { calls.push(input); return [technicalAgent]; } };
  const route = realModule('api/modules/agent-registry/routes.js', { './service': fakeService, '../../utils/logger': noOpLogger });
  const req = { method: 'GET', query: {}, params: {}, url: '/api/agent-registry' };
  const res = response();
  await route.handleAgentRegistryRoutes({ req, res, method: 'GET', pathname: req.url, deps: baseDeps(owner) });
  assert.equal(res.sendCount, 1);
  const exposedTechnicalAgents = (res.body?.agents || []).filter((agent) => !policy.validateAgentVisibility(agent, 'PRODUCTION').visible).length;
  const contractPass = exposedTechnicalAgents === 0;
  cases.push({
    id: 'production_registry_technical_discovery', blocker: 'VUI-B2', actorClassification: 'PRODUCTION', role: owner.role,
    endpoint: 'GET /api/agent-registry', action: 'List same-tenant agents; technical agents must be filtered or denied',
    expected: { exposedTechnicalAgents: 0 },
    observed: { status: res.statusCode, exposedTechnicalAgents, serviceCalls: calls.length, filtersPassed: calls[0]?.filters || null, tenantIsAuthenticatedSyntheticTenant: calls[0]?.tenantId === owner.tenantId },
    contractPass, result: contractPass ? 'PASS' : 'POLICY_VIOLATION_REPRODUCED',
  });
}

async function seedProbe() {
  let seedCalls = 0;
  const fakeService = { async seedDefaultTemplates(tenantId) { seedCalls += 1; assert.equal(tenantId, owner.tenantId); return [{ id: 'synthetic-template-only' }]; } };
  const route = realModule('api/modules/agent-os/routes/vertical-templates.js', {
    '../../vertical-templates/service': fakeService,
    '../../../utils/logger': noOpLogger,
  });
  const req = { method: 'POST', query: {}, params: {}, url: '/api/vertical-templates/seed' };
  const res = response();
  await route.handleVerticalTemplateRoutes({ req, res, method: 'POST', pathname: req.url, deps: baseDeps(owner) });
  assert.equal(res.sendCount, 1);
  const contractPass = res.statusCode === 403 && seedCalls === 0;
  cases.push({
    id: 'production_template_seed', blocker: 'VUI-B3', actorClassification: 'PRODUCTION', role: owner.role,
    endpoint: 'POST /api/vertical-templates/seed', action: 'Technical seed must require DEVELOPMENT before service invocation',
    expected: { status: 403, seedServiceCalls: 0 }, observed: { status: res.statusCode, seedServiceCalls: seedCalls },
    contractPass, result: contractPass ? 'PASS' : 'POLICY_VIOLATION_REPRODUCED',
  });
}

async function main() {
  await unifiedProbe({ id: 'support_qa_scenario_discovery', actor: support, method: 'GET', routePath: '/api/test-executions/qa-waves/scenarios', action: 'Engineering QA catalog requires DEVELOPMENT', service: 'listQaWaveScenarios', serviceResult: { items: [{ id: 'synthetic-only' }] }, expectedStatus: 403 });
  await unifiedProbe({ id: 'support_recording_start', actor: support, method: 'POST', routePath: '/api/test-executions/recordings/start', action: 'Technical recording requires DEVELOPMENT', service: 'startManualRecording', serviceResult: { success: true, recordingId: 'synthetic-only' }, expectedStatus: 403 });
  await unifiedProbe({ id: 'support_technical_execution', actor: support, method: 'POST', routePath: '/api/test-executions', action: 'Technical execution requires DEVELOPMENT', service: 'createExecution', serviceResult: { id: 'synthetic-only', status: 'queued' }, expectedStatus: 403 });
  await unifiedProbe({ id: 'support_technical_cancel', actor: support, method: 'POST', routePath: '/api/test-executions/:executionId/cancel', action: 'Technical execution cancellation requires DEVELOPMENT', service: 'cancelUnifiedExecution', serviceResult: { success: true }, expectedStatus: 403, params: { executionId: 'synthetic-only' } });
  await unifiedProbe({ id: 'control_production_recording_denied', actor: owner, method: 'POST', routePath: '/api/test-executions/recordings/start', action: 'Control: PRODUCTION must be denied', service: 'startManualRecording', serviceResult: { success: true }, expectedStatus: 403 });
  await unifiedProbe({ id: 'control_support_recording_read_allowed', actor: support, method: 'GET', routePath: '/api/test-executions/recordings', action: 'Control: SUPPORT diagnostic reading allowed', service: 'listRecordings', serviceResult: [], expectedStatus: 200 });
  await unifiedProbe({ id: 'control_development_recording_start_allowed', actor: developer, method: 'POST', routePath: '/api/test-executions/recordings/start', action: 'Control: DEVELOPMENT recording allowed', service: 'startManualRecording', serviceResult: { success: true }, expectedStatus: 200 });
  await registryProbe();
  await seedProbe();
  const violations = cases.filter((entry) => !entry.contractPass);
  const report = {
    generatedAt: new Date().toISOString(), producer: 'legal-assessment-isolated-experience-probe',
    evidenceClass: 'ISOLATED_CODE_REGRESSION_DIAGNOSTIC', certificationEvidence: false, runtimeValidated: false,
    harnessExecution: 'PASS', policyContractStatus: violations.length ? 'FAIL' : 'PASS',
    isolation: { httpListeners: false, databaseConnections: false, externalMessages: false, actualSeeds: false, realData: false, browser: false, requireAllowlist: true },
    realCode: ['route callback source', 'classification policy', 'classification middleware', 'RBAC policy'],
    fakes: ['Express route registration', 'auth/session', 'logger', 'domain/DB services and data'],
    sources, totals: { cases: cases.length, contractPass: cases.length - violations.length, violations: violations.length, blockerGroups: [...new Set(violations.map((entry) => entry.blocker).filter(Boolean))] }, cases,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (out) fs.writeFileSync(path.resolve(out), serialized);
  process.stdout.write(serialized);
  process.exitCode = violations.length ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 2;
});
