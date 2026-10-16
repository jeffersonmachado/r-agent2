'use strict';

/**
 * Preflight do TTL da evidência de runtime do Ask-AI
 * (`scripts/governance/ask-ai-runtime-evidence-ttl-preflight.js`).
 *
 * DEFEITO REAL medido em 2026-10-15 (ciclo de ~2 h): o `validate:ask-ai-runtime-evidence`
 * roda dentro do gate agregado, que roda na ÚLTIMA fase (`consolidate`). A evidência
 * tem TTL de 7 dias e produtor MANUAL (`npm run verify:ask-ai-copilot:runtime`), então
 * o ciclo inteiro rodou — QA Mesh real, empacotamento, tag JÁ PUBLICADA — e abortou no
 * fim com `ASK_AI_RUNTIME_EVIDENCE_STALE` (177,8 h de 168 h). O preflight já fazia esse
 * fail-fast para o smoke contínuo das QA Waves; faltava a mesma proteção aqui.
 *
 * O preflight NÃO reimplementa o TTL: chama `evaluateRuntimeEvidence`, a MESMA função
 * do validador do agregado — os 4 primeiros casos abaixo provam isso (idade E prova de
 * geração E ausência), não só a idade.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PREFLIGHT = require('../../../scripts/governance/ask-ai-runtime-evidence-ttl-preflight');
const SEAL = path.join(ROOT, 'scripts', 'governance', 'seal-release.sh');

const EVIDENCE_REL = 'reports/ask-ai-copilot-runtime-evidence.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AGORA = Date.parse('2026-10-15T18:00:00.000Z');

function evidenciaValida(generatedAt) {
  return {
    generatedAt,
    status: 'PASS',
    checks: [{ id: 'first_turn_answer_generated', status: 'PASS' }],
  };
}

/** Cria um rootDir temporário com (ou sem) a evidência e avalia. */
function avaliar(evidencia) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-ttl-'));
  try {
    if (evidencia !== undefined) {
      fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, EVIDENCE_REL),
        typeof evidencia === 'string' ? evidencia : JSON.stringify(evidencia),
      );
    }
    return PREFLIGHT.evaluate(dir, { maxAgeMs: MAX_AGE_MS, now: AGORA });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('preflight do TTL da evidência de runtime do Ask-AI', () => {
  it('evidência fresca com prova de geração ⇒ OK (o ciclo pode começar)', () => {
    const out = avaliar(evidenciaValida(new Date(AGORA - 3600000).toISOString()));
    expect(out.status).toBe('OK');
    expect(out.violations).toHaveLength(0);
    expect(out.maxAgeHours).toBe(168);
  });

  it('evidência vencida ⇒ STALE com o código do agregado (o caso medido em 2026-10-15)', () => {
    // 177,8 h — exatamente a idade que abortou o consolidate.
    const out = avaliar(evidenciaValida(new Date(AGORA - Math.round(177.8 * 3600000)).toISOString()));
    expect(out.status).toBe('STALE');
    expect(out.violations.map((v) => v.code)).toContain('ASK_AI_RUNTIME_EVIDENCE_STALE');
    expect(out.ageHours).toBeCloseTo(177.8, 1);
  });

  it('evidência ausente ⇒ STALE (bloqueante), nunca "ok sem sinal"', () => {
    const out = avaliar(undefined);
    expect(out.status).toBe('STALE');
    expect(out.violations.map((v) => v.code)).toContain('ASK_AI_RUNTIME_EVIDENCE_MISSING');
  });

  it('evidência fresca SEM prova de geração ⇒ STALE (usa a mesma autoridade do validador)', () => {
    const semGeracao = {
      generatedAt: new Date(AGORA - 3600000).toISOString(),
      status: 'PASS',
      checks: [{ id: 'api_reachable', status: 'PASS' }],
    };
    const out = avaliar(semGeracao);
    expect(out.status).toBe('STALE');
    expect(out.violations.map((v) => v.code)).toContain('ASK_AI_RUNTIME_EVIDENCE_WITHOUT_GENERATION_CHECK');
  });

  it('ASCII inválido não derruba a avaliação (exit 2 é só plumbing)', () => {
    const out = avaliar('{ isso nao e json');
    expect(out.status).toBe('STALE');
    expect(out.violations.map((v) => v.code)).toContain('ASK_AI_RUNTIME_EVIDENCE_MISSING');
  });

  it('o selo chama este preflight na ENTRADA e antes do agregado (fail-fast, não no fim)', () => {
    const seal = fs.readFileSync(SEAL, 'utf8');
    const ocorrencias = seal.split('ask-ai-runtime-evidence-ttl-preflight.js').length - 1;
    // preflight() (entrada do ciclo) + phase_consolidate() (antes da varredura).
    expect(ocorrencias).toBe(2);
    expect(seal).toContain('ASK_AI_RUNTIME_EVIDENCE_STALE');
  });
});
