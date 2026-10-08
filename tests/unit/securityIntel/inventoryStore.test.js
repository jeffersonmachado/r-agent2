'use strict';

/**
 * Testes do serviço de persistência do inventário.
 *
 * Provas exigidas:
 *   - A chave idempotente deriva do CONTEÚDO (não do relógio): repetir a mesma
 *     coleta não cria execução nova; qualquer fato diferente cria.
 *   - Falha de banco vira erro EXPLÍCITO `persistence_required` — nunca escrita
 *     silenciosa em memória nem sucesso falso.
 *   - Reexecução idempotente não reescreve inventário.
 */

const logger = require('../../../api/utils/logger');

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../api/db/sequelize', () => ({
  connect: jest.fn(),
  getSequelize: jest.fn(),
}));

jest.mock('../../../api/db/models/SecurityComponent', () => jest.fn());
jest.mock('../../../api/db/models/SecurityComponentVersion', () => jest.fn());
jest.mock('../../../api/db/models/SecurityDiscoveryRun', () => jest.fn());
jest.mock('../../../api/db/models/SecuritySbomSnapshot', () => jest.fn());

const { connect, getSequelize } = require('../../../api/db/sequelize');
const getSecurityComponent = require('../../../api/db/models/SecurityComponent');
const getSecurityComponentVersion = require('../../../api/db/models/SecurityComponentVersion');
const getSecurityDiscoveryRun = require('../../../api/db/models/SecurityDiscoveryRun');
const {
  computeDiscoveryIdempotencyKey,
  persistDiscovery,
} = require('../../../api/services/securityIntel/inventoryStoreService');

function makeDiscovery(overrides = {}) {
  return {
    generatedAt: '2026-10-08T12:00:00.000Z',
    components: [
      {
        bomRef: 'npm:left@1.0.0#RESOLVED#api',
        fingerprint: 'fp-left',
        ecosystem: 'npm',
        name: 'left',
        version: '1.0.0',
        versionClass: 'RESOLVED',
        service: 'api',
        source: 'package-lock.json',
      },
    ],
    requirements: [{ ecosystem: 'npm', name: 'left', range: '^1.0.0', service: 'api', source: 'package.json' }],
    dependencyEdges: [],
    drift: [],
    identityConflicts: [],
    sources: [{ id: 'npm-lock:package-lock.json', status: 'READ', itemCount: 1 }],
    warnings: [],
    unavailable: [],
    counts: { components: 1 },
    coverage: { coveragePercent: 100 },
    ...overrides,
  };
}

describe('inventoryStoreService — chave idempotente', () => {
  test('é determinística para o mesmo conteúdo', () => {
    expect(computeDiscoveryIdempotencyKey(makeDiscovery())).toBe(computeDiscoveryIdempotencyKey(makeDiscovery()));
  });

  test('muda quando um componente muda (fingerprint ou identidade)', () => {
    const base = computeDiscoveryIdempotencyKey(makeDiscovery());
    const changedFingerprint = makeDiscovery();
    changedFingerprint.components[0].fingerprint = 'fp-outro';
    expect(computeDiscoveryIdempotencyKey(changedFingerprint)).not.toBe(base);

    const addedComponent = makeDiscovery();
    addedComponent.components.push({ ...addedComponent.components[0], bomRef: 'npm:right@2.0.0#RESOLVED#api' });
    expect(computeDiscoveryIdempotencyKey(addedComponent)).not.toBe(base);
  });

  test('muda quando a indisponibilidade muda (não olhar é diferente de não achar)', () => {
    const base = computeDiscoveryIdempotencyKey(makeDiscovery());
    const withUnavailable = makeDiscovery({ unavailable: [{ source: 'pg:SELECT version()', reason: 'probe_not_provided' }] });
    expect(computeDiscoveryIdempotencyKey(withUnavailable)).not.toBe(base);
  });

  test('ignora o relógio (generatedAt não participa)', () => {
    const base = computeDiscoveryIdempotencyKey(makeDiscovery());
    const other = computeDiscoveryIdempotencyKey(makeDiscovery({ generatedAt: '2030-01-01T00:00:00.000Z' }));
    expect(other).toBe(base);
  });
});

