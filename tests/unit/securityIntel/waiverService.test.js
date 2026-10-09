'use strict';

/**
 * Testes do mecanismo de waivers (isenção formal e TEMPORÁRIA de risco).
 *
 * O que está sendo protegido aqui é o oposto de "silenciar o gate":
 *   - sem expiração, com expiração passada ou com prazo acima do limite ⇒ RECUSA
 *     (isenção perpétua não é representável);
 *   - motivo vazio/curto ou aprovador ausente ⇒ RECUSA (isenção sem autor não é
 *     trilha de auditoria);
 *   - achado que NÃO é risco aberto (VEX `NOT_AFFECTED`/`FALSE_POSITIVE` ou já
 *     resolvido) ⇒ RECUSA: isentar o que não é risco é maquiagem de métrica;
 *   - o caminho válido grava o vínculo no achado E um evento auditável;
 *   - o formato entregue ao gate é `{ findingKey, expiresAt }`, com a expiração
 *     revalidada pelo próprio motor.
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
  computeWaiverKey,
  stateOf,
  normalizeCreation,
  createWaiver,
  getActiveWaivers,
  waiversForGate,
} = require('../../../api/services/securityIntel/waiverService');

const NOW = new Date('2026-10-09T00:00:00.000Z');
const FUTURE = '2026-10-30T00:00:00.000Z';

function findingFixture(overrides = {}) {
  return {
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
    update: jest.fn(async function update(patch) { Object.assign(this, patch); return this; }),
    ...overrides,
  };
}

function primeFinding(finding) {
  getSecurityFinding.mockReturnValue({ findOne: jest.fn().mockResolvedValue(finding) });
  return finding;
}

function primeWaiverModel() {
  const waiverRow = { id: 'w1', tenant_key: 'system', expires_at: FUTURE, toJSON: () => waiverRow };
  const findOrCreate = jest.fn().mockResolvedValue([waiverRow, true]);
  const create = jest.fn().mockResolvedValue({ id: 'e1' });
  getSecurityWaiver.mockReturnValue({ findOrCreate, findOne: jest.fn(), findAll: jest.fn() });
  getSecurityFindingEvent.mockReturnValue({ create });
  return { waiverRow, findOrCreate, create };
}

beforeEach(() => {
  getSequelize.mockReturnValue({});
});

describe('waiverService — recusas que protegem o gate', () => {
  it('recusa waiver sem expiração (isenção perpétua não é representável)', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(createWaiver({
      findingKey: 'k1',
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      now: NOW,
    })).rejects.toThrow(/waiver_expiry_required/);
  });

  it('recusa expiração no passado', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(createWaiver({
      findingKey: 'k1',
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      expiresAt: '2026-10-01T00:00:00.000Z',
      now: NOW,
    })).rejects.toThrow(/waiver_expiry_not_in_future/);
  });

  it('recusa prazo acima do limite da política e aceita dentro do limite', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    const base = {
      findingKey: 'k1',
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      now: NOW,
    };
    await expect(createWaiver({ ...base, expiresInDays: DEFAULT_MAX_WAIVER_DAYS + 1 }))
      .rejects.toThrow(/waiver_exceeds_max_days/);

    await expect(createWaiver({ ...base, expiresInDays: DEFAULT_MAX_WAIVER_DAYS }))
      .resolves.toMatchObject({ created: true });
  });

  it('recusa motivo sem substância e aprovador ausente', async () => {
    primeFinding(findingFixture());
    primeWaiverModel();
    await expect(createWaiver({ findingKey: 'k1', reason: 'ok', approvedBy: 'cto', expiresAt: FUTURE, now: NOW }))
      .rejects.toThrow(/waiver_reason_required/);
    await expect(createWaiver({
      findingKey: 'k1',
      reason: 'x'.repeat(MIN_REASON_LENGTH),
      approvedBy: '   ',
      expiresAt: FUTURE,
      now: NOW,
    })).rejects.toThrow(/waiver_approver_required/);
  });

  it('recusa isentar achado que NÃO é risco aberto (VEX ou resolvido)', async () => {
    primeFinding(findingFixture({ status: 'NOT_AFFECTED' }));
    primeWaiverModel();
    await expect(createWaiver({
      findingKey: 'k1',
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      expiresAt: FUTURE,
      now: NOW,
    })).rejects.toThrow(/waiver_not_needed_for_vex_state/);

    primeFinding(findingFixture({ status: 'FIX_AVAILABLE', resolved_at: new Date('2026-10-01T00:00:00.000Z') }));
    await expect(createWaiver({
      findingKey: 'k1',
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      expiresAt: FUTURE,
      now: NOW,
    })).rejects.toThrow(/waiver_not_needed_for_vex_state/);
  });

  it('recusa waiver para achado inexistente (nada de isenção de fantasma)', async () => {
    primeFinding(null);
    primeWaiverModel();
    await expect(createWaiver({
      findingKey: 'nao-existe',
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      expiresAt: FUTURE,
      now: NOW,
    })).rejects.toThrow(/waiver_finding_not_found/);
  });
});

describe('waiverService — caminho válido e contrato de saída', () => {
  it('cria o waiver, vincula ao achado e grava evento auditável', async () => {
    const finding = primeFinding(findingFixture());
    const { create, findOrCreate } = primeWaiverModel();

    const result = await createWaiver({
      findingKey: finding.finding_key,
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      createdBy: 'engineer@empresa',
      expiresInDays: 21,
      compensatingControl: 'WAF bloqueando o vetor de exploração',
      now: NOW,
    });

    expect(result.created).toBe(true);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    // Vínculo no achado: é o que faz o motor de risco marcar MITIGATED.
    // O segundo argumento é o contexto de transação (undefined quando o
    // Sequelize não oferece transação, como nos mocks).
    expect(finding.update.mock.calls[0][0]).toEqual({ waiver_id: 'w1', status: 'MITIGATED' });
    // Evento: quem aceitou, por quê e até quando.
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({
      finding_key: finding.finding_key,
      event: 'WAIVER_APPLIED',
      to_status: 'MITIGATED',
      actor: 'cto@empresa',
      detail: expect.objectContaining({
        reason: 'risco aceito temporariamente enquanto o patch não sai',
        expiresAt: expect.any(String),
        compensatingControl: 'WAF bloqueando o vetor de exploração',
      }),
    }));
  });

  it('é idempotente: mesma isenção não duplica registro', async () => {
    const finding = primeFinding(findingFixture());
    const { findOrCreate } = primeWaiverModel();
    findOrCreate.mockResolvedValueOnce([{ id: 'w1' }, true]);
    findOrCreate.mockResolvedValueOnce([{ id: 'w1' }, false]);

    const params = {
      findingKey: finding.finding_key,
      reason: 'risco aceito temporariamente enquanto o patch não sai',
      approvedBy: 'cto@empresa',
      expiresAt: FUTURE,
      now: NOW,
    };
    const first = await createWaiver(params);
    const second = await createWaiver(params);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(computeWaiverKey({ findingKey: finding.finding_key, expiresAt: FUTURE }))
      .toBe(computeWaiverKey({ findingKey: finding.finding_key, expiresAt: FUTURE }));
  });

  it('entrega ao gate o formato que ele consome (findingKey + expiresAt)', async () => {
    getSecurityWaiver.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([{
        finding_key: 'GHSA-aaaa::pkg:npm/ws@8.20.0',
        expires_at: FUTURE,
        waiver_key: 'wk-1',
        approved_by: 'cto@empresa',
        reason: 'motivo com substância suficiente',
      }]),
    });

    const waivers = await waiversForGate({ tenantKey: 'system', now: NOW });
    expect(waivers).toHaveLength(1);
    expect(waivers[0]).toMatchObject({
      findingKey: 'GHSA-aaaa::pkg:npm/ws@8.20.0',
      expiresAt: FUTURE,
      approvedBy: 'cto@empresa',
    });
  });

  it('classifica o estado do waiver sem confundir expirado com vigente', () => {
    const base = { revoked_at: null, expires_at: FUTURE };
    expect(stateOf(base, NOW)).toBe('ACTIVE');
    expect(stateOf({ ...base, expires_at: '2026-10-01T00:00:00.000Z' }, NOW)).toBe('EXPIRED');
    expect(stateOf({ ...base, revoked_at: new Date('2026-10-02T00:00:00.000Z') }, NOW)).toBe('REVOKED');
    expect(stateOf({ ...base, expires_at: 'data-invalida' }, NOW)).toBe('INVALID_EXPIRY');
  });

  it('consulta de vigentes filtra revogado e expirado na própria query', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    getSecurityWaiver.mockReturnValue({ findAll });
    await getActiveWaivers({ tenantKey: 'system', now: NOW });
    const { where } = findAll.mock.calls[0][0];
    expect(where.revoked_at).toBeNull();
    expect(where.tenant_key).toBe('system');
    // O operador vem como Symbol (`Op.gt`) nesta versão do Sequelize: comparar
    // pela chave literal daria falso negativo.
    const { Op } = require('sequelize');
    expect(where.expires_at[Op.gt]).toBeInstanceOf(Date);
    expect(where.expires_at[Op.gt].getTime()).toBe(NOW.getTime());
  });

  it('normalizeCreation é puro e não depende de banco', () => {
    const normalized = normalizeCreation({
      finding: findingFixture(),
      findingKey: 'k1',
      reason: 'motivo suficientemente longo para auditoria',
      approvedBy: 'cto@empresa',
      expiresInDays: 10,
      now: NOW,
    });
    expect(normalized.expiresAt.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(normalized.createdBy).toBe('cto@empresa');
  });
});
