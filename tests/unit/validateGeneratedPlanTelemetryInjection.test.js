'use strict';

/**
 * Contrato de injeção de telemetria do gate `validateGeneratedPlan`.
 *
 * O gate vive em `engine/` (núcleo puro) e a telemetria é I/O (grava arquivo em
 * disco). Antes, `engine/ai/validateGeneratedPlan.js` importava
 * `engine/ai/aiTelemetry.js` e `engine/qa/qaTelemetry.js` diretamente — o que
 * mantinha módulos com `fs` dentro de `engine/` e criava dependência de I/O no
 * núcleo.
 *
 * Agora a telemetria é injetada via `options.telemetry`. Estes testes garantem:
 *   1. sem injeção o gate é silencioso (não chama nada, não lança);
 *   2. com injeção o registro de falha acontece como antes;
 *   3. `validateGeneratedPlanOrThrow` encaminha as opções (senão a injeção pela
 *      assinatura de string seria descartada silenciosamente e a telemetria
 *      deixaria de ser gravada em produção);
 *   4. o arquivo do gate não volta a importar telemetria/`fs`.
 */

const fs = require('fs');
const path = require('path');

const {
  validateGeneratedPlan,
  validateGeneratedPlanOrThrow,
} = require('../../engine/ai/validateGeneratedPlan');
const aiTelemetrySink = require('../../api/services/aiTelemetrySink');

const GATE_PATH = path.join(__dirname, '..', '..', 'engine', 'ai', 'validateGeneratedPlan.js');

function makeSink() {
  const calls = [];
  return {
    calls,
    sink: {
      recordValidationFailure: (payload) => calls.push({ fn: 'recordValidationFailure', payload }),
      recordAiGateFailure: (payload) => calls.push({ fn: 'recordAiGateFailure', payload }),
    },
  };
}

// Plano identificável como chatbot (tem `nodes`) e inválido (fluxo vazio).
const INVALID_CHATBOT_PLAN = { nodes: [] };

describe('validateGeneratedPlan — telemetria injetada', () => {
  test('sem sink, o gate é silencioso e não lança', () => {
    const result = validateGeneratedPlan(INVALID_CHATBOT_PLAN, 'chatbot');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('com sink, registra falha no sistema antigo e no QA unificado', () => {
    const { calls, sink } = makeSink();
    const result = validateGeneratedPlan(INVALID_CHATBOT_PLAN, 'chatbot', { telemetry: sink });

    expect(result.valid).toBe(false);
    const fns = calls.map((call) => call.fn).sort();
    expect(fns).toEqual(['recordAiGateFailure', 'recordValidationFailure']);

    const validation = calls.find((call) => call.fn === 'recordValidationFailure').payload;
    expect(validation.domain).toBe('chatbot');
    expect(Array.isArray(validation.errors)).toBe(true);
    expect(validation.errors.length).toBe(result.errors.length);
    expect(typeof validation.promptUsed).toBe('string');

    const gate = calls.find((call) => call.fn === 'recordAiGateFailure').payload;
    expect(gate.domain).toBe('chatbot');
    expect(gate.errors.length).toBe(result.errors.length);
  });

  test('plano válido não gera telemetria de falha', () => {
    // Os validadores de forma/semântica são substituídos para isolar a decisão
    // do gate: só o caminho de FALHA pode registrar telemetria.
    jest.isolateModules(() => {
      jest.doMock('../../api/utils/validateFlowPlan', () => ({
        validateFlowPlan: () => ({ valid: true, errors: [], warnings: [] }),
      }));
      jest.doMock('../../engine/ai/chatbotSemanticValidator', () => ({
        validateChatbotFlowSemantic: () => ({ valid: true, errors: [], warnings: [] }),
      }));

      // eslint-disable-next-line global-require
      const gate = require('../../engine/ai/validateGeneratedPlan');
      const calls = [];
      const sink = {
        recordValidationFailure: (payload) => calls.push(['recordValidationFailure', payload]),
        recordAiGateFailure: (payload) => calls.push(['recordAiGateFailure', payload]),
      };

      const result = gate.validateGeneratedPlan({ nodes: [{ id: 'a', type: 'start' }] }, 'chatbot', { telemetry: sink });
      expect(result.valid).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  test('validateGeneratedPlanOrThrow encaminha options (assinatura de string)', () => {
    const { calls, sink } = makeSink();
    expect(() => validateGeneratedPlanOrThrow(INVALID_CHATBOT_PLAN, 'chatbot', { telemetry: sink }))
      .toThrow(/inválido/i);
    expect(calls.map((call) => call.fn).sort())
      .toEqual(['recordAiGateFailure', 'recordValidationFailure']);
  });

  test('sink incompleto não quebra o gate (funções ausentes viram no-op)', () => {
    const result = validateGeneratedPlan(INVALID_CHATBOT_PLAN, 'chatbot', {
      telemetry: { recordValidationFailure: () => {} },
    });
    expect(result.valid).toBe(false);
  });

  test('o sink da API expõe as funções usadas pelo gate', () => {
    expect(typeof aiTelemetrySink.recordValidationFailure).toBe('function');
    expect(typeof aiTelemetrySink.recordAiGateFailure).toBe('function');
  });

  test('guarda de pureza: o gate não importa telemetria nem fs', () => {
    const source = fs.readFileSync(GATE_PATH, 'utf8');
    expect(source).not.toMatch(/require\(['"][^'"]*aiTelemetry['"]\)/);
    expect(source).not.toMatch(/require\(['"][^'"]*qaTelemetry['"]\)/);
  });
});
