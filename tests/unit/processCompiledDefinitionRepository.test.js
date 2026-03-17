'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const {
  InMemoryProcessCompiledDefinitionRepository,
} = require('../../api/core/process-runtime/processCompiledDefinitionRepository');

describe('InMemoryProcessCompiledDefinitionRepository', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('salva e carrega processo compilado no caminho nominal', withTimeout(async () => {
    const repository = new InMemoryProcessCompiledDefinitionRepository();

    const saved = await repository.saveCompiledProcess({
      tenantId: 'tenant-1',
      compiledProcess: {
        id: 'proc-1',
        version: 2,
        metadata: { tenantId: 'tenant-1', sourceFormat: 'canonical' },
        nodes: [{ id: 'start-1', type: 'start' }],
      },
      sourceDefinition: { id: 'proc-1', nodes: [] },
      sourceType: 'canonical',
    });

    const loaded = await repository.loadCompiledProcess({
      tenantId: 'tenant-1',
      processId: 'proc-1',
      processVersion: 2,
    });

    expect(saved.processId).toBe('proc-1');
    expect(saved.processVersion).toBe(2);
    expect(saved.sourceType).toBe('canonical');
    expect(loaded.id).toBe('proc-1');
    expect(loaded.version).toBe(2);
    expect(loaded.metadata).toEqual({ tenantId: 'tenant-1', sourceFormat: 'canonical' });
  }, 5000));

  test('saveCompiledProcess tolera sourceDefinition e metadata hostis com fallback seguro', withTimeout(async () => {
    const repository = new InMemoryProcessCompiledDefinitionRepository();

    const { proxy: hostileMetadata, revoke: revokeMetadata } = Proxy.revocable({ tenantId: 'tenant-hostile' }, {});
    revokeMetadata();

    const { proxy: hostileDefinition, revoke: revokeDefinition } = Proxy.revocable({ id: 'flow-hostile' }, {});
    revokeDefinition();

    const saved = await repository.saveCompiledProcess({
      tenantId: 'tenant-hostile',
      compiledProcess: {
        id: 'proc-hostile',
        version: 1,
        metadata: hostileMetadata,
      },
      sourceDefinition: hostileDefinition,
      sourceType: 'engine',
    });

    const loaded = await repository.loadCompiledProcess({
      tenantId: 'tenant-hostile',
      processId: 'proc-hostile',
      processVersion: 1,
    });

    expect(saved.processId).toBe('proc-hostile');
    expect(saved.metadata).toEqual({});
    expect(saved.sourceDefinition).toBeNull();
    expect(loaded).toMatchObject({ id: 'proc-hostile', version: 1 });
    expect(loaded.metadata).toEqual({});
  }, 5000));

  test('saveCompiledProcess retorna null para compiledProcess revogado sem lançar', withTimeout(async () => {
    const repository = new InMemoryProcessCompiledDefinitionRepository();

    const { proxy: hostileCompiled, revoke } = Proxy.revocable({ id: 'proc-revoked', version: 1 }, {});
    revoke();

    const saved = await repository.saveCompiledProcess({
      tenantId: 'tenant-1',
      compiledProcess: hostileCompiled,
    });

    expect(saved).toBeNull();
  }, 5000));

  test('loadCompiledProcess tolera processId hostil e retorna null', withTimeout(async () => {
    const repository = new InMemoryProcessCompiledDefinitionRepository();

    await repository.saveCompiledProcess({
      tenantId: 'tenant-safe',
      compiledProcess: {
        id: 'proc-safe',
        version: 1,
      },
    });

    const { proxy: hostileProcessId, revoke } = Proxy.revocable({ value: 'proc-safe' }, {});
    revoke();

    const loaded = await repository.loadCompiledProcess({
      tenantId: 'tenant-safe',
      processId: hostileProcessId,
      processVersion: 1,
    });

    expect(loaded).toBeNull();
  }, 5000));
});
