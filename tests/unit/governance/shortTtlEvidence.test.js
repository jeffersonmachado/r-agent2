'use strict';

/**
 * Evidências de TTL curto no ciclo de release.
 *
 * DEFEITO MEDIDO (2026-10-13, ciclo de ~1h30): o `consolidate` roda o gate
 * agregado no FIM do ciclo, mas `validate:governance-summary` e
 * `validate:security-release-gate` dependem de evidências geradas no INÍCIO:
 *   - `replayIntegrity: STALE` (ageMs ≈ 33 min) derrubou o summary;
 *   - `SECURITY_GATE_STALE_EVIDENCE` (exit 3) abortou o consolidate — SBOM
 *     anterior ao `startedAt` do run.
 * Custou DUAS retomadas manuais. O ciclo sabotava a si mesmo.
 *
 * O que se trava aqui:
 *   1. a avaliação de frescor é PURA e cada código de recusa tem cenário que o
 *      dispara (um gate que não pode falhar não é gate);
 *   2. ausência de dado NUNCA é frescor (fail-closed);
 *   3. o `consolidate` REGENERA antes do agregado — e a ordem é verificada, porque
 *      regenerar depois não conserta o que o agregado já reprovou.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const {
  EVIDENCIAS_TTL_CURTO,
  avaliarFrescorDeEvidenciasCurta,
} = require('../../../scripts/governance/lib/short-ttl-evidence');
const { coletarEvidencias } = require('../../../scripts/governance/refresh-short-ttl-evidence');

const AGORA = '2026-10-13T22:00:00.000Z';
const RUN_INICIO = '2026-10-13T19:00:00.000Z';

describe('evidências de TTL curto — avaliação de frescor (pura)', () => {
  const fresco = () => ({
    replay: { generatedAt: '2026-10-13T21:59:00.000Z', maxAgeMs: 30 * 60 * 1000 },
    sbom: { generatedAt: '2026-10-13T21:58:00.000Z' },
    runStartedAt: RUN_INICIO,
    agora: AGORA,
  });

  it('CONTROLE NEGATIVO: tudo fresco não gera recusa (a checagem não é vácua por construção)', () => {
    expect(avaliarFrescorDeEvidenciasCurta(fresco())).toEqual([]);
  });

  it('replay além do maxAgeMs declarado ⇒ SHORT_TTL_REPLAY_STALE com o remédio', () => {
    const entrada = fresco();
    entrada.replay.generatedAt = '2026-10-13T21:00:00.000Z'; // 60 min > 30 min
    const issues = avaliarFrescorDeEvidenciasCurta(entrada);
    expect(issues.map((i) => i.code)).toEqual(['SHORT_TTL_REPLAY_STALE']);
    expect(issues[0].message).toContain('validate:replay-governance');
    expect(issues[0].evidence).toBe('replay-governance');
  });

  it('replay exatamente no limite ainda é fresco (o TTL é inclusivo, não um off-by-one)', () => {
    const entrada = fresco();
    entrada.replay.generatedAt = new Date(new Date(AGORA).getTime() - 30 * 60 * 1000).toISOString();
    expect(avaliarFrescorDeEvidenciasCurta(entrada)).toEqual([]);
  });

  it('GUARD NÃO PODE SER MAIS FROUXO QUE O CONSUMIDOR: 3 dias passa no relatório (7d) mas o summary (24h) reprova', () => {
    // DEFEITO MEDIDO (2026-10-13): o relatório de replay declara `maxAgeMs` de 7 DIAS,
    // mas `governance-summary` aplica 24 HORAS por dimensão. Validar pelo TTL do
    // próprio relatório fazia o guard ACEITAR evidência que o gate reprova — um guard
    // que antecipa errado é pior que nenhum, porque dá sensação de proteção.
    const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
    const entrada = fresco();
    entrada.replay.maxAgeMs = 7 * 24 * 60 * 60 * 1000; // declarado: frouxo
    entrada.replay.generatedAt = new Date(new Date(AGORA).getTime() - TRES_DIAS_MS).toISOString();
    const issues = avaliarFrescorDeEvidenciasCurta(entrada);
    expect(issues.map((i) => i.code)).toEqual(['SHORT_TTL_REPLAY_STALE']);
    // A mensagem precisa dizer que quem limitou foi o CONSUMIDOR, não o relatório.
    expect(issues[0].message).toContain('governance-summary');
    expect(issues[0].message).toContain('1440 min'); // 24h, não 10080 min (7d)
  });

  it('o TTL efetivo é o MENOR entre o declarado e o do consumidor (nunca o mais frouxo)', () => {
    // Declarado mais restritivo que o consumidor: vale o declarado.
    const curto = fresco();
    curto.replay.maxAgeMs = 10 * 60 * 1000; // 10 min
    curto.replay.generatedAt = new Date(new Date(AGORA).getTime() - 20 * 60 * 1000).toISOString();
    const issues = avaliarFrescorDeEvidenciasCurta(curto);
    expect(issues.map((i) => i.code)).toEqual(['SHORT_TTL_REPLAY_STALE']);
    expect(issues[0].message).toContain('10 min');
  });

  it('SBOM ANTERIOR ao início do run ⇒ SHORT_TTL_SBOM_STALE (o erro que abortou o consolidate)', () => {
    const entrada = fresco();
    entrada.sbom.generatedAt = '2026-10-13T18:00:00.000Z'; // antes do run (19:00)
    const issues = avaliarFrescorDeEvidenciasCurta(entrada);
    expect(issues.map((i) => i.code)).toEqual(['SHORT_TTL_SBOM_STALE']);
    expect(issues[0].message).toContain('security:sbom');
  });

  it('FAIL-CLOSED: dado ausente ou ilegível NUNCA é tratado como fresco', () => {
    expect(avaliarFrescorDeEvidenciasCurta({}).map((i) => i.code)).toEqual([
      'SHORT_TTL_REPLAY_UNREADABLE',
      'SHORT_TTL_SBOM_UNREADABLE',
    ]);
    expect(avaliarFrescorDeEvidenciasCurta({
      replay: { maxAgeMs: 60000 }, sbom: { generatedAt: 'nao-e-data' }, runStartedAt: RUN_INICIO, agora: AGORA,
    }).map((i) => i.code)).toEqual(['SHORT_TTL_REPLAY_UNREADABLE', 'SHORT_TTL_SBOM_UNREADABLE']);
    // Sem maxAgeMs declarado não há TTL: não se presume validade.
    expect(avaliarFrescorDeEvidenciasCurta({
      replay: { generatedAt: '2026-10-13T21:59:00.000Z' }, sbom: { generatedAt: '2026-10-13T21:58:00.000Z' },
      runStartedAt: RUN_INICIO, agora: AGORA,
    }).map((i) => i.code)).toEqual(['SHORT_TTL_REPLAY_MAXAGE_INVALID']);
    // Sem run não há como vincular o SBOM.
    expect(avaliarFrescorDeEvidenciasCurta({
      replay: { generatedAt: '2026-10-13T21:59:00.000Z', maxAgeMs: 1800000 },
      sbom: { generatedAt: '2026-10-13T21:58:00.000Z' }, runStartedAt: null, agora: AGORA,
    }).map((i) => i.code)).toEqual(['SHORT_TTL_SBOM_NO_RUN']);
  });

  it('o catálogo declara produtor e artefato para cada evidência monitorada', () => {
    expect(EVIDENCIAS_TTL_CURTO.map((e) => e.id)).toEqual(['replay-governance', 'security-sbom']);
    for (const e of EVIDENCIAS_TTL_CURTO) {
      expect(typeof e.produtor).toBe('string');
      expect(e.produtor.length).toBeGreaterThan(0);
      expect(typeof e.regra).toBe('string');
    }
  });
});

describe('consolidate regenera ANTES do agregado (ordem é contrato)', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'seal-release.sh'), 'utf8');

  it('o refresh roda na fase consolidate e o exit != 0 ABORTA (fail-closed)', () => {
    expect(script).toContain('refresh-short-ttl-evidence.js');
    // Depois do refresh precisa haver tratamento de falha — senão o agregado
    // reprovaria 25 min depois, que é exatamente o custo que se quer eliminar.
    const trecho = script.slice(script.indexOf('refresh-short-ttl-evidence.js'));
    expect(trecho).toMatch(/\$\? -ne 0/);
    expect(trecho).toContain('fail ');
  });

  it('a regeneração vem ANTES do gate agregado (e depois do guard de smoke contínuo)', () => {
    const posRefresh = script.indexOf('refresh-short-ttl-evidence.js');
    const posAgregado = script.indexOf('timeout 3000 npm run validate:governance-enforcement');
    const posSmoke = script.indexOf('qa-waves-scheduled-ttl-preflight.js', script.indexOf('phase_consolidate'));
    expect(posSmoke).toBeGreaterThan(-1);
    expect(posRefresh).toBeGreaterThan(posSmoke);
    expect(posRefresh).toBeLessThan(posAgregado);
  });

  it('o script de refresh é executável e lê as evidências reais (integração leve)', () => {
    const evidencias = coletarEvidencias();
    expect(Object.keys(evidencias).sort()).toEqual(['replay', 'runStartedAt', 'sbom']);
    // Mesmo ausente, a chave existe e o valor é null — o avaliador é que decide.
    if (evidencias.replay) expect(evidencias.replay).toHaveProperty('generatedAt');
    if (evidencias.sbom) expect(evidencias.sbom).toHaveProperty('generatedAt');
  });
});
