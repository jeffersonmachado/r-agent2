'use strict';

/**
 * scripts/governance/lib/certificationCoherence.js
 *
 * COERÊNCIA DOS ARTEFATOS FINAIS DE CERTIFICAÇÃO.
 *
 * GAP QUE ESTE MÓDULO FECHA (confirmado no código em 2026-10-02): o pacote entregue continha, para o
 * MESMO runId, dois artefatos aparentemente canônicos dizendo coisas OPOSTAS:
 *
 *   governance/certification-snapshot.json   → finalDecision = NO_GO, runStatus = FAILED
 *   docs/governance/_platform-status-source.json → finalDecision = AUTONOMOUS_READY_GO
 *
 * Nenhum dos dois estava "errado" por si — o snapshot é a projeção BRUTA de um estado intermediário
 * do banco, e a decisão canônica é o resultado final. O problema é de APRESENTAÇÃO e de AUDITORIA:
 * um auditor externo recebe os dois arquivos, ambos parecem autoritativos, e as decisões não
 * conversam. A ambigüidade não é um detalhe cosmético — ela permite que qualquer alegação seja
 * sustentada escolhendo-se o arquivo conveniente.
 *
 * REGRA: um artefato final ou é CORRENTE, ou DECLARA que não é. Um estado intermediário não é
 * proibido; ser intermediário SEM DIZER QUE É, sim.
 *
 * Módulo PURO: recebe os artefatos normalizados (quem tem I/O lê e normaliza), devolve o veredito.
 */

/** Marcadores de ciclo de vida. Ausência = `CURRENT` (o artefato se apresenta como autoridade). */
const LIFECYCLE_MARKERS = Object.freeze([
  'CURRENT',      // é a decisão vigente deste run
  'TRANSITIONAL', // estado intermediário do run, ainda em movimento
  'SUPERSEDED',   // foi válido e foi substituído por outro artefato
  'INTERMEDIATE', // projeção parcial, não é decisão final
  'HISTORICAL',   // registro de histórico, arquivado
]);

const NON_CURRENT_MARKERS = Object.freeze(['TRANSITIONAL', 'SUPERSEDED', 'INTERMEDIATE', 'HISTORICAL']);

/** Normaliza uma decisão para o eixo GO/NO_GO. Nunca "adivinha" um valor desconhecido. */
function normalizeDecision(value) {
  if (value === null || value === undefined) return 'UNKNOWN';
  if (typeof value === 'object') {
    // `finalDecision` costuma ser um objeto { decision, reason, ... }.
    return normalizeDecision(value.decision ?? value.status ?? value.verdict ?? value.result);
  }
  const text = String(value).trim().toUpperCase();
  if (text === '') return 'UNKNOWN';
  if (['GO', 'PASS', 'AUTONOMOUS_READY_GO', 'READY', 'GREEN', 'VERIFIED'].includes(text)) return 'GO';
  if (['NO_GO', 'NOGO', 'FAIL', 'FAILED', 'BLOCKED', 'RED', 'NOT_READY'].includes(text)) return 'NO_GO';
  return 'UNKNOWN';
}

/** O artefato declara-se não-corrente? */
function isNonCurrent(artifact) {
  const marker = String((artifact && artifact.lifecycle) || '').trim().toUpperCase();
  return NON_CURRENT_MARKERS.includes(marker);
}

/**
 * COERÊNCIA ENTRE ARTEFATOS FINAIS DO MESMO RUN.
 *
 * Só artefatos CORRENTES podem contradizer. Um artefato marcado TRANSITIONAL/SUPERSEDED/INTERMEDIATE
 * está declarando que não é a palavra final — e é exatamente por isso que a marca é obrigatória.
 *
 * @returns {{coherent:boolean, code:string|null, reason:string, conflicts:Array, missingMarkers:Array}}
 */
