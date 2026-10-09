'use strict';

/**
 * Dossiê de triagem — transformação PURA de dados medidos em fila de decisão.
 *
 * A capacidade já sabe medir (inventário, CVEs, plano, gate) e já sabe registrar
 * a decisão humana (waivers). O que faltava era o elo entre os dois: uma fila
 * priorizada, com o motivo de cada agrupamento e o comando exato de cada ação.
 *
 * Regras de honestidade embutidas:
 *   - este módulo NÃO decide nada: nenhum bucket aprova, isenta ou aplica correção.
 *     Ele diz o que a decisão exige (missão isolada, aprovação humana, waiver com
 *     prazo) e o que aconteceu de fato;
 *   - agrupamento que NÃO é limpável por atualização nunca entra no bucket
 *     automático, mesmo com severidade baixa — falta de versão corrigida é
 *     ausência de remédio, não ausência de risco;
 *   - dev-only e estados VEX aparecem explicitamente como NÃO contados no
 *     bloqueio (para o número não ser lido errado);
 *   - `unmeasured` declara o que o dossiê não cobre. Sem isso o dossiê seria uma
 *     promessa, não um recorte.
 */

const BUCKETS = Object.freeze({
  AUTO_ISOLATED: 'AUTO_ISOLATED',
  HUMAN_APPROVAL: 'HUMAN_APPROVAL',
  WAIVER_OR_COMPENSATING_CONTROL: 'WAIVER_OR_COMPENSATING_CONTROL',
});

const BUCKET_ORDER = [BUCKETS.WAIVER_OR_COMPENSATING_CONTROL, BUCKETS.HUMAN_APPROVAL, BUCKETS.AUTO_ISOLATED];

const SEVERITY_WEIGHT = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };

const BUCKET_LABELS = Object.freeze({
  [BUCKETS.AUTO_ISOLATED]: 'Missão isolada (Nível B)',
  [BUCKETS.HUMAN_APPROVAL]: 'Exige aprovação humana (Nível C)',
  [BUCKETS.WAIVER_OR_COMPENSATING_CONTROL]: 'Sem correção publicada: controle compensatório ou waiver com prazo',
});

function bucketOf(group) {
  if (group.fullyClearable !== true) return BUCKETS.WAIVER_OR_COMPENSATING_CONTROL;
  if (group.requiresHumanApproval === true) return BUCKETS.HUMAN_APPROVAL;
  if (String(group.updateRisk || 'UNKNOWN') === 'MAJOR') return BUCKETS.HUMAN_APPROVAL;
  if (String(group.updateRisk || 'UNKNOWN') === 'UNKNOWN') return BUCKETS.HUMAN_APPROVAL;
  return BUCKETS.AUTO_ISOLATED;
}

function rationaleOf(group, bucket) {
  if (bucket === BUCKETS.WAIVER_OR_COMPENSATING_CONTROL) {
    return `${group.advisoriesWithoutFix} de ${group.advisoriesTotal} advisories sem versão corrigida publicada:`
      + ' atualização não resolve — exige controle compensatório e waiver COM PRAZO (ou aceitar e registrar o risco).';
  }
  if (bucket === BUCKETS.HUMAN_APPROVAL) {
    const reason = String(group.updateRisk) === 'MAJOR'
      ? `atualização MAJOR (${group.currentVersion || '?'} → ${group.recommendedVersion})`
      : 'componente de runtime/autonomia Nível C';
    return `Limpável por bump, mas ${reason}: missão isolada exige autorização explícita.`;
  }
  return `Limpável por bump ${String(group.updateRisk).toLowerCase()} (${group.currentVersion || '?'} → ${group.recommendedVersion}) em missão isolada.`;
}

function commandOf(group, bucket) {
  // Prefere o candidato RECOMENDADO (alvo que limpa todos os advisories do pacote):
  // mandar missão para o primeiro candidato da lista resolveria só parte do pacote
  // e a fila pareceria travada.
  const candidateKey = group.recommendedCandidateKey || (group.candidateKeys || [])[0] || null;
  if (bucket === BUCKETS.WAIVER_OR_COMPENSATING_CONTROL) {
    const findingKey = (group.withoutFixFindingKeys || [])[0] || (group.findingKeys || [])[0] || '<findingKey>';
    return `node scripts/security-intel.js waive --finding "${findingKey}"`
      + ' --approve <quem assume> --days <prazo ≤ máximo>'
      + ' --reason "<motivo>" --control "<controle compensatório>"';
  }
  const rest = bucket === BUCKETS.HUMAN_APPROVAL ? ' --authorized-by <quem autoriza>' : '';
  if (candidateKey) {
    return `node scripts/security-intel.js patch-mission --candidate "${candidateKey}"${rest}`;
  }
  return `node scripts/security-intel.js patches  # obter a chave do candidato de ${group.packageName}, depois:`
    + ` node scripts/security-intel.js patch-mission --candidate <chave>${rest}`;
}

