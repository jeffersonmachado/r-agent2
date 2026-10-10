'use strict';

/**
 * Waivers: solicitação, APROVAÇÃO por OUTRO ator, escopo e concorrência.
 *
 * O que está protegido aqui (achado P0 de 2026-10-10 — a criação era uma etapa só,
 * com aprovador autodeclarado no corpo da requisição):
 *   - SOLICITAR não isenta: o waiver nasce `PENDING_APPROVAL` e o achado NÃO é
 *     mitigado; só `approveWaiver` mitiga;
 *   - SEGREGAÇÃO DE FUNÇÕES: quem solicita não pode aprovar;
 *   - ESCOPO: aprovação vale para o escopo pedido — se o achado mudou (pacote,
 *     serviço, severidade) ou o prazo foi alterado, o hash não casa e a aprovação
 *     é recusada;
 *   - CONCORRÊNCIA: `PENDING_APPROVAL` → `ACTIVE` por CAS (o perdedor recebe
 *     conflito, não uma segunda mitigação); revogação também é CAS;
 *   - expiração obrigatória e prazo limitado (isenção perpétua não é representável);
 *   - achado que não é risco aberto (VEX/resolvido) não é isentável — isentar o
 *     que não é risco é maquiagem de métrica.
 */

jest.mock('../../../api/db/sequelize', () => ({
  connect: jest.fn(),
  getSequelize: jest.fn(),
}));

jest.mock('../../../api/db/models/SecurityWaiver', () => jest.fn());
jest.mock('../../../api/db/models/SecurityFinding', () => jest.fn());
jest.mock('../../../api/db/models/SecurityFindingEvent', () => jest.fn());

const { getSequelize } = require('../../../api/db/sequelize');
const getSecurityWaiver = require('../../../api/db/models/SecurityWaiver');
const getSecurityFinding = require('../../../api/db/models/SecurityFinding');
const getSecurityFindingEvent = require('../../../api/db/models/SecurityFindingEvent');

const {
  DEFAULT_MAX_WAIVER_DAYS,
  MIN_REASON_LENGTH,
  WAIVER_STATUS,
  computeWaiverKey,
  computeScopeHash,
  stateOf,
  normalizeCreation,
  normalizePrincipal,
  requestWaiver,
  approveWaiver,
  revokeWaiver,
  getActiveWaivers,
  waiversForGate,
} = require('../../../api/services/securityIntel/waiverService');

const NOW = new Date('2026-10-09T00:00:00.000Z');
const FUTURE = '2026-10-30T00:00:00.000Z';
const REQUESTER = 'engineer@empresa';
const APPROVER = 'cto@empresa';
const REASON = 'risco aceito temporariamente enquanto o patch não sai';

const FINDING = {
  id: 'f1',
  tenant_key: 'system',
  finding_key: 'GHSA-aaaa-bbbb-cccc::pkg:npm/ws@8.20.0',
  advisory_id: 'GHSA-aaaa-bbbb-cccc',
  package_name: 'ws',
  service: 'api',
  severity: 'HIGH',
  status: 'FIX_AVAILABLE',
  resolved_at: null,
  waiver_id: null,
};

const SCOPE_HASH = computeScopeHash({
  findingKey: FINDING.finding_key,
  advisoryId: FINDING.advisory_id,
  packageName: FINDING.package_name,
  service: FINDING.service,
  severity: FINDING.severity,
  expiresAt: FUTURE,
});

function findingFixture(overrides = {}) {
  return {
    ...FINDING,
    update: jest.fn(async function update(patch) { Object.assign(this, patch); return this; }),
    ...overrides,
  };
}

function primeFinding(finding) {
  getSecurityFinding.mockReturnValue({
    findOne: jest.fn().mockResolvedValue(finding),
    findAll: jest.fn().mockResolvedValue(finding ? [finding] : []),
  });
  return finding;
}

