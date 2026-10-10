'use strict';

/**
 * E2E REAL (Postgres) do ciclo de ACEITAÇÃO DE RISCO da inteligência de segurança.
 *
 * Por que existe: até 2026-10-10 a isenção de risco era criada em uma etapa, com o
 * aprovador vindo do corpo da requisição — e nenhuma suíte exercitava o serviço
 * contra o banco de verdade (as suítes de unidade usam mocks de modelo, então
 * colunas novas de migration, transações e CAS nunca eram vistos em execução).
 * Aqui o ciclo completo roda no schema REAL:
 *
 *   SOLICITAR (PENDING_APPROVAL, achado NÃO mitigado)
 *     → APROVAR por OUTRO ator (ACTIVE, achado MITIGATED, eventos persistidos)
 *     → VIGENTE para o gate
 *     → REVOGAR (achado volta a risco aberto)
 *
 * Mais os controles negativos que a política exige: autoaprovação proibida,
 * escopo alterado depois do pedido, expiração e concorrência (idempotência).
 *
 * Infra ausente NÃO vira verde: `skipOrFail` (tests/helpers/infraGate) pula de
 * forma registrada em dev e FALHA em modo `RELEASE_AUTHORITATIVE=1`.
 */

const { skipOrFail } = require('../helpers/infraGate');

const TEST_TENANT = 'e2e-security-waiver';
const REQUESTER = 'e2e-requester@empresa';
const APPROVER = 'e2e-approver@empresa';
const REASON = 'risco aceito de forma temporaria enquanto o patch nao sai (e2e)';

let dbAvailable = false;
let dbReason = null;
const createdFindingKeys = [];

function models() {
  const index = require('../../api/db/models');
  return {
    Finding: index.SecurityFinding(),
    Waiver: index.SecurityWaiver(),
    Event: index.SecurityFindingEvent(),
  };
}

function infraGate() {
  return skipOrFail({
    suite: 'security-waiver-approval-e2e',
    available: dbAvailable,
    reason: dbReason,
    requirement: 'postgres',
  });
}

async function seedFinding({
  severity = 'HIGH',
  packageName = 'e2e-waiver-pkg',
  suffix = 'a',
} = {}) {
  const { Finding } = models();
  const findingKey = `E2E-ADV-${suffix}::pkg:npm/${packageName}@1.0.0#FIX_AVAILABLE#api`;
  const row = await Finding.create({
    tenant_key: TEST_TENANT,
    finding_key: findingKey,
    advisory_id: `E2E-ADV-${suffix}`,
    component_bom_ref: `pkg:npm/${packageName}@1.0.0`,
    ecosystem: 'npm',
    package_name: packageName,
    installed_version: '1.0.0',
    service: 'api',
    severity,
    status: 'FIX_AVAILABLE',
    advisory_aliases: [],
    fixed_versions: [],
    factors: [],
    rationale: [],
    applicability: 'UNKNOWN',
    kev: false,
  });
  createdFindingKeys.push(row.finding_key);
  return row;
}

async function cleanup() {
  const { Finding, Waiver, Event } = models();
  await Event.destroy({ where: { tenant_key: TEST_TENANT } }).catch(() => {});
  await Waiver.destroy({ where: { tenant_key: TEST_TENANT } }).catch(() => {});
  await Finding.destroy({ where: { tenant_key: TEST_TENANT } }).catch(() => {});
  createdFindingKeys.length = 0;
}

