'use strict';

/**
 * Não-vacuidade do gate de evidência em runtime do Ask AI.
 *
 * Contexto: em 2026-10-08 a evidência `reports/ask-ai-copilot-runtime-evidence.json`
 * estava PASS (gerada em 20/09) enquanto o copiloto NÃO respondia — o provider de
 * geração estava sem crédito (429), o rag-service devolvia um trecho cru de
 * documento e o turno vinha com `confidence: fully_grounded`. O script só
 * checava status/intent/confidence.
 *
 * Estes testes provam que a regra nova REPROVA a degradação nos dois sintomas
 * possíveis (marcador no texto e `confidence: source_only`) e não reprova o
 * caminho saudável — sem eles, o check poderia ser um `expect(true)`.
 */

const {
  evaluateSynthesizedAnswer,
} = require('../../scripts/verify-ask-ai-copilot-runtime');

const RESPOSTA_SAUDAVEL = [
  'Para matricular um aluno novo, o processo começa pelo cadastro rápido:',
  'clique em "Novo Aluno" no canto superior direito da tela. Depois registre o',
  'pagamento e libere o acesso físico do membership.',
].join(' ');

describe('verify-ask-ai-copilot-runtime — resposta precisa ser sintetizada', () => {
  test('resposta sintetizada é aprovada', () => {
    const result = evaluateSynthesizedAnswer({
      status: 200,
      answer: RESPOSTA_SAUDAVEL,
      confidence: 'fully_grounded',
    });
    expect(result).toEqual({ ok: true, reason: null });
  });

  test('marcador de degradação (trecho recuperado) reprova', () => {
    const result = evaluateSynthesizedAnswer({
      status: 200,
      answer: `**Conhecimento (documentação operacional)**\n\nNão foi possível gerar a resposta agora: a geração de linguagem está indisponível. Sem síntese, segue o trecho mais relevante recuperado:\n\nno modal de detalhe esses passos aparecem...`,
      confidence: 'fully_grounded',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^degradation_marker:/);
  });

  test('marcador legado do rag-service ("Com base nas informações disponíveis") reprova', () => {
    // Texto que o defeito produzia ANTES da correção — não pode voltar a passar.
    const result = evaluateSynthesizedAnswer({
      status: 200,
      answer: 'Com base nas informações disponíveis: no modal de detalhe esses passos aparecem marcados com 🖥️...\n\nHá 3 fontes de informação relacionadas disponíveis.',
      confidence: 'fully_grounded',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^degradation_marker:/);
  });

  test('confidence source_only reprova mesmo com texto longo', () => {
    const result = evaluateSynthesizedAnswer({
      status: 200,
      answer: RESPOSTA_SAUDAVEL,
      confidence: 'source_only',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('confidence_source_only');
  });

  test('resposta curta demais reprova (não é resposta)', () => {
    const result = evaluateSynthesizedAnswer({
      status: 200,
      answer: 'Não sei.',
      confidence: 'insufficient_evidence',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('answer_too_short');
  });

  test('turno sem HTTP 200 reprova', () => {
    const result = evaluateSynthesizedAnswer({
      status: 500,
      answer: RESPOSTA_SAUDAVEL,
      confidence: 'fully_grounded',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('http_500');
  });
});