function waiverRow(overrides = {}) {
  const row = {
    id: 'w1',
    tenant_key: 'system',
    waiver_key: 'wk-1',
    finding_key: FINDING.finding_key,
    advisory_id: FINDING.advisory_id,
    package_name: FINDING.package_name,
    service: FINDING.service,
    severity: FINDING.severity,
    expires_at: FUTURE,
    status: WAIVER_STATUS.PENDING_APPROVAL,
    requested_by: REQUESTER,
    approved_by: null,
    approval_version: 1,
    revoked_at: null,
    scope_hash: SCOPE_HASH,
    ...overrides,
  };
  row.toJSON = () => row;
  return row;
}

function primeWaiverModel({ waiver = waiverRow(), updateAffected = 1, created = true } = {}) {
  const findOrCreate = jest.fn().mockResolvedValue([waiver, created]);
  const update = jest.fn().mockResolvedValue([updateAffected]);
  const create = jest.fn().mockResolvedValue({ id: 'e1' });
  getSecurityWaiver.mockReturnValue({
    findOrCreate,
    findOne: jest.fn().mockResolvedValue(waiver),
    findAll: jest.fn().mockResolvedValue([waiver]),
    update,
  });
  getSecurityFindingEvent.mockReturnValue({ create });
  return { waiver, findOrCreate, update, create };
}

beforeEach(() => {
  getSequelize.mockReturnValue({});
});

describe('waiverService — solicitação (não isenta nada)', () => {
  it('recusa solicitação sem expiração (isenção perpétua não é representável)', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(requestWaiver({ findingKey: 'k1', reason: REASON, requestedBy: REQUESTER, now: NOW }))
      .rejects.toThrow(/waiver_expiry_required/);
  });

  it('recusa expiração no passado', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(requestWaiver({
      findingKey: 'k1', reason: REASON, requestedBy: REQUESTER, expiresAt: '2026-10-01T00:00:00.000Z', now: NOW,
    })).rejects.toThrow(/waiver_expiry_not_in_future/);
  });

  it('recusa prazo acima do limite da política e aceita dentro do limite', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    const base = { findingKey: 'k1', reason: REASON, requestedBy: REQUESTER, now: NOW };
    await expect(requestWaiver({ ...base, expiresInDays: DEFAULT_MAX_WAIVER_DAYS + 1 }))
      .rejects.toThrow(/waiver_exceeds_max_days/);

    const accepted = await requestWaiver({ ...base, expiresInDays: DEFAULT_MAX_WAIVER_DAYS });
    expect(accepted.created).toBe(true);
    expect(accepted.status).toBe(WAIVER_STATUS.PENDING_APPROVAL);
  });

  it('recusa motivo sem substância e SOLICITANTE ausente (sem autor não é trilha)', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(requestWaiver({ findingKey: 'k1', reason: 'ok', requestedBy: REQUESTER, expiresAt: FUTURE, now: NOW }))
      .rejects.toThrow(/waiver_reason_required/);
    await expect(requestWaiver({
      findingKey: 'k1', reason: 'x'.repeat(MIN_REASON_LENGTH), requestedBy: '   ', expiresAt: FUTURE, now: NOW,
    })).rejects.toThrow(/waiver_requester_required/);
  });

  it('recusa isentar achado que NÃO é risco aberto (VEX ou resolvido)', async () => {
    primeFinding(findingFixture({ status: 'NOT_AFFECTED' }));
    primeWaiverModel();
    await expect(requestWaiver({
      findingKey: 'k1', reason: REASON, requestedBy: REQUESTER, expiresAt: FUTURE, now: NOW,
    })).rejects.toThrow(/waiver_not_needed_for_vex_state/);

    primeFinding(findingFixture({ resolved_at: new Date('2026-10-01T00:00:00.000Z') }));
    await expect(requestWaiver({
      findingKey: 'k1', reason: REASON, requestedBy: REQUESTER, expiresAt: FUTURE, now: NOW,
    })).rejects.toThrow(/waiver_not_needed_for_vex_state/);
  });

  it('recusa waiver para achado inexistente (nada de isenção de fantasma)', async () => {
    primeFinding(null);
    primeWaiverModel();
    await expect(requestWaiver({
      findingKey: 'nao-existe', reason: REASON, requestedBy: REQUESTER, expiresAt: FUTURE, now: NOW,
    })).rejects.toThrow(/waiver_finding_not_found/);
  });

  it('SOLICITAR registra PENDING e NÃO mitiga o achado', async () => {
    const finding = primeFinding(findingFixture());
    const { create, findOrCreate } = primeWaiverModel();

    const result = await requestWaiver({
      findingKey: finding.finding_key,
      reason: REASON,
      requestedBy: REQUESTER,
      createdBy: REQUESTER,
      expiresInDays: 21,
      compensatingControl: 'WAF bloqueando o vetor de exploração',
      now: NOW,
    });

    expect(result.created).toBe(true);
    expect(result.status).toBe(WAIVER_STATUS.PENDING_APPROVAL);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    // Nada de mitigação: o achado não é tocado na solicitação.
    expect(finding.update).not.toHaveBeenCalled();
    // E o registro não pode afirmar aprovador inexistente.
    expect(findOrCreate.mock.calls[0][0].defaults).toMatchObject({
      status: WAIVER_STATUS.PENDING_APPROVAL,
      approved_by: null,
      approved_at: null,
      scope_hash: SCOPE_HASH,
    });
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({
      event: 'WAIVER_REQUESTED',
      actor: REQUESTER,
      detail: expect.objectContaining({ reason: REASON, scopeHash: SCOPE_HASH }),
    }));
  });

  it('é idempotente: a mesma solicitação não duplica registro', async () => {
    primeFinding(findingFixture());
    const { findOrCreate } = primeWaiverModel();
    findOrCreate.mockResolvedValueOnce([waiverRow(), true]);
    findOrCreate.mockResolvedValueOnce([waiverRow(), false]);

    const params = { findingKey: FINDING.finding_key, reason: REASON, requestedBy: REQUESTER, expiresAt: FUTURE, now: NOW };
    const first = await requestWaiver(params);
    const second = await requestWaiver(params);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(computeWaiverKey({ findingKey: FINDING.finding_key, expiresAt: FUTURE }))
      .toBe(computeWaiverKey({ findingKey: FINDING.finding_key, expiresAt: FUTURE }));
  });
});

