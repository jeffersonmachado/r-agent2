const { normalizeFlow } = require('../flowNormalizer');
const { validateFlow, _internal } = require('../validator');

describe('flowNormalizer', () => {
  const tenantId = 't-flow-normalizer';

  test('falha em múltiplas entradas em nó decisório (options)', () => {
    const inputFlow = {
      tenantId,
      id: 'flow-normalize-example',
      name: 'FlowNormalizer example',
      version: 1,
      nodes: [
        // start com múltiplas saídas (array) é permitido pelo schema/validator
        { id: 'start', type: 'start', next: ['msgA', 'msgB'] },
        { id: 'msgA', type: 'message', config: { text: 'A' }, next: 'opt1' },
        { id: 'msgB', type: 'message', config: { text: 'B' }, next: 'opt1' },

        // options com duas entradas (msgA e msgB) + next ausente (inválido)
        {
          id: 'opt1',
          type: 'options',
          config: {
            optionsType: 'button',
            variable: 'choice',
            options: [{ id: 'o1', label: 'Opção 1' }],
          },
          // next ausente propositalmente
        },

        // nó órfão (sem entradas)
        { id: 'orphan', type: 'message', config: { text: 'Sou órfão' } },

        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    expect(() => normalizeFlow(inputFlow)).toThrow(/múltiplas entradas|múltiplas/i);
  });

  test('fan-in válido em merge apontando para end passa', () => {
    const inputFlow = {
      tenantId,
      id: 'flow-merge-to-message',
      name: 'Flow merge->message',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['msgA', 'msgB'] },
        { id: 'msgA', type: 'message', config: { text: 'A' }, next: 'merge1' },
        { id: 'msgB', type: 'message', config: { text: 'B' }, next: 'merge1' },
        // merge com múltiplas entradas deve ser aceito (não deve receber outro merge antes dele)
        { id: 'merge1', type: 'merge', next: 'end' },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const normalized = normalizeFlow(inputFlow);

    // Deve manter o merge original sem criar merge_ antes dele (merge->merge)
    const mergeNode = normalized.nodes.find((n) => n && n.id === 'merge1');
    expect(mergeNode).toBeDefined();
    expect(mergeNode.type).toBe('merge');
    expect(mergeNode.next).toBe('end');

    const validation = validateFlow(normalized);
    expect(validation.valid).toBe(true);
  });

  test('merge usado como retorno (merge -> options) falha', () => {
    const inputFlow = {
      tenantId,
      id: 'flow-merge-to-decision-fail',
      name: 'Flow merge->options fail',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['a', 'b'] },
        { id: 'a', type: 'message', config: { text: 'A' }, next: 'merge1' },
        { id: 'b', type: 'message', config: { text: 'B' }, next: 'merge1' },
        { id: 'merge1', type: 'merge', next: 'menu' },
        {
          id: 'menu',
          type: 'options',
          config: {
            optionsType: 'button',
            variable: 'choice',
            options: [{ id: 'o1', label: 'Opção 1' }],
          },
          next: { out: 'end', fallback: 'end' },
        },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    expect(() => normalizeFlow(inputFlow)).toThrow(/merge.*apontar|merge.*só pode/i);
  });

  test('fan-in válido direto em end passa (sem merge)', () => {
    const inputFlow = {
      tenantId,
      id: 'flow-fanin-end-pass',
      name: 'Flow fan-in end pass',
      version: 1,
      nodes: [
        { id: 'start', type: 'start', next: ['a', 'b'] },
        { id: 'a', type: 'message', config: { text: 'A' }, next: 'end' },
        { id: 'b', type: 'message', config: { text: 'B' }, next: 'end' },
        { id: 'end', type: 'end' },
      ],
      metadata: {},
    };

    const normalized = normalizeFlow(inputFlow);
    const validation = validateFlow(normalized);
    expect(validation.valid).toBe(true);
  });
});