beforeAll(async () => {
  try {
    await require('../../api/db/sequelize').connect(2, 250);
    const { getSequelize } = require('../../api/db/sequelize');
    const sequelize = getSequelize();
    const columns = await sequelize.getQueryInterface().describeTable('security_waivers');
    // Sem as colunas do ciclo de aprovação a suíte NÃO é executável: melhor pular
    // registrado (ou falhar no modo autoritativo) do que fingir cobertura.
    const required = ['status', 'requested_by', 'requested_at', 'approved_at', 'scope_hash', 'approval_version'];
    const missing = required.filter((column) => !columns[column]);
    if (missing.length > 0) {
      throw new Error(`migration do ciclo de aprovação não aplicada (faltando: ${missing.join(', ')})`);
    }
    dbAvailable = true;
    await cleanup();
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe('waiver de segurança — ciclo de aprovação contra o banco real', () => {
  test('SOLICITAR cria PENDING_APPROVAL e NÃO mitiga o achado', async () => {
    if (infraGate()) return;
    const { requestWaiver, WAIVER_STATUS } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'req' });

    const result = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 10,
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe(WAIVER_STATUS.PENDING_APPROVAL);

    const fresh = await models().Finding.findOne({ where: { finding_key: finding.finding_key } });
    expect(fresh.status).toBe('FIX_AVAILABLE');
    expect(fresh.waiver_id).toBeNull();

    const saved = await models().Waiver.findOne({ where: { tenant_key: TEST_TENANT, waiver_key: result.waiverKey } });
    expect(saved.approved_by).toBeNull();
    expect(saved.approved_at).toBeNull();
    expect(saved.requested_by).toBe(REQUESTER);
    expect(String(saved.scope_hash || '')).not.toHaveLength(0);

    const events = await models().Event.findAll({ where: { tenant_key: TEST_TENANT, finding_key: finding.finding_key } });
    expect(events.map((event) => event.event)).toEqual(['WAIVER_REQUESTED']);
  });

  test('AUTOAPROVAÇÃO é recusada pelo banco real (segregação de funções)', async () => {
    if (infraGate()) return;
    const { requestWaiver, approveWaiver } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'sod' });
    const { waiverKey } = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 10,
    });

    await expect(approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: REQUESTER }))
      .rejects.toThrow(/waiver_self_approval_forbidden/);
  });

  test('APROVAR por outro ator mitiga o achado e grava a trilha completa', async () => {
    if (infraGate()) return;
    const { requestWaiver, approveWaiver, waiversForGate, WAIVER_STATUS } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'appr' });
    const { waiverKey } = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 10,
    });

    const approved = await approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: APPROVER });
    expect(approved).toMatchObject({ approved: true, approvedBy: APPROVER });

    const fresh = await models().Finding.findOne({ where: { finding_key: finding.finding_key } });
    expect(fresh.status).toBe('MITIGATED');
    expect(fresh.waiver_id).not.toBeNull();

    const saved = await models().Waiver.findOne({ where: { tenant_key: TEST_TENANT, waiver_key: waiverKey } });
    expect(saved.status).toBe(WAIVER_STATUS.ACTIVE);
    expect(saved.approved_by).toBe(APPROVER);
    expect(Number(saved.approval_version)).toBeGreaterThan(1);

    const events = await models().Event.findAll({
      where: { tenant_key: TEST_TENANT, finding_key: finding.finding_key },
      order: [['created_at', 'ASC']],
    });
    expect(events.map((event) => event.event)).toEqual(['WAIVER_REQUESTED', 'WAIVER_APPROVED']);
    expect(events[1].actor).toBe(APPROVER);

    // VIGENTE para o gate: é isto que faz o motor deixar de bloquear o achado.
    const gate = await waiversForGate({ tenantKey: TEST_TENANT });
    expect(gate.rejected).toEqual([]);
    expect(gate.waivers.map((waiver) => waiver.waiverKey)).toContain(waiverKey);

    // Idempotência: aprovar de novo não mitiga duas vezes nem cria evento novo.
    const again = await approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: APPROVER });
    expect(again).toMatchObject({ approved: false, reason: 'already_approved' });
    const eventsAfter = await models().Event.findAll({ where: { tenant_key: TEST_TENANT, finding_key: finding.finding_key } });
    expect(eventsAfter).toHaveLength(2);
  });

  test('ESCOPO alterado depois do pedido bloqueia a aprovação', async () => {
    if (infraGate()) return;
    const { requestWaiver, approveWaiver } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'scope', severity: 'LOW' });
    const { waiverKey } = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 10,
    });

    // O risco mudou de gravidade depois do pedido: a aprovação não vale para o
    // escopo novo (aprovação não é reaproveitável).
    await finding.update({ severity: 'CRITICAL' });

    await expect(approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: APPROVER }))
      .rejects.toThrow(/waiver_scope_changed/);
  });

  test('REVOGAR devolve o achado ao risco aberto e o tirar da lista do gate', async () => {
    if (infraGate()) return;
    const { requestWaiver, approveWaiver, revokeWaiver, waiversForGate } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'rev' });
    const { waiverKey } = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 10,
    });
    await approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: APPROVER });

    const revoked = await revokeWaiver({ waiverKey, tenantKey: TEST_TENANT, actor: 'e2e-dba', reason: 'correção saiu' });
    expect(revoked).toMatchObject({ revoked: true, mitigated: true });

    const fresh = await models().Finding.findOne({ where: { finding_key: finding.finding_key } });
    expect(fresh.waiver_id).toBeNull();
    expect(fresh.status).toBe('UNDER_INVESTIGATION');

    const gate = await waiversForGate({ tenantKey: TEST_TENANT });
    expect(gate.waivers.map((waiver) => waiver.waiverKey)).not.toContain(waiverKey);
  });

  test('waiver EXPIRADO não é aprovado e não é entregue ao gate', async () => {
    if (infraGate()) return;
    const { requestWaiver, approveWaiver, waiversForGate } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'exp' });
    const { waiverKey } = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 5,
    });

    // Passado explícito: a expiração é revalidada pelo serviço E pelo gate.
    const after = new Date(Date.now() + 10 * 86400000);
    await expect(approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: APPROVER, now: after }))
      .rejects.toThrow(/waiver_expired_cannot_approve/);

    const gate = await waiversForGate({ tenantKey: TEST_TENANT, now: after });
    expect(gate.waivers.map((waiver) => waiver.waiverKey)).not.toContain(waiverKey);
  });

  test('revogação CONCORRENTE: só uma vence (CAS real)', async () => {
    if (infraGate()) return;
    const { requestWaiver, approveWaiver, revokeWaiver } = require('../../api/services/securityIntel/waiverService');
    const finding = await seedFinding({ suffix: 'race' });
    const { waiverKey } = await requestWaiver({
      tenantKey: TEST_TENANT,
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      expiresInDays: 10,
    });
    await approveWaiver({ waiverKey, tenantKey: TEST_TENANT, approvedBy: APPROVER });

    const [first, second] = await Promise.all([
      revokeWaiver({ waiverKey, tenantKey: TEST_TENANT, actor: 'e2e-a' }),
      revokeWaiver({ waiverKey, tenantKey: TEST_TENANT, actor: 'e2e-b' }),
    ]);
    const revokedCount = [first, second].filter((result) => result.revoked === true).length;
    expect(revokedCount).toBe(1);
  });
});