describe('waiverService — aprovação (segregação de funções e escopo)', () => {
  it('AUTOAPROVAÇÃO é proibida: quem solicita não concede', async () => {
    primeFinding(findingFixture());
    primeWaiverModel({ waiver: waiverRow({ requested_by: REQUESTER }) });
    await expect(approveWaiver({ waiverKey: 'wk-1', approvedBy: REQUESTER, now: NOW }))
      .rejects.toThrow(/waiver_self_approval_forbidden/);
  });

  it('compara solicitante e aprovador sem depender de caixa/espaços', () => {
    expect(normalizePrincipal('  Engineer@Empresa ')).toBe('engineer@empresa');
    expect(normalizePrincipal(null)).toBeNull();
    expect(normalizePrincipal('   ')).toBeNull();
  });

  it('exige aprovador identificado (sem identidade não há aprovação)', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(approveWaiver({ waiverKey: 'wk-1', approvedBy: '   ', now: NOW }))
      .rejects.toThrow(/waiver_approver_required/);
  });

  it('waiver inexistente, revogado ou expirado não pode ser aprovado', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    getSecurityWaiver().findOne = jest.fn().mockResolvedValue(null);
    await expect(approveWaiver({ waiverKey: 'nao-existe', approvedBy: APPROVER, now: NOW }))
      .rejects.toThrow(/waiver_not_found/);

    primeWaiverModel({ waiver: waiverRow({ revoked_at: new Date('2026-10-08T00:00:00.000Z') }) });
    await expect(approveWaiver({ waiverKey: 'wk-1', approvedBy: APPROVER, now: NOW }))
      .rejects.toThrow(/waiver_revoked_cannot_approve/);

    primeWaiverModel({ waiver: waiverRow({ expires_at: '2026-10-01T00:00:00.000Z' }) });
    await expect(approveWaiver({ waiverKey: 'wk-1', approvedBy: APPROVER, now: NOW }))
      .rejects.toThrow(/waiver_expired_cannot_approve/);
  });

  it('já aprovado é idempotente (não mitiga duas vezes)', async () => {
    primeFinding(findingFixture());
    primeWaiverModel({ waiver: waiverRow({ status: WAIVER_STATUS.ACTIVE, approved_by: APPROVER }) });
    const result = await approveWaiver({ waiverKey: 'wk-1', approvedBy: APPROVER, now: NOW });
    expect(result).toMatchObject({ approved: false, reason: 'already_approved' });
  });

  it('CANCELA o perdedor da corrida: CAS de PENDING→ACTIVE (aprovação concorrente/replay)', async () => {
    const finding = primeFinding(findingFixture());
    primeWaiverModel({ updateAffected: 0 });
    await expect(approveWaiver({ waiverKey: 'wk-1', approvedBy: APPROVER, now: NOW }))
      .rejects.toThrow(/waiver_approval_conflict/);
    // O perdedor NÃO mitiga o achado.
    expect(finding.update).not.toHaveBeenCalled();
  });

  it('ESCOPO alterado após a solicitação é recusado (aprovação não é reaproveitável)', async () => {
    primeFinding(findingFixture({ severity: 'CRITICAL' }));
    primeWaiverModel({ waiver: waiverRow({ scope_hash: SCOPE_HASH }) });
    await expect(approveWaiver({ waiverKey: 'wk-1', approvedBy: APPROVER, now: NOW }))
      .rejects.toThrow(/waiver_scope_changed/);
  });

  it('caminho válido: aprova, mitiga o achado e registra o evento com proveniência', async () => {
    const finding = primeFinding(findingFixture());
    const { update, create } = primeWaiverModel();

    const result = await approveWaiver({ waiverKey: 'wk-1', approvedBy: APPROVER, now: NOW });

    expect(result).toMatchObject({ approved: true, approvedBy: APPROVER, scopeHash: SCOPE_HASH });
    const [patch, options] = update.mock.calls[0];
    expect(patch).toMatchObject({ status: WAIVER_STATUS.ACTIVE, approved_by: APPROVER, approved_at: NOW });
    expect(options.where).toMatchObject({ status: WAIVER_STATUS.PENDING_APPROVAL });
    expect(finding.update.mock.calls[0][0]).toEqual({ waiver_id: 'w1', status: 'MITIGATED' });
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({
      event: 'WAIVER_APPROVED',
      actor: APPROVER,
      to_status: 'MITIGATED',
      detail: expect.objectContaining({ requestedBy: REQUESTER, scopeHash: SCOPE_HASH }),
    }));
  });
});

