const { compileFlow, _internal } = require('../compileFlow');

describe('compileFlow', () => {
  test('produz um fluxo imutável e desconectado do original', () => {
    const flow = {
      tenantId: 't1',
      id: 'flow-1',
      name: 'Teste',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: 'end', config: { text: 'Olá' } },
        { id: 'end', type: 'end' },
      ],
      metadata: { createdBy: 'tester' },
    };

    const compiled = compileFlow(flow);

    // Estrutura básica preservada
    expect(compiled.id).toBe(flow.id);
    expect(compiled.nodes).toHaveLength(2);

    // Deep clone: alterar o original não afeta o compilado
    flow.id = 'flow-2';
    flow.nodes[0].config.text = 'Alterado';
    expect(compiled.id).toBe('flow-1');
    expect(compiled.nodes[0].config.text).toBe('Olá');

    // Imutabilidade: tentar mutar deve falhar em modo strict
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.nodes)).toBe(true);
    expect(Object.isFrozen(compiled.nodes[0])).toBe(true);

    // Hash de versão presente
    expect(typeof compiled.versionHash).toBe('string');
    expect(compiled.versionHash.length).toBeGreaterThan(0);
  });

  test('lança erro para fluxo inválido (null/undefined)', () => {
    expect(() => compileFlow(null)).toThrow();
    expect(() => compileFlow(undefined)).toThrow();
  });

  test('deepClonePlain cria cópia independente', () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = _internal.deepClonePlain(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.b).not.toBe(obj.b);
  });

  test('computeStringHash gera mesmo hash para mesmo conteúdo canônico', () => {
    const a = { b: 1, a: { c: 2 } };
    const b = { a: { c: 2 }, b: 1 }; // mesma estrutura, ordem diferente

    const jsonA = _internal.toCanonicalJson(a);
    const jsonB = _internal.toCanonicalJson(b);

    expect(jsonA).toBe(jsonB);

    const hashA = _internal.computeStringHash(jsonA);
    const hashB = _internal.computeStringHash(jsonB);
    expect(hashA).toBe(hashB);
  });
});


