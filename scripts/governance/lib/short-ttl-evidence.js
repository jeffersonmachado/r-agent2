'use strict';

/**
 * scripts/governance/lib/short-ttl-evidence.js
 *
 * MÓDULO PURO (sem I/O, sem clock): decide se as evidências de TTL CURTO que o
 * ciclo de release consome no fim continuam FRESCAS.
 *
 * POR QUE EXISTE (defeito medido em 2026-10-13, ciclo de ~1h30):
 * o `consolidate` roda o gate agregado no FIM do ciclo, e dois validadores
 * dependem de evidências que envelhecem DURANTE ele:
 *
 *   1. `validate:governance-summary` reprovou com `replayIntegrity: STALE`
 *      (`ageMs` ≈ 33 min) porque `reports/replay-governance-validation-report.json`
 *      foi gerado no INÍCIO do ciclo;
 *   2. `validate:security-release-gate` reprovou com `SECURITY_GATE_STALE_EVIDENCE`
 *      (exit 3) porque o snapshot de SBOM era ANTERIOR ao `startedAt` do run.
 *
 * O ciclo, portanto, SABOTAVA A SI MESMO: ele envelhecia as evidências que ele
 * exige no fim. A saída na sessão foi regenerar as duas à mão e retomar — o que
 * custou duas retomadas e ~40 min. Aqui a regra passa a ser explícita e
 * VERIFICÁVEL: o `consolidate` regenera ANTES do agregado e o frescor é conferido
 * depois, fail-closed.
 *
 * Um gate que não pode falhar não é gate: por isso a avaliação é pura e testável,
 * e cada código de recusa tem cenário que o dispara.
 */

/**
 * TTL que o CONSUMIDOR aplica, quando ele é mais restritivo que o do relatório.
 *
 * DEFEITO MEDIDO (2026-10-13): o relatório de replay declara `maxAgeMs` de 7 DIAS,
 * mas quem o consome (`governance-summary`) aplica `DEFAULT_REPORT_MAX_AGE_MS` de
 * **24 HORAS** por dimensão. Um guard que valida pelo TTL do PRÓPRIO relatório
 * aceitaria uma evidência de 3 dias que o consumidor REPROVA — ou seja, o guard
 * seria mais frouxo que o gate que ele deveria antecipar, que é a definição de
 * um guard inútil. O limite efetivo é o MENOR entre o declarado e o do consumidor.
 */
const TTL_DO_CONSUMIDOR = Object.freeze({
  'replay-governance': {
    consumidor: 'validate:governance-summary (dimensão replayIntegrity)',
    maxAgeMs: Number(process.env.GOVERNANCE_SUMMARY_REPORT_MAX_AGE_MS) > 0
      ? Number(process.env.GOVERNANCE_SUMMARY_REPORT_MAX_AGE_MS)
      : 24 * 60 * 60 * 1000,
    envOverride: 'GOVERNANCE_SUMMARY_REPORT_MAX_AGE_MS',
  },
});

/** Evidências de TTL curto consumidas no fim do ciclo, com o produtor oficial. */
const EVIDENCIAS_TTL_CURTO = [
  {
    id: 'replay-governance',
    produtor: 'npm run validate:replay-governance',
    artefato: 'reports/replay-governance-validation-report.json',
    regra: 'o relatório declara `maxAgeMs`; idade além dele invalida o summary',
  },
  {
    id: 'security-sbom',
    produtor: 'npm run security:sbom',
    artefato: 'snapshot SecuritySbomSnapshot (banco)',
    regra: 'SBOM anterior ao startedAt do run não sustenta o release (SECURITY_GATE_STALE_EVIDENCE)',
  },
];

/**
 * Avalia o frescor das evidências de TTL curto contra o run corrente.
 *
 * Fail-closed: ausência de dado NÃO é frescor. Se não há como aferir, isso é uma
 * recusa — nunca PASS por silêncio.
 *
 * @param {{replay?: {generatedAt?: string, maxAgeMs?: number}|null,
 *          sbom?: {generatedAt?: string}|null,
 *          runStartedAt?: string|null,
 *          agora?: string|number|Date|null}} input
 * @returns {Array<{code: string, evidence: string, message: string}>}
 */
