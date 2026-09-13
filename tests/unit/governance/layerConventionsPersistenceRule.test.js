'use strict';

/**
 * TAREFA de governança de camadas — a regra de "fallback em memória" precisa ser
 * PRECISA, não apenas conservadora.
 *
 * Defeito real: a heurística `/\bfallback.*memory\b/i` acusava como violação de
 * persistência uma linha do `api/services/systemStatusService.js` que apenas
 * REPORTA o status do Redis:
 *
 *     const allowRedisToMemoryFallback = config.get('fallbacks.rateLimitRedisToMemory', false) === true;
 *
 * Esse serviço marca produção como `unhealthy` quando o Redis falta (fail-closed)
 * e o único fallback existente é de RATE LIMITING (`infra/rate-limit`), não de
 * persistência de estado de domínio. Acusar a linha obrigava a escolher entre
 * "deixar o gate vermelho para sempre" ou "esconder a política do relatório" —
 * as duas ruins.
 *
 * Este arquivo fixa o contrato da regra nos DOIS sentidos:
 *   - os casos REAIS de fallback em memória continuam sendo detectados
 *     (a regra NÃO foi afrouxada);
 *   - linhas que apenas descrevem/leem a política não são acusadas.
 */

const { isInMemoryFallbackLine } = require('../../../scripts/governance/validate-layer-conventions');

describe('regra de fallback em memória — os padrões originais continuam valendo', () => {
  const VIOLATIONS = [
    'const inMemory = [];',
    'inMemory = true;',
    'this.cache = {};',
    'const store = cache = {};',
    // Padrões textuais que a regra cobre (palavras separadas), como apareceriam
    // numa descrição de estratégia no código.
    'const strategy = fallback ? memory : disk;',
    'rows = memory fallback || loadFromMemory();',
  ];

  test.each(VIOLATIONS)('detecta: %s', (line) => {
    expect(isInMemoryFallbackLine(line)).toBe(true);
  });

  test('linha que constrói store em memória É detectada mesmo lendo config', () => {
    // Se a mesma linha consulta config E constrói o store, ela é a degradação.
    expect(isInMemoryFallbackLine("if (config.get('x')) { cache = {}; }")).toBe(true);
  });
});

describe('regra de fallback em memória — leitura de política não é degradação', () => {
  const ALLOWED = [
    // A linha real do falso positivo.
    "const allowRedisToMemoryFallback = config.get('fallbacks.rateLimitRedisToMemory', false) === true;",
    "const mode = config.get('fallbacks.inMemoryStore', 'disabled');",
    'const enabled = process.env.RATE_LIMIT_MEMORY_FALLBACK;',
  ];

  test.each(ALLOWED)('não acusa: %s', (line) => {
    expect(isInMemoryFallbackLine(line)).toBe(false);
  });

  test('linha vazia ou comentário nunca é violação', () => {
    expect(isInMemoryFallbackLine('')).toBe(false);
    expect(isInMemoryFallbackLine('   ')).toBe(false);
    expect(isInMemoryFallbackLine('// fallback em memória desabilitado')).toBe(false);
    expect(isInMemoryFallbackLine('* fallback em memória não é permitido')).toBe(false);
  });
});
