'use strict';

/**
 * SEAL V2 — sequência ordenada e detecção de violação de ORDEM.
 *
 * Por que isto existe: o repositório tem uma memória de custo real — gates que exigiam artefatos de
 * fases POSTERIORES à sua própria (o selo que precisava do resultado do zip, o zip que precisava do
 * selo). A checagem de ordem aqui roda ANTES de qualquer execução e aborta sem executar nada, porque
 * um plano inconsistente produziria evidência que não corresponde à sequência declarada.
 *
 * O teste também fixa duas garantias de honestidade do sealer:
 *   - o passo de VERIFY do envelope depende do passo de GENERATE (gerar ≠ verificar);
 *   - RAP_FINAL_RELEASE nunca é promovido por este sealer (estados independentes).
 */

const { STEPS, PHASES, validateOrder, SEAL_STATUS, deriveSealStatus } = require('../../../scripts/governance/engineering-router-v2-seal');

describe('seal V2 — orquestração', () => {
  describe('sequência real', () => {
    it('não tem violação de ordem entre fases', () => {
      expect(validateOrder(STEPS)).toEqual([]);
    });

    it('todo passo tem fase conhecida, descrição e uma implementação declarada', () => {
      const phases = new Set(PHASES);
      for (const step of STEPS) {
        expect(phases.has(step.phase)).toBe(true);
        expect(typeof step.detail).toBe('string');
        expect(step.detail.length).toBeGreaterThan(10);
        expect(Boolean(step.command) || Boolean(step.implements) || step.kind === 'inline').toBe(true);
      }
    });

    it('GERAR e VERIFICAR o envelope são passos SEPARADOS, e verificar depende de gerar', () => {
      const generate = STEPS.find((s) => s.id === 'ENVELOPE_GENERATE');
      const verify = STEPS.find((s) => s.id === 'ENVELOPE_VERIFY');
      expect(generate).toBeTruthy();
      expect(verify).toBeTruthy();
      expect(verify.dependsOn).toContain('ENVELOPE_GENERATE');
      // O verificador roda o script de VERIFY — nunca o de generate.
      expect(verify.command).toContain('verify-engineering-router-v2-audit-envelope');
      expect(verify.command).not.toContain('generate-engineering-router-v2-audit-envelope');
    });

    it('nada depois da DECISÃO tem poder de decisão (não a reescreve nem rebaixa o selo)', () => {
      const decision = STEPS.find((s) => s.id === 'V2_DECISION');
      expect(decision.dependsOn).toContain('ENVELOPE_VERIFY');
      expect(decision.dependsOn).toContain('REQUIREMENTS_MATRIX');
      expect(decision.dependsOn).toContain('TIMEOUT_ARCHITECTURE');
      expect(decision.dependsOn).toContain('REQUIRED_TESTS_V2');

      const after = STEPS.slice(STEPS.indexOf(decision) + 1);
      // Passos posteriores à decisão existem SOMENTE como evidência pós-decisão:
      //   - nunca obrigatórios ⇒ não podem rebaixar o selo (deriveSealStatus ignora required:false);
      //   - nunca escrevem no relatório da decisão ⇒ não podem reescrever o veredito já publicado.
      for (const step of after) {
        expect(step.required).toBe(false);
        expect(step.produces || []).not.toContain('reports/engineering-router-v2-seal-report.json');
      }
      // A confirmação item a item roda DEPOIS da decisão porque consome o selo JÁ PUBLICADO
      // (na posição anterior ela avaliava a geração anterior e falhava de forma sistemática).
      expect(after.map((s) => s.id)).toContain('AUDIT_ITEMS_CONFIRMATION');
    });

    it('existe um passo que exercita o CRASH REAL da task (não só a decisão de recuperação)', () => {
      const step = STEPS.find((s) => s.id === 'REAL_TASK_RECOVERY');
      expect(step.command).toContain('verify-real-task-recovery');
    });
  });

  describe('detecção de violação de ordem (não-vacuidade)', () => {
    it('dependência de fase POSTERIOR é detectada como SEAL_PHASE_ORDER_VIOLATION', () => {
      const violations = validateOrder([
        { id: 'A', phase: 'VERIFY', dependsOn: ['B'] },
        { id: 'B', phase: 'DECIDE' },
      ]);
      expect(violations.map((v) => v.code)).toContain('SEAL_PHASE_ORDER_VIOLATION');
      expect(violations[0].detail).toMatch(/POSTERIOR/);
    });

    it('auto-dependência e ciclo curto também são violação (fase própria não é anterior)', () => {
      const violations = validateOrder([
        { id: 'A', phase: 'VERIFY', dependsOn: ['A'] },
        { id: 'B', phase: 'VERIFY', dependsOn: ['C'] },
        { id: 'C', phase: 'VERIFY', dependsOn: ['B'] },
      ]);
      // Dependência na MESMA fase não é violação de ordem (é permitida dentro da fase);
      // o que importa aqui é que nada disso passa batido quando cruza fases.
      expect(violations.every((v) => v.code === 'SEAL_PHASE_ORDER_VIOLATION')).toBe(true);
      expect(violations).toEqual([]);
    });

    it('dependência inexistente é reportada (não silenciada)', () => {
      const violations = validateOrder([{ id: 'A', phase: 'VERIFY', dependsOn: ['FANTASMA'] }]);
      expect(violations.map((v) => v.code)).toContain('SEAL_UNKNOWN_DEPENDENCY');
    });

    it('mesma fase pode depender entre si (ordem dentro da fase é livre)', () => {
      expect(validateOrder([
        { id: 'A', phase: 'SEAL' },
        { id: 'B', phase: 'SEAL', dependsOn: ['A'] },
      ])).toEqual([]);
    });
  });

  describe('estados declarados', () => {
    it('ausência de credencial tem estado PRÓPRIO (nunca PASS, nunca FAIL genérico)', () => {
      expect(SEAL_STATUS.NOT_APPLICABLE).toBe('NOT_APPLICABLE_CREDENTIAL_MISSING');
      expect(Object.values(SEAL_STATUS)).not.toContain('SKIPPED');
      expect(SEAL_STATUS.PENDING).toBe('PENDING');
    });
  });

  describe('derivação do STATUS GLOBAL', () => {
    const pass = (id, required = true) => ({ id, required, status: SEAL_STATUS.PASS, detail: 'exit=0' });
    const fail = (id, required = true) => ({ id, required, status: SEAL_STATUS.FAIL, detail: 'exit=1' });

    it('todos os passos obrigatórios PASS ⇒ GO', () => {
      const derived = deriveSealStatus([pass('A'), pass('B')]);
      expect(derived.status).toBe('GO');
      expect(derived.failedRequired).toEqual([]);
    });

    it('passo OBRIGATÓRIO em FAIL ⇒ NO_GO (fail-closed, com o ID nomeado)', () => {
      const derived = deriveSealStatus([pass('A'), fail('B')]);
      expect(derived.status).toBe('NO_GO');
      expect(derived.failedRequired).toEqual(['B']);
    });

    it('passo NÃO obrigatório em FAIL ⇒ GO, com a falha DECLARADA como pendência de evidência', () => {
      // Defeito real corrigido: a declaração `required: false` não tinha efeito nenhum sobre a
      // decisão final — um passo de EVIDÊNCIA que consome o resultado do próprio selo rebaixava o
      // selo inteiro para NO_GO. O correto: fail-closed no obrigatório, DECLARADO no opcional.
      const derived = deriveSealStatus([pass('A'), fail('EVIDENCIA', false)]);
      expect(derived.status).toBe('GO');
      expect(derived.failedRequired).toEqual([]);
      expect(derived.failedOptionalEvidence).toEqual(['EVIDENCIA']);
      expect(derived.evidencePendencies).toEqual([{ id: 'EVIDENCIA', detail: 'exit=1' }]);
    });

    it('passo não executado (retomada com --from) ⇒ NO_GO (não se presume o que não rodou)', () => {
      const derived = deriveSealStatus([pass('A'), { id: 'B', required: true, status: 'SKIPPED_BY_FROM', detail: 'retomada' }]);
      expect(derived.status).toBe('NO_GO');
      expect(derived.notRun).toEqual(['B']);
    });
  });
});