function normalizeGroup(group) {
  const bucket = bucketOf(group);
  return {
    key: group.key,
    packageName: group.packageName,
    service: group.service || null,
    ecosystem: group.ecosystem || null,
    currentVersion: group.currentVersion || null,
    recommendedVersion: group.recommendedVersion || null,
    updateRisk: group.updateRisk || 'UNKNOWN',
    autonomy: group.autonomy || null,
    severity: group.severity || null,
    kev: group.kev === true,
    devOnly: group.devOnly === true,
    advisoriesTotal: Number(group.advisoriesTotal || 0),
    advisoriesWithoutFix: Number(group.advisoriesWithoutFix || 0),
    fullyClearable: group.fullyClearable === true,
    // Impacto medido: quantos achados de severidade BLOQUEANTE continuam abertos
    // neste pacote/serviço. Sem isso a fila é ordenada por severidade, não por
    // efeito no gate — e o operador descobre depois que resolveu pouco.
    blockingFindingsOpen: Number(group.blockingFindingsOpen || 0),
    // Chaves reais para a ação (quando o chamador tem os candidatos em mãos): a
    // fila precisa ser EXECUTÁVEL, não um lembrete de que algo existe.
    candidateKeys: Array.isArray(group.candidateKeys) ? group.candidateKeys.filter(Boolean) : [],
    recommendedCandidateKey: group.recommendedCandidateKey || null,
    findingKeys: Array.isArray(group.findingKeys) ? group.findingKeys.filter(Boolean) : [],
    withoutFixFindingKeys: Array.isArray(group.withoutFixFindingKeys) ? group.withoutFixFindingKeys.filter(Boolean) : [],
    bucket,
    bucketLabel: BUCKET_LABELS[bucket],
    rationale: rationaleOf(group, bucket),
    command: commandOf(group, bucket),
  };
}

function sortGroups(a, b) {
  if (a.devOnly !== b.devOnly) return a.devOnly ? 1 : -1;
  if (a.kev !== b.kev) return a.kev ? -1 : 1;
  const orderDiff = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
  if (orderDiff !== 0) return orderDiff;
  // Dentro do bucket, primeiro o que tem mais efeito medido no gate.
  if (a.blockingFindingsOpen !== b.blockingFindingsOpen) {
    return b.blockingFindingsOpen - a.blockingFindingsOpen;
  }
  const severityDiff = (SEVERITY_WEIGHT[a.severity] ?? 9) - (SEVERITY_WEIGHT[b.severity] ?? 9);
  if (severityDiff !== 0) return severityDiff;
  if (a.advisoriesWithoutFix !== b.advisoriesWithoutFix) return b.advisoriesWithoutFix - a.advisoriesWithoutFix;
  return String(a.packageName).localeCompare(String(b.packageName));
}

/**
 * @param {object} input
 * @param {Array<object>} input.groups    saída de `consolidatePlansByPackage`
 * @param {object|null}  input.gate       relatório do Release Security Gate (opcional)
 * @param {object|null}  input.findings   resumo de achados (contadores)
 * @param {object|null}  input.advisoryBase { ageHours, stale }
 * @param {object}       input.policy     `releaseGate` da política
 * @param {string}       input.now        ISO-8601 (injetado: nada lê relógio aqui)
 * @param {string}       input.tenantKey
 */
