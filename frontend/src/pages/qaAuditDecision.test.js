import { describe, it, expect } from 'vitest';
import {
  NO_VERDICT,
  resolveJourneyDecision,
  resolveMeshDecision,
  decisionToneClass,
} from './qaAuditDecision';

/**
 * Defeito provado (2026-09-13) em `QaAuditPage.jsx` (aba QA Mesh): a tela
 * FABRICAVA veredito a partir da ausência de dado.
 *   - linha da tabela: `j.decision || j.goNoGo || (failed === 0 ? 'GO' : 'NO_GO')`
 *     -> jornada sem decisão gravada aparecia como GO, porque `failed` cai para
 *     0 via `j.failed || 0`;
 *   - resumo: `latest.goNoGo || latest.decision || (latest.status === 'GO' ? 'GO' : 'NO_GO')`
 *     -> sem NENHUM registro (`latest = {}`) exibia NO_GO.
 * Verificado antes de corrigir: os 7 registros reais de `qa-mesh/meshHistory/`
 * têm campo de decisão, então o caso da linha era risco LATENTE; o resumo
 * fabricava NO_GO em estado vazio.
 */

describe('resolveJourneyDecision — não inventa decisão', () => {
  it('registro sem decisão devolve NO_VERDICT (não GO)', () => {
    expect(resolveJourneyDecision({ name: 'checkout', total: 3, passed: 3 })).toBe(NO_VERDICT);
  });

  it('failed = 0 sem decisão registrada NÃO vira GO', () => {
    // Este é exatamente o caso que o código antigo mostrava como 'GO'.
    expect(resolveJourneyDecision({ failed: 0 })).toBe(NO_VERDICT);
  });

  it('decisão registrada é respeitada nos dois sentidos', () => {
    expect(resolveJourneyDecision({ goNoGo: 'GO' })).toBe('GO');
    expect(resolveJourneyDecision({ decision: 'NO_GO', failed: 0 })).toBe('NO_GO');
    expect(resolveJourneyDecision({ decision: 'GO', failed: 7 })).toBe('GO');
  });

  it('entrada inválida devolve NO_VERDICT', () => {
    expect(resolveJourneyDecision(null)).toBe(NO_VERDICT);
    expect(resolveJourneyDecision('x')).toBe(NO_VERDICT);
  });
});

describe('resolveMeshDecision — sem histórico não há veredito', () => {
  it('registro vazio devolve NO_VERDICT (não NO_GO)', () => {
    expect(resolveMeshDecision({})).toBe(NO_VERDICT);
  });

  it('status registrado é respeitado', () => {
    expect(resolveMeshDecision({ status: 'GO' })).toBe('GO');
    expect(resolveMeshDecision({ goNoGo: 'NO_GO' })).toBe('NO_GO');
    expect(resolveMeshDecision({ decision: 'NO_GO', status: 'GO' })).toBe('NO_GO');
  });

  it('entrada inválida devolve NO_VERDICT', () => {
    expect(resolveMeshDecision(null)).toBe(NO_VERDICT);
    expect(resolveMeshDecision(undefined)).toBe(NO_VERDICT);
  });
});

describe('decisionToneClass — ausência de veredito é neutra, não vermelha', () => {
  it('GO é positivo e NO_GO é negativo', () => {
    expect(decisionToneClass('GO')).toBe('text-green-400');
    expect(decisionToneClass('NO_GO')).toBe('text-red-400');
  });

  it('sem veredito não pinta de vermelho (não é falha)', () => {
    expect(decisionToneClass(NO_VERDICT)).not.toBe('text-red-400');
    expect(decisionToneClass('')).not.toBe('text-red-400');
  });
});