function avaliarFrescorDeEvidenciasCurta({ replay = null, sbom = null, runStartedAt = null, agora = null } = {}) {
  const issues = [];
  const agoraMs = agora === null ? Date.now() : new Date(agora).getTime();

  // ── replay-governance ────────────────────────────────────────────────────
  /**
   * TTL efetivo: o mais RESTRITIVO entre o declarado pelo relatório e o aplicado
   * pelo consumidor. Nunca o mais frouxo.
   */
  const ttlConsumidor = TTL_DO_CONSUMIDOR['replay-governance'].maxAgeMs;
  // `replay` ausente é um caso LEGÍTIMO (fail-closed ⇒ UNREADABLE), não uma
  // exceção: ler `.maxAgeMs` de null derrubava o guard com TypeError em vez de
  // recusar com o código próprio. Pego pelo teste de fail-closed.
  const ttlDeclarado = replay ? Number(replay.maxAgeMs) : NaN;
  const ttlEfetivo = Number.isFinite(ttlDeclarado) && ttlDeclarado > 0
    ? Math.min(ttlDeclarado, ttlConsumidor)
    : null;

  const replayGerado = replay && replay.generatedAt ? new Date(replay.generatedAt).getTime() : null;
  if (replayGerado === null || Number.isNaN(replayGerado)) {
    issues.push({
      code: 'SHORT_TTL_REPLAY_UNREADABLE',
      evidence: 'replay-governance',
      message: 'relatório de replay sem `generatedAt` legível — frescor não pode ser aferido',
    });
  } else if (ttlEfetivo === null) {
    issues.push({
      code: 'SHORT_TTL_REPLAY_MAXAGE_INVALID',
      evidence: 'replay-governance',
      message: 'relatório de replay sem `maxAgeMs` válido — sem TTL declarado não há como sustentar o summary',
    });
  } else if (agoraMs - replayGerado > ttlEfetivo) {
    const limitadoPeloConsumidor = ttlConsumidor < ttlDeclarado;
    issues.push({
      code: 'SHORT_TTL_REPLAY_STALE',
      evidence: 'replay-governance',
      message: `relatório de replay tem ${Math.round((agoraMs - replayGerado) / 60000)} min `
        + `(> ${Math.round(ttlEfetivo / 60000)} min permitidos`
        + `${limitadoPeloConsumidor ? ` pelo consumidor ${TTL_DO_CONSUMIDOR['replay-governance'].consumidor}` : ''})`
        + " — regenerar com 'npm run validate:replay-governance'",
    });
  }

  // ── SBOM de segurança ────────────────────────────────────────────────────
  const sbomGerado = sbom && sbom.generatedAt ? new Date(sbom.generatedAt).getTime() : null;
  if (sbomGerado === null || Number.isNaN(sbomGerado)) {
    issues.push({
      code: 'SHORT_TTL_SBOM_UNREADABLE',
      evidence: 'security-sbom',
      message: 'snapshot de SBOM sem `generatedAt` legível — proveniência não pode ser aferida',
    });
  } else {
    const inicioRun = runStartedAt ? new Date(runStartedAt).getTime() : null;
    if (inicioRun === null || Number.isNaN(inicioRun)) {
      issues.push({
        code: 'SHORT_TTL_SBOM_NO_RUN',
        evidence: 'security-sbom',
        message: 'run corrente sem `startedAt` legível — sem run não há como vincular o SBOM',
      });
    } else if (sbomGerado < inicioRun) {
      issues.push({
        code: 'SHORT_TTL_SBOM_STALE',
        evidence: 'security-sbom',
        message: `SBOM de ${new Date(sbomGerado).toISOString()} é ANTERIOR ao início do run `
          + `(${new Date(inicioRun).toISOString()}) — regenerar com 'npm run security:sbom'`,
      });
    }
  }

  return issues;
}

module.exports = { EVIDENCIAS_TTL_CURTO, TTL_DO_CONSUMIDOR, avaliarFrescorDeEvidenciasCurta };