function assessFinalCoherence({ artifacts = [] } = {}) {
  const list = (Array.isArray(artifacts) ? artifacts : []).filter(Boolean);

  // Agrupa por runId: a comparação só faz sentido dentro do MESMO run (runs diferentes têm
  // decisões diferentes por definição, e isso não é contradição).
  const byRun = new Map();
  for (const artifact of list) {
    const runId = String(artifact.runId || 'UNKNOWN');
    if (!byRun.has(runId)) byRun.set(runId, []);
    byRun.get(runId).push(artifact);
  }

  const conflicts = [];
  const missingMarkers = [];

  for (const [runId, group] of byRun) {
    const current = group.filter((a) => !isNonCurrent(a));
    const decisions = new Map();
    for (const artifact of current) {
      const decision = normalizeDecision(artifact.decision);
      if (decision === 'UNKNOWN') continue;
      if (!decisions.has(decision)) decisions.set(decision, []);
      decisions.get(decision).push(artifact.path);
    }

    if (decisions.has('GO') && decisions.has('NO_GO')) {
      conflicts.push({
        runId,
        goArtifacts: decisions.get('GO'),
        noGoArtifacts: decisions.get('NO_GO'),
        detail: `o run ${runId} possui artefatos CORRENTES com decisões incompatíveis (GO e NO_GO) — um auditor não tem como saber qual é a autoridade`,
      });
    }

    // Um artefato que declara explicitamente "não sou final" precisa dizer POR QUÊ/por quem.
    for (const artifact of group) {
      if (!isNonCurrent(artifact)) continue;
      const supersededBy = artifact.supersededBy || artifact.reason;
      if (!supersededBy || String(supersededBy).trim().length < 10) {
        missingMarkers.push({
          path: artifact.path,
          lifecycle: artifact.lifecycle,
          detail: 'artefato marcado como não-corrente sem declarar por quem foi substituído ou por quê',
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      coherent: false,
      code: 'GOVERNANCE_FINAL_SNAPSHOT_INCOHERENT',
      reason: `artefatos finais contraditórios no MESMO run: ${conflicts.map((c) => c.runId).join(', ')} — um deles precisa declarar explicitamente que não é a decisão corrente (TRANSITIONAL/SUPERSEDED/INTERMEDIATE)`,
      conflicts,
      missingMarkers,
    };
  }
  if (missingMarkers.length > 0) {
    return {
      coherent: false,
      code: 'GOVERNANCE_SUPERSESSION_UNDECLARED',
      reason: `artefato(s) marcado(s) como não-corrente(s) sem declaração de supersessão: ${missingMarkers.map((m) => m.path).join(', ')}`,
      conflicts,
      missingMarkers,
    };
  }
  return {
    coherent: true,
    code: null,
    reason: `nenhuma contradição entre artefatos correntes (${list.length} artefato(s), ${byRun.size} run(s) comparado(s))`,
    conflicts,
    missingMarkers,
  };
}

/**
 * COERÊNCIA SEMÂNTICA DO PRÓPRIO ARTEFATO.
 *
 * `runStatus = FAILED` convivendo com `78/78` e `openBlockers = 0` no MESMO artefato final não pode
 * passar sem explicação: ou o artefato é de um estado intermediário (e então falta a marca), ou os
 * números não descrevem o que o status afirma. Nos dois casos o leitor é induzido a erro.
 *
 * @returns {{coherent:boolean, code:string|null, reason:string}}
 */
function assessRunStatusSemantics({
  runStatus = null,
  scorecardTotal = null,
  scorecardPassed = null,
  scorecardBelow10 = null,
  openBlockers = null,
  semanticNote = null,
} = {}) {
  const status = String(runStatus || '').trim().toUpperCase();
  const failedLike = ['FAILED', 'NO_GO', 'BLOCKED'].includes(status);
  if (!failedLike) {
    return { coherent: true, code: null, reason: `status ${status || 'UNKNOWN'} sem contra-sinais de sucesso` };
  }

  const allPassed = Number.isFinite(Number(scorecardTotal))
    && Number.isFinite(Number(scorecardPassed))
    && Number(scorecardTotal) > 0
    && Number(scorecardPassed) === Number(scorecardTotal);
  const zeroBlockers = openBlockers !== null && openBlockers !== undefined && Number(openBlockers) === 0;
  const cleanScorecard = scorecardBelow10 !== null && scorecardBelow10 !== undefined && Number(scorecardBelow10) === 0;

  const contradiction = allPassed || (zeroBlockers && cleanScorecard);

  if (!contradiction) {
    return { coherent: true, code: null, reason: `status ${status} compatível com os números apresentados` };
  }
  if (semanticNote && String(semanticNote).trim().length >= 20) {
    return {
      coherent: true,
      code: null,
      declared: true,
      reason: `status ${status} com números favoráveis, mas a contradição está EXPLICADA semanticamente no artefato`,
    };
  }
  return {
    coherent: false,
    code: 'GOVERNANCE_STATUS_NUMBERS_CONTRADICTORY',
    reason: `artefato final declara ${status} e ao mesmo tempo exibe indicadores de sucesso total (${allPassed ? `${scorecardPassed}/${scorecardTotal} no scorecard` : ''}${zeroBlockers ? ' 0 blockers' : ''}) sem explicação semântica — o leitor não pode saber qual afirmação vale`,
  };
}

/**
 * Um produtor pode marcar seu artefato como não-corrente de forma consistente quando ele é uma
 * projeção BRUTA de estado do banco, e não a decisão canônica da plataforma.
 */
function buildSupersessionMarker({ supersededBy, reason, lifecycle = 'TRANSITIONAL' } = {}) {
  const normalized = String(lifecycle).toUpperCase();
  if (!NON_CURRENT_MARKERS.includes(normalized)) {
    throw Object.assign(new Error(`lifecycle inválido para marca de supersessão: ${lifecycle}`), { code: 'INVALID_LIFECYCLE' });
  }
  if (!supersededBy || String(supersededBy).trim().length < 5) {
    throw Object.assign(new Error('marca de supersessão exige `supersededBy`'), { code: 'SUPERSEDED_BY_REQUIRED' });
  }
  if (!reason || String(reason).trim().length < 20) {
    throw Object.assign(new Error('marca de supersessão exige `reason` com pelo menos 20 caracteres'), { code: 'SUPERSESSION_REASON_TOO_SHORT' });
  }
  return { lifecycle: normalized, supersededBy, reason };
}

module.exports = {
  LIFECYCLE_MARKERS,
  NON_CURRENT_MARKERS,
  normalizeDecision,
  isNonCurrent,
  assessFinalCoherence,
  assessRunStatusSemantics,
  buildSupersessionMarker,
};