function buildTriageDossier({
  groups = [],
  gate = null,
  findings = null,
  advisoryBase = null,
  policy = {},
  tenantKey = 'system',
  now,
} = {}) {
  if (!now) throw new Error('triage_dossier_now_required');

  const normalized = groups.map(normalizeGroup).sort(sortGroups);
  const byBucket = {
    [BUCKETS.AUTO_ISOLATED]: normalized.filter((group) => group.bucket === BUCKETS.AUTO_ISOLATED),
    [BUCKETS.HUMAN_APPROVAL]: normalized.filter((group) => group.bucket === BUCKETS.HUMAN_APPROVAL),
    [BUCKETS.WAIVER_OR_COMPENSATING_CONTROL]: normalized.filter((group) => group.bucket === BUCKETS.WAIVER_OR_COMPENSATING_CONTROL),
  };

  const blockingSeverities = policy.blockOnSeverity || [];
  const severityBands = findings?.bySeverity || {};
  const blockingFindings = blockingSeverities.reduce((total, severity) => total + (severityBands[severity] || 0), 0);

  // Cobertura da FILA medida pelo critério do GATE (autoridade da decisão), por
  // PACOTE e não por contagem: o gate conta bloqueio por achado × cópia física e o
  // dossiê conta achado no inventário — subtrair uma contagem da outra produziria
  // número inventado (foi o que aconteceu na primeira versão deste campo).
  const packageOfBlocker = (message) => {
    const match = / em ([^@\s]+)@/.exec(String(message || ''));
    return match ? match[1] : null;
  };
  const gatePackages = new Set(
    (gate?.blocking || []).map((item) => packageOfBlocker(item.message)).filter(Boolean),
  );
  const queuePackages = new Set(normalized.map((group) => group.packageName));
  const gateBlocksInQueue = [...gatePackages].filter((name) => queuePackages.has(name)).sort();
  const gateBlocksOutOfQueue = [...gatePackages].filter((name) => !queuePackages.has(name)).sort();
  const queueBlockingImpact = normalized.reduce((total, group) => total + group.blockingFindingsOpen, 0);
  const queueBlockingDevOnly = normalized
    .filter((group) => group.devOnly)
    .reduce((total, group) => total + group.blockingFindingsOpen, 0);

  return {
    generatedAt: now,
    tenantKey,
    // Fila de decisão (nada aqui é aplicado por este dossiê).
    buckets: Object.fromEntries(
      Object.entries(byBucket).map(([bucket, items]) => [bucket, {
        label: BUCKET_LABELS[bucket],
        count: items.length,
        packages: items.map((item) => item.packageName),
      }]),
    ),
    groups: normalized,
    totals: {
      groups: normalized.length,
      autoIsolated: byBucket[BUCKETS.AUTO_ISOLATED].length,
      requiringHumanApproval: byBucket[BUCKETS.HUMAN_APPROVAL].length,
      withoutPublishedFix: byBucket[BUCKETS.WAIVER_OR_COMPENSATING_CONTROL].length,
      advisoriesWithoutFix: normalized.reduce((total, group) => total + group.advisoriesWithoutFix, 0),
      devOnlyGroups: normalized.filter((group) => group.devOnly).length,
      kevGroups: normalized.filter((group) => group.kev).length,
    },
    blockingImpact: {
      // Cobertura por PACOTE (comparável com o gate).
      gateBlockingItems: Array.isArray(gate?.blocking) ? gate.blocking.length : null,
      gateBlockingPackages: gatePackages.size,
      gateBlockingPackagesInQueue: gateBlocksInQueue,
      gateBlockingPackagesOutOfQueue: gateBlocksOutOfQueue,
      // Contagens de ACHADO do dossiê (unidade diferente da do gate).
      queueBlockingFindings: queueBlockingImpact,
      queueBlockingFindingsDevOnly: queueBlockingDevOnly,
      globalBlockingFindings: blockingFindings,
      unitWarning: 'gate conta bloqueio por achado × cópia física; o dossiê conta achado no inventário. Não subtraia estas contagens entre si — use a cobertura por pacote.',
    },
    measured: {
      findingsAtRisk: findings?.open ?? null,
      blockingFindings,
      blockingSeverities,
      kevOpen: findings?.kevOpen ?? null,
      vexDiscarded: findings?.vex?.total ?? null,
      advisoryBaseAgeHours: advisoryBase?.ageHours ?? null,
      advisoryBaseStale: advisoryBase?.stale ?? null,
      gateDecision: gate?.decision ?? null,
      gateBlocking: Array.isArray(gate?.blocking) ? gate.blocking.length : null,
      gateWarnings: Array.isArray(gate?.warnings) ? gate.warnings.length : null,
    },
    policy: {
      blockOnSeverity: blockingSeverities,
      blockOnDevDependencies: policy.blockOnDevDependencies === true,
      blockWhenKevWithoutFix: policy.blockWhenKevWithoutFix !== false,
      maxWaiverDays: policy.maxWaiverDays ?? null,
    },
    // O que este dossiê NÃO cobre. Sem esta lista, o dossiê pareceria completo.
    unmeasured: [
      'Achados cobertos por waiver VIGENTE não aparecem como risco aberto; consulte `security-intel.js waivers`.',
      'Dependências puramente dev-only podem NÃO ter candidato de correção (a política decide se o plano as cobre) e, nesse caso, não aparecem nesta fila — o número de bloqueantes por achado pode ser maior que o endereçado aqui.',
      `Estados VEX (NOT_AFFECTED/FALSE_POSITIVE) não entram na fila: são evidência de triagem, não risco${findings?.vex?.total ? ` (${findings.vex.total} registros)` : ''}.`,
      'O dossiê não aplica correção nem cria isenção: ele lista o que a decisão humana precisa cobrir.',
    ],
  };
}

