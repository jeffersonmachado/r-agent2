'use strict';

/**
 * scripts/governance/lib/security-gate-provenance.js
 *
 * MÓDULO PURO (sem I/O, sem clock): decide se a EVIDÊNCIA DE SEGURANÇA sustenta o
 * veredito do run CORRENTE.
 *
 * POR QUE EXISTE: a regra estava inline em `main()` de
 * `validate-security-release-gate.js` e por isso NÃO HAVIA COMO PROVAR que ela
 * consegue falhar. Um gate que não pode falhar é um defeito conhecido deste
 * repositório (ver memória `r-agent2-validator-cannot-fail`): a checagem passa a
 * existir, dá sensação de proteção e não bloqueia nada. Extraída, ela passa a ter
 * teste com CONTROLE POSITIVO — cada código de recusa precisa ser disparado por
 * um cenário.
 *
 * REGRA CENTRAL (a mesma de `runtime-evidence-artifacts.js`): evidência produzida
 * ANTES do início do run não sustenta o run. Aqui ela é adaptada ao caso da
 * segurança, cujos fatos vêm do BANCO (`SecurityFinding`, `SecuritySbomSnapshot`,
 * sync OSV, `SecurityComponent`) e NÃO carregam vínculo com o source.
 *
 * O `SecuritySbomSnapshot` tem `run_id` NULLABLE por desenho — a unicidade é
 * `(tenant_key, sha256)`, então o snapshot é REUSADO entre runs de propósito. Por
 * isso a checagem não pode depender só de `runId`: combina com
 * `generatedAt × startedAt` do run.
 *
 * Fail-closed: qualquer impossibilidade de aferir o vínculo vira recusa. Nunca
 * PASS por ausência de dado.
 *
 * @param {{lineage?: object|null, currentRun?: object|null, sbom?: object|null}} input
 * @returns {Array<{code: string, message: string}>} lista de recusas (vazia = sustentado)
 */
function resolveSecurityProvenance({ lineage = null, currentRun = null, sbom = null } = {}) {
  const issues = [];

  const runId = lineage && lineage.runId ? String(lineage.runId) : null;
  const source = lineage && lineage.source ? String(lineage.source) : 'none';
  if (!runId || source === 'none') {
    issues.push({
      code: 'SECURITY_GATE_NO_GOVERNED_RUN',
      message: 'sem run governado — o veredito de segurança não pode sustentar release',
    });
  }

  // Run corrente ilegível/ausente: não há como aferir vínculo algum. Sem este
  // retorno antecipado, `currentRun.runId` nulo faria a checagem de runId
  // estrangeiro passar em silêncio — o modo de falha que estamos eliminando.
  if (!currentRun || typeof currentRun !== 'object' || !currentRun.runId) {
    issues.push({
      code: 'SECURITY_GATE_UNAVAILABLE',
      message: 'run corrente ausente ou ilegível — proveniência do veredito não pôde ser verificada',
    });
    return issues;
  }

  // RUN ENCERRADO não é run corrente (defeito medido 2026-10-17, família do H20).
  // `close-run-context.js` marca o run como SUPERSEDED/ABANDONED. Usar o
  // `startedAt` dele como "início do run corrente" fazia toda evidência de
  // segurança parecer ANTERIOR e o gate saía sempre com
  // SECURITY_GATE_STALE_EVIDENCE — culpando o SBOM por um estado que na verdade é
  // "não existe run aberto para certificar". O bloqueio continua (fail-closed),
  // com o motivo certo.
  const statusRun = String(currentRun.status || '').toUpperCase();
  if (statusRun === 'SUPERSEDED' || statusRun === 'ABANDONED') {
    issues.push({
      code: 'SECURITY_GATE_RUN_CLOSED',
      message: `run ${currentRun.runId} está ${statusRun} — não há run aberto para certificar; `
        + 'inicie um run governado antes de avaliar evidência de segurança',
    });
    return issues;
  }

  const sbomGeneratedAt = sbom && sbom.generatedAt ? new Date(sbom.generatedAt) : null;
  const runStartedAt = currentRun.startedAt ? new Date(currentRun.startedAt) : null;
  const generatedAtValid = sbomGeneratedAt !== null && !Number.isNaN(sbomGeneratedAt.getTime());
  const startedAtValid = runStartedAt !== null && !Number.isNaN(runStartedAt.getTime());
  if (generatedAtValid && startedAtValid && sbomGeneratedAt.getTime() < runStartedAt.getTime()) {
    issues.push({
      code: 'SECURITY_GATE_STALE_EVIDENCE',
      message: `SBOM de ${sbomGeneratedAt.toISOString()} é ANTERIOR ao início do run ${currentRun.runId} `
        + `(${runStartedAt.toISOString()}) — evidência vencida não sustenta o release`,
    });
  }

  const sbomRunId = sbom && sbom.runId ? String(sbom.runId) : null;
  if (sbomRunId && sbomRunId !== String(currentRun.runId)) {
    issues.push({
      code: 'SECURITY_GATE_FOREIGN_RUN',
      message: `SBOM pertence ao run ${sbomRunId}, não ao run corrente ${currentRun.runId}`,
    });
  }

  return issues;
}

module.exports = { resolveSecurityProvenance };