describe('inventoryStoreService — persistência', () => {
  const componentModel = {
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
  };
  const versionModel = { findAll: jest.fn(), bulkCreate: jest.fn() };
  const runModel = { findOne: jest.fn(), create: jest.fn() };

  beforeEach(() => {
    // `resetMocks: true` no jest.config apaga implementações: reestabelecer aqui.
    logger.info.mockImplementation(() => {});
    getSequelize.mockReturnValue({ fn: jest.fn(), col: jest.fn() });
    connect.mockResolvedValue({});
    getSecurityComponent.mockReturnValue(componentModel);
    getSecurityComponentVersion.mockReturnValue(versionModel);
    getSecurityDiscoveryRun.mockReturnValue(runModel);
    componentModel.findAll.mockReset();
    componentModel.bulkCreate.mockReset();
    versionModel.findAll.mockReset();
    versionModel.bulkCreate.mockReset();
    runModel.findOne.mockReset();
    runModel.create.mockReset();
  });

  test('reexecução do mesmo inventário é idempotente e não escreve', async () => {
    runModel.findOne.mockResolvedValue({ id: 'run-existente' });
    const result = await persistDiscovery({ discovery: makeDiscovery() });
    expect(result).toEqual({
      runId: 'run-existente',
      components: 1,
      versionsAppended: 0,
      idempotent: true,
    });
    expect(componentModel.bulkCreate).not.toHaveBeenCalled();
    expect(runModel.create).not.toHaveBeenCalled();
  });

  test('primeira execução grava componentes, observações e a execução', async () => {
    runModel.findOne.mockResolvedValue(null);
    componentModel.findAll
      .mockResolvedValueOnce([]) // componentes existentes
      .mockResolvedValueOnce([{ id: 'comp-1', bom_ref: 'npm:left@1.0.0#RESOLVED#api' }]); // pós-upsert
    componentModel.bulkCreate.mockResolvedValue([]);
    versionModel.findAll.mockResolvedValue([]);
    versionModel.bulkCreate.mockResolvedValue([]);
    runModel.create.mockImplementation(async (row) => row);

    const result = await persistDiscovery({ discovery: makeDiscovery(), actor: 'qa' });

    expect(result.idempotent).toBe(false);
    expect(result.components).toBe(1);
    expect(result.versionsAppended).toBe(1);
    expect(componentModel.bulkCreate).toHaveBeenCalledTimes(1);
    expect(versionModel.bulkCreate).toHaveBeenCalledTimes(1);
    const versionRows = versionModel.bulkCreate.mock.calls[0][0];
    expect(versionRows[0]).toMatchObject({
      component_id: 'comp-1',
      version: '1.0.0',
      version_class: 'RESOLVED',
      run_id: result.runId,
    });
    const runRow = runModel.create.mock.calls[0][0];
    expect(runRow.status).toBe('PASS');
    expect(runRow.actor).toBe('qa');
    expect(runRow.idempotency_key).toBe(computeDiscoveryIdempotencyKey(makeDiscovery()));
  });

  test('conflito de identidade marca a execução como DEGRADED (não PASS)', async () => {
    runModel.findOne.mockResolvedValue(null);
    componentModel.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    componentModel.bulkCreate.mockResolvedValue([]);
    versionModel.findAll.mockResolvedValue([]);
    runModel.create.mockImplementation(async (row) => row);

    await persistDiscovery({
      discovery: makeDiscovery({ identityConflicts: [{ bomRef: 'npm:x@1.0.0#RESOLVED#api' }] }),
    });
    expect(runModel.create.mock.calls[0][0].status).toBe('DEGRADED');
  });

  test('observação já existente não é reescrita', async () => {
    runModel.findOne.mockResolvedValue(null);
    componentModel.findAll
      .mockResolvedValueOnce([{ id: 'comp-1', bom_ref: 'npm:left@1.0.0#RESOLVED#api', fingerprint: 'fp-left' }])
      .mockResolvedValueOnce([{ id: 'comp-1', bom_ref: 'npm:left@1.0.0#RESOLVED#api' }]);
    componentModel.bulkCreate.mockResolvedValue([]);
    versionModel.findAll.mockResolvedValue([{
      component_id: 'comp-1',
      version: '1.0.0',
      version_class: 'RESOLVED',
      fingerprint: 'fp-left',
    }]);
    runModel.create.mockImplementation(async (row) => row);

    const result = await persistDiscovery({ discovery: makeDiscovery() });
    expect(result.versionsAppended).toBe(0);
    expect(versionModel.bulkCreate).not.toHaveBeenCalled();
  });

  test('banco indisponível falha com persistence_required (sem fallback silencioso)', async () => {
    getSequelize.mockReturnValue(null);
    connect.mockRejectedValue(new Error('conexão recusada'));

    await expect(persistDiscovery({ discovery: makeDiscovery() })).rejects.toMatchObject({
      code: 'persistence_required',
    });
    expect(runModel.create).not.toHaveBeenCalled();
  });

  test('descoberta inválida é rejeitada antes de tocar o banco', async () => {
    await expect(persistDiscovery({ discovery: { components: null } })).rejects.toThrow(/security_intel_discovery_required/);
  });
});