/** Markdown para leitura humana (mesma informação do JSON, sem decidir por ninguém). */
function renderTriageMarkdown(dossier) {
  const lines = [];
  lines.push(`# Triagem de segurança — ${dossier.tenantKey} (${dossier.generatedAt})`);
  lines.push('');
  lines.push('Este relatório **não decide nada**: ele ordena o que foi medido e o que cada ação exige.');
  lines.push('');
  lines.push('## Estado medido');
  lines.push('');
  lines.push(`- Gate de release: **${dossier.measured.gateDecision ?? 'não executado'}**`
    + `${dossier.measured.gateBlocking === null ? '' : ` (${dossier.measured.gateBlocking} bloqueios, ${dossier.measured.gateWarnings} avisos)`}`);
  lines.push(`- Achados abertos: **${dossier.measured.findingsAtRisk ?? 'não medido'}**`
    + ` | bloqueantes (${(dossier.policy.blockOnSeverity || []).join('/') || 'sem política'}): **${dossier.measured.blockingFindings}**`
    + ` | KEV aberto: ${dossier.measured.kevOpen ?? 'não medido'}`);
  lines.push(`- Evidência descartada por VEX: ${dossier.measured.vexDiscarded ?? 'não medido'}`);
  lines.push(`- Base de advisories: ${dossier.measured.advisoryBaseAgeHours ?? 'não medida'} h`
    + `${dossier.measured.advisoryBaseStale ? ' — **VENCIDA**' : ''}`);
  lines.push(`- Pacotes na fila: **${dossier.totals.groups}**`
    + ` (${dossier.totals.autoIsolated} isolados, ${dossier.totals.requiringHumanApproval} exigem aprovação, ${dossier.totals.withoutPublishedFix} sem correção publicada)`);
  lines.push(`- Efeito da fila no gate: **${dossier.blockingImpact.gateBlockingPackagesInQueue.length} de ${dossier.blockingImpact.gateBlockingPackages}** pacotes que bloqueiam o release estão na fila`
    + `${dossier.blockingImpact.gateBlockingPackagesOutOfQueue.length === 0
      ? ' (nenhum bloqueador ficou fora)'
      : ` — FORA da fila: ${dossier.blockingImpact.gateBlockingPackagesOutOfQueue.join(', ')}`}`);
  lines.push(`- Bloqueantes por ACHADO (unidade diferente da do gate): ${dossier.blockingImpact.queueBlockingFindings} endereçados pela fila`
    + ` (${dossier.blockingImpact.queueBlockingFindingsDevOnly} em pacotes marcados dev-only) de ${dossier.blockingImpact.globalBlockingFindings} abertos.`
    + ` ${dossier.blockingImpact.unitWarning}`);  lines.push('');
  for (const bucket of BUCKET_ORDER) {
    const items = dossier.groups.filter((group) => group.bucket === bucket);
    if (items.length === 0) continue;
    lines.push(`## ${BUCKET_LABELS[bucket]} (${items.length})`);
    lines.push('');
    for (const group of items) {
      lines.push(`### ${group.packageName}${group.service ? ` · ${group.service}` : ''} — ${group.severity || 'severidade não declarada'}${group.kev ? ' · KEV' : ''}${group.devOnly ? ' · dev-only' : ''}`);
      lines.push('');
      lines.push(`- Versão: ${group.currentVersion || '—'} → ${group.recommendedVersion || '**sem alvo publicado**'}`);
      lines.push(`- Advisories: ${group.advisoriesTotal} (sem correção: ${group.advisoriesWithoutFix}) | risco da atualização: ${group.updateRisk}`);
      lines.push(`- Impacto: ${group.blockingFindingsOpen} achado(s) de severidade bloqueante em aberto neste pacote`
        + `${group.devOnly ? ' (dev-only: não conta como bloqueio na política vigente)' : ''}`);
      lines.push(`- Por quê: ${group.rationale}`);
      if (group.recommendedCandidateKey) {
        lines.push(`- Candidato recomendado: \`${group.recommendedCandidateKey}\`${group.recommendedVersion ? ` (alvo ${group.recommendedVersion})` : ''}`);
      }
      if (group.candidateKeys.length > 1) {
        lines.push(`- Outros candidatos do pacote: ${group.candidateKeys.filter((key) => key !== group.recommendedCandidateKey).map((key) => `\`${key}\``).join(', ')}`);
      }
      if (group.bucket === BUCKETS.WAIVER_OR_COMPENSATING_CONTROL && group.withoutFixFindingKeys.length > 0) {
        lines.push(`- Achado(s) sem correção publicada: ${group.withoutFixFindingKeys.map((key) => `\`${key}\``).join(', ')}`);
      }
      lines.push(`- Comando: \`${group.command}\``);
      lines.push('');
    }
  }
  lines.push('## Limites deste dossiê');
  lines.push('');
  for (const item of dossier.unmeasured) lines.push(`- ${item}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  BUCKETS,
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketOf,
  buildTriageDossier,
  renderTriageMarkdown,
};
