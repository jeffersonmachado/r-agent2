/**
 * Testes de Runtime - Escalonamento.
 * 
 * Valida que:
 * - Falha recorrente escala
 * - QaResult gerado corretamente
 */

const { mergeRuntimeChecks } = require('../../qa/runtime-to-checks');

// Função auxiliar para testar lógica de análise (extraída de runtime-to-checks.js)
function analyzeRuntimeFailuresLogic(results, threshold = 3) {
  const failureMap = new Map();

  results.forEach(result => {
    if (result.meta?.source !== 'runtime') return;
    if (result.status !== 'FAIL') return;

    result.checks.forEach(check => {
      if (check.result === 'FAIL') {
        const checkId = check.id;
        if (!failureMap.has(checkId)) {
          failureMap.set(checkId, {
            id: checkId,
            count: 0,
            firstSeen: result.meta.timestamp,
            lastSeen: result.meta.timestamp,
            details: check.details,
            blocking: check.blocking || false
          });
        }

        const entry = failureMap.get(checkId);
        entry.count++;
        if (result.meta.timestamp > entry.lastSeen) {
          entry.lastSeen = result.meta.timestamp;
        }
        if (result.meta.timestamp < entry.firstSeen) {
          entry.firstSeen = result.meta.timestamp;
        }
      }
    });
  });

  const autoChecks = [];
  failureMap.forEach((entry, checkId) => {
    if (entry.count >= threshold) {
      autoChecks.push({
        id: `runtime.auto.${checkId}`,
        result: 'FAIL',
        blocking: true,
        details: {
          source: 'runtime-analysis',
          originalCheckId: checkId,
          occurrenceCount: entry.count,
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
          threshold,
          message: `Falha recorrente detectada: ${checkId} ocorreu ${entry.count} vezes (threshold: ${threshold})`,
          originalDetails: entry.details
        }
      });
    }
  });

  return autoChecks;
}

// Mock de telemetria para testes
function createMockQaResults(failures) {
  return failures.map((failure, index) => ({
    status: 'FAIL',
    scope: ['runtime'],
    checks: [
      {
        id: failure.checkId,
        result: 'FAIL',
        blocking: failure.blocking || false,
        details: failure.details || {}
      }
    ],
    meta: {
      timestamp: new Date(Date.now() - (failures.length - index) * 1000).toISOString(),
      source: 'runtime'
    }
  }));
}

describe('Runtime - Escalonamento', () => {
  
  describe('Falha recorrente deve escalar', () => {
    test('deve detectar falha recorrente acima do threshold', () => {
      // Simula 5 ocorrências da mesma falha (threshold = 3)
      const mockFailures = createMockQaResults([
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false }
      ]);

      const autoChecks = analyzeRuntimeFailuresLogic(mockFailures, 3);

      // Deve gerar check automático para falha recorrente
      expect(autoChecks.length).toBeGreaterThan(0);
      const recurringCheck = autoChecks.find(c => c.id.includes('runtime.test.failure'));
      expect(recurringCheck).toBeDefined();
      expect(recurringCheck.blocking).toBe(true); // Após threshold, vira blocking
      expect(recurringCheck.details.occurrenceCount).toBe(5);
    });

    test('não deve escalar falha abaixo do threshold', () => {
      // Simula 2 ocorrências (threshold = 3)
      const mockFailures = createMockQaResults([
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false }
      ]);

      const autoChecks = analyzeRuntimeFailuresLogic(mockFailures, 3);

      // Não deve gerar check automático
      expect(autoChecks.length).toBe(0);
    });
  });

  describe('QaResult deve ser gerado corretamente', () => {
    test('deve gerar QaResult com checks runtime', () => {
      const mockFailures = createMockQaResults([
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false },
        { checkId: 'runtime.test.failure', blocking: false }
      ]);

      const runtimeChecks = analyzeRuntimeFailuresLogic(mockFailures, 3);

      // Deve gerar checks
      expect(runtimeChecks.length).toBeGreaterThan(0);
      
      // Cada check deve ter estrutura válida
      runtimeChecks.forEach(check => {
        expect(check).toHaveProperty('id');
        expect(check).toHaveProperty('result', 'FAIL');
        expect(check).toHaveProperty('blocking', true);
        expect(check).toHaveProperty('details');
        expect(check.details).toHaveProperty('source', 'runtime-analysis');
        expect(check.details).toHaveProperty('occurrenceCount');
      });
    });

    test('QaResult deve incluir escopo telemetry quando há checks runtime', () => {
      const qaResult = {
        status: 'PASS',
        scope: ['contracts'],
        checks: [],
        meta: {
          timestamp: new Date().toISOString(),
          source: 'ci'
        }
      };

      const runtimeChecks = [
        {
          id: 'runtime.auto.test',
          result: 'FAIL',
          blocking: true,
          details: { source: 'runtime-analysis' }
        }
      ];

      const merged = mergeRuntimeChecks(qaResult, runtimeChecks);

      // Deve incluir escopo telemetry
      expect(merged.scope).toContain('telemetry');
      expect(merged.status).toBe('FAIL'); // Status deve mudar para FAIL
      expect(merged.checks.length).toBe(1);
    });
  });
});