describe('waiverService — revogação e vigência', () => {
  it('revogação concorrente: só um revoga', async () => {
    primeFinding(findingFixture());
    primeWaiverModel({ updateAffected: 0 });
    const result = await revokeWaiver({ waiverKey: 'wk-1', actor: 'dba', now: NOW });
    expect(result).toMatchObject({ revoked: false, reason: 'already_revoked' });
  });

  it('revogar uma SOLICITAÇÃO pendente não mexe no achado (nada estava mitigado)', async () => {
    const finding = primeFinding(findingFixture());
    const { create } = primeWaiverModel();
    const result = await revokeWaiver({ waiverKey: 'wk-1', actor: 'dba', now: NOW });
    expect(result).toMatchObject({ revoked: true, mitigated: false });
    expect(finding.update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('revogar um waiver APROVADO devolve o achado ao risco aberto com evento', async () => {
    const finding = primeFinding(findingFixture());
    const { create } = primeWaiverModel({ waiver: waiverRow({ status: WAIVER_STATUS.ACTIVE, approved_by: APPROVER }) });
    const result = await revokeWaiver({ waiverKey: 'wk-1', actor: 'dba', reason: 'correção saiu', now: NOW });
    expect(result).toMatchObject({ revoked: true, mitigated: true });
    expect(finding.update.mock.calls[0][0]).toEqual({ waiver_id: null });
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({ event: 'WAIVER_REVOKED', actor: 'dba' }));
  });

  it('vigentes exigem status ACTIVE na própria query (PENDING não isenta)', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    getSecurityWaiver.mockReturnValue({ findAll });
    await getActiveWaivers({ tenantKey: 'system', now: NOW });
    const { where } = findAll.mock.calls[0][0];
    expect(where.status).toBe(WAIVER_STATUS.ACTIVE);
    expect(where.revoked_at).toBeNull();
    expect(where.tenant_key).toBe('system');
    const { Op } = require('sequelize');
    expect(where.expires_at[Op.gt]).toBeInstanceOf(Date);
  });

  it('classifica o estado sem confundir pendente, expirado e revogado', () => {
    const base = { revoked_at: null, expires_at: FUTURE, status: WAIVER_STATUS.ACTIVE };
    expect(stateOf(base, NOW)).toBe('ACTIVE');
    expect(stateOf({ ...base, status: WAIVER_STATUS.PENDING_APPROVAL }, NOW)).toBe('PENDING_APPROVAL');
    expect(stateOf({ ...base, expires_at: '2026-10-01T00:00:00.000Z' }, NOW)).toBe('EXPIRED');
    expect(stateOf({ ...base, revoked_at: new Date('2026-10-02T00:00:00.000Z') }, NOW)).toBe('REVOKED');
    expect(stateOf({ ...base, expires_at: 'data-invalida' }, NOW)).toBe('INVALID_EXPIRY');
  });
});

describe('waiverService — contrato com o gate de release', () => {
  it('entrega o formato consumido pelo motor (findingKey + expiresAt)', async () => {
    primeFinding(findingFixture());
    const { waiver } = primeWaiverModel();

    const result = await waiversForGate({ tenantKey: 'system', now: NOW });
    expect(result.rejected).toEqual([]);
    expect(result.waivers).toHaveLength(1);
    expect(result.waivers[0]).toMatchObject({
      findingKey: waiver.finding_key,
      expiresAt: FUTURE,
      approvedBy: null,
      scopeHash: SCOPE_HASH,
    });
  });

  it('RECUSA entregar como isenção um waiver cujo escopo mudou (e diz o motivo)', async () => {
    primeFinding(findingFixture({ severity: 'CRITICAL' }));
    primeWaiverModel({ waiver: waiverRow({ scope_hash: SCOPE_HASH }) });

    const result = await waiversForGate({ tenantKey: 'system', now: NOW });
    expect(result.waivers).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ waiverKey: 'wk-1', reason: 'waiver_scope_changed' }),
    ]);
  });

  it('normalizeCreation é puro, deriva o hash de escopo e não depende de banco', () => {
    const normalized = normalizeCreation({
      finding: findingFixture(),
      findingKey: FINDING.finding_key,
      reason: 'motivo suficientemente longo para auditoria',
      requestedBy: REQUESTER,
      expiresInDays: 10,
      now: NOW,
    });
    expect(normalized.expiresAt.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(normalized.requestedBy).toBe(REQUESTER);
    expect(normalized.scopeHash).toHaveLength(40);
    expect(normalized.scopeHash).toBe(computeScopeHash({
      findingKey: FINDING.finding_key,
      advisoryId: FINDING.advisory_id,
      packageName: FINDING.package_name,
      service: FINDING.service,
      severity: FINDING.severity,
      expiresAt: normalized.expiresAt,
    }));
  });

  it('hash de escopo muda quando o escopo muda (pacote, serviço, severidade ou prazo)', () => {
    const base = {
      findingKey: 'k1', advisoryId: 'a1', packageName: 'ws', service: 'api', severity: 'HIGH', expiresAt: FUTURE,
    };
    const variants = [
      { ...base, packageName: 'ws2' },
      { ...base, service: 'rag-service' },
      { ...base, severity: 'CRITICAL' },
      { ...base, expiresAt: '2026-11-30T00:00:00.000Z' },
    ];
    const original = computeScopeHash(base);
    for (const variant of variants) {
      expect(computeScopeHash(variant)).not.toBe(original);
    }
  });
});
