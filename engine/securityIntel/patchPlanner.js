'use strict';

/**
 * patchPlanner — planejamento PURO de correção de um achado.
 *
 * Módulo PURO e DETERMINÍSTICO. Traduz "existe um CVE em X@1.2.3 e a correção
 * está em 1.2.9" em um PLANO executável, com risco da atualização, pré-condições
 * e classificação de autorização (Nível A/B/C da missão).
 *
 * REGRAS INEGOCIÁVEIS:
 *   - Nunca inventa versão de destino: sem `fixed` declarado pela fonte, o plano
 *     é `NO_PATCH` e exige ação humana (não existe "atualizar para a última").
 *   - Nunca planeja DOWNGRADE nem "ir para a última": escolhe a MENOR versão
 *     corrigida acima da instalada (correção com o menor risco introduzido).
 *   - Mudança MAJOR exige autorização explícita (Nível C) — não é automática.
 *   - Este módulo NÃO aplica nada. Ele planeja; aplicar é do Roteador Engenheiro.
 */

const { compareVersions, parseSemver, parsePep440 } = require('./versionCore');

const PATCH_KINDS = Object.freeze({
  DIRECT_BUMP: 'DIRECT_BUMP',
  TRANSITIVE_OVERRIDE: 'TRANSITIVE_OVERRIDE',
  IMAGE_REBUILD: 'IMAGE_REBUILD',
  RUNTIME_UPGRADE: 'RUNTIME_UPGRADE',
  NO_PATCH: 'NO_PATCH',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const UPDATE_RISK = Object.freeze({
  PATCH: 'PATCH',
  MINOR: 'MINOR',
  MAJOR: 'MAJOR',
  UNKNOWN: 'UNKNOWN',
  NONE: 'NONE',
});

/** Níveis de autonomia da missão (§19). */
const AUTONOMY = Object.freeze({
  LEVEL_A: 'LEVEL_A_AUTOMATIC',
  LEVEL_B: 'LEVEL_B_ISOLATED',
  LEVEL_C: 'LEVEL_C_PRODUCTION',
});

/** Serviços cuja atualização exige regressão de recuperação/ranking. */
const RAG_SERVICES = Object.freeze(new Set(['rag-service']));

/**
 * Menor versão corrigida ESTRITAMENTE acima da instalada.
 * @returns {string|null} `null` quando não há correção aplicável (nunca "a mais nova").
 */
function minimumFixedVersion({ currentVersion, fixedVersions = [], ecosystem }) {
  if (!currentVersion) return null;
  const candidates = [];
  for (const fixed of fixedVersions) {
    if (!fixed) continue;
    const comparison = compareVersions(fixed, currentVersion, { ecosystem });
    if (comparison === null) continue; // não comparável: não entra no plano
    if (comparison > 0) candidates.push(fixed);
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => compareVersions(a, b, { ecosystem }) ?? 0)[0];
}

/** Classifica o risco introduzido pela atualização (base: semver/PEP 440). */
function classifyUpdateRisk({ from, to, ecosystem }) {
  if (!from || !to) return UPDATE_RISK.UNKNOWN;
  const eco = String(ecosystem || '').toLowerCase();
  if (eco === 'pypi') {
    const a = parsePep440(from);
    const b = parsePep440(to);
    if (!a || !b) return UPDATE_RISK.UNKNOWN;
    if (a.epoch !== b.epoch) return UPDATE_RISK.MAJOR;
    const [aMaj, aMin] = a.release;
    const [bMaj, bMin] = b.release;
    if (aMaj !== bMaj) return UPDATE_RISK.MAJOR;
    if (aMin !== bMin) return UPDATE_RISK.MINOR;
    return UPDATE_RISK.PATCH;
  }
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return UPDATE_RISK.UNKNOWN;
  if (a.major !== b.major) return UPDATE_RISK.MAJOR;
  if (a.minor !== b.minor) return UPDATE_RISK.MINOR;
  return UPDATE_RISK.PATCH;
}

/** Pré-condições específicas do consumidor (o que precisa ser revalidado). */
function preconditionsFor({ component, updateRisk }) {
  const preconditions = ['executar a suíte do serviço consumidor'];
  if (RAG_SERVICES.has(component.service)) {
    preconditions.push('revalidar ranking híbrido do RAG (vetorial + lexical + fusão RRF) após a atualização');
    preconditions.push('confirmar integridade do índice vetorial (npm run security:vector-index)');
  }
  if (component.versionClass === 'RUNNING') {
    preconditions.push('comparar latência p50/p95/p99 antes e depois (componente em execução)');
  }
  if (updateRisk === UPDATE_RISK.MAJOR) {
    preconditions.push('revisar changelog de breaking change e adaptar código incompatível');
  }
  return preconditions;
}

/**
 * Planeja a correção de um achado.
 *
 * @param {object} input
 * @param {object} input.finding    achado (severity, status, packageName, installedVersion, fixedVersions, kev, dev, service)
 * @param {object} [input.component] componente do inventário (direct, builtLocally, versionClass, ecosystem, service)
 * @param {object} [input.policy]    `policy.patch`
 * @returns {object} plano auditável (nunca aplica nada)
 */
function planPatch({ finding, component = {}, policy = {} } = {}) {
  const ecosystem = component.ecosystem || finding.ecosystem || null;
  const currentVersion = finding.installedVersion ?? component.version ?? null;
  const fixedVersions = finding.fixedVersions || finding.fixed_versions || [];
  const rationale = [];

  const base = {
    ecosystem,
    packageName: finding.packageName || component.name || null,
    service: component.service || finding.service || null,
    currentVersion,
    advisoryId: finding.advisoryId || finding.advisory_id || null,
    findingKey: finding.findingKey || finding.finding_key || null,
    severity: finding.severity || null,
    kev: finding.kev === true,
    devOnly: finding.dev === true || component.dev === true,
    rationale,
  };

  // Achado que não representa risco: não se planeja nada.
  if (finding.applicability && finding.applicability !== 'CONFIRMED_APPLICABLE') {
    rationale.push(`aplicabilidade ${finding.applicability}: sem correção a planejar`);
    return { ...base, kind: PATCH_KINDS.NOT_APPLICABLE, targetVersion: null, updateRisk: UPDATE_RISK.NONE, autonomy: AUTONOMY.LEVEL_A, requiresHumanApproval: false, preconditions: [] };
  }

  const targetVersion = minimumFixedVersion({ currentVersion, fixedVersions, ecosystem });
  const builtLocally = component.builtLocally === true || ecosystem === 'docker';

  if (!targetVersion) {
    // Imagem construída localmente não depende de bump de versão: o remédio é
    // RECONSTRUIR com a dependência/base corrigida. Dizer apenas "sem patch"
    // esconderia o caminho real — então o plano existe, mas exige autorização
    // (ninguém reconstrói e publica imagem automaticamente).
    if (builtLocally) {
      rationale.push('imagem construída/declarada localmente sem versão corrigida comparável: reconstruir após atualizar a dependência ou a imagem-base vulnerável');
      return {
        ...base,
        kind: PATCH_KINDS.IMAGE_REBUILD,
        targetVersion: null,
        updateRisk: UPDATE_RISK.UNKNOWN,
        autonomy: AUTONOMY.LEVEL_C,
        requiresHumanApproval: true,
        preconditions: [
          'atualizar a dependência ou a imagem-base corrigida e reconstruir a imagem',
          'fixar a imagem por digest após validar',
        ],
      };
    }
    rationale.push(fixedVersions.length === 0
      ? 'a fonte não publicou versão corrigida: não existe "atualizar para a última" — requer ação humana'
      : 'nenhuma versão corrigida é estritamente superior à instalada: correção não aplicável por bump simples');
    return {
      ...base,
      kind: PATCH_KINDS.NO_PATCH,
      targetVersion: null,
      updateRisk: UPDATE_RISK.NONE,
      autonomy: AUTONOMY.LEVEL_C,
      requiresHumanApproval: true,
      preconditions: ['avaliar controle compensatório ou waiver formal (com expiração) enquanto não houver correção'],
    };
  }

  const updateRisk = classifyUpdateRisk({ from: currentVersion, to: targetVersion, ecosystem });
  rationale.push(`menor versão corrigida acima da instalada: ${targetVersion} (risco ${updateRisk})`);

  let kind;
  if (builtLocally) {
    kind = PATCH_KINDS.IMAGE_REBUILD;
    rationale.push('componente é imagem construída/declarada localmente: reconstruir e fixar digest');
  } else if (component.direct === true) {
    kind = PATCH_KINDS.DIRECT_BUMP;
    rationale.push('dependência direta: atualizar o manifesto e o lockfile');
  } else if (component.direct === false) {
    kind = PATCH_KINDS.TRANSITIVE_OVERRIDE;
    rationale.push('dependência transitiva: preferir atualizar o ancestral direto; usar override só com justificativa');
  } else {
    kind = PATCH_KINDS.RUNTIME_UPGRADE;
    rationale.push('componente de runtime/sistema: atualização exige plano de manutenção dedicado');
  }

  // Autonomia: MAJOR e runtime são Nível C (decisão de produção); o resto é
  // Nível B (branch/PR/build/testes em ambiente isolado).
  const isMajor = updateRisk === UPDATE_RISK.MAJOR;
  const autonomy = (isMajor || kind === PATCH_KINDS.RUNTIME_UPGRADE) ? AUTONOMY.LEVEL_C : AUTONOMY.LEVEL_B;
  const requiresHumanApproval = autonomy === AUTONOMY.LEVEL_C;
  if (requiresHumanApproval) {
    rationale.push(isMajor
      ? 'atualização MAJOR: mudança incompatível exige autorização explícita (Nível C)'
      : 'atualização de runtime/plataforma exige autorização explícita (Nível C)');
  }

  return {
    ...base,
    kind,
    targetVersion,
    updateRisk,
    autonomy,
    requiresHumanApproval,
    preconditions: preconditionsFor({ component, updateRisk }),
    blockedWhen: finding.kev === true && (policy.blockKevUntilPatched !== false)
      ? 'vulnerabilidade com exploração conhecida: prioridade máxima'
      : null,
  };
}

/**
 * Ordena planos: primeiro o que bloqueia release, depois KEV, prioridade e
 * menor risco de atualização (corrigir barato antes de arriscar muito).
 */
function rankPlans(plans = []) {
  const riskWeight = { PATCH: 0, MINOR: 1, UNKNOWN: 2, MAJOR: 3, NONE: 4 };
  const severityWeight = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };
  return [...plans].sort((a, b) => {
    const aActionable = a.kind !== PATCH_KINDS.NOT_APPLICABLE ? 0 : 1;
    const bActionable = b.kind !== PATCH_KINDS.NOT_APPLICABLE ? 0 : 1;
    if (aActionable !== bActionable) return aActionable - bActionable;
    if (a.kev !== b.kev) return a.kev ? -1 : 1;
    const severityDiff = (severityWeight[a.severity] ?? 9) - (severityWeight[b.severity] ?? 9);
    if (severityDiff !== 0) return severityDiff;
    const riskDiff = (riskWeight[a.updateRisk] ?? 9) - (riskWeight[b.updateRisk] ?? 9);
    if (riskDiff !== 0) return riskDiff;
    return String(a.packageName || '').localeCompare(String(b.packageName || ''));
  });
}

/**
 * Comando FUNCIONAL de aceite por serviço.
 *
 * Por que não a suíte inteira: o deadline de UM comando de teste no Runner é a política
 * `INTEGRATION_TEST` (**120 s**), e `jest tests/unit` leva ~9 min. Exigir dela tornava o aceite
 * INSATISFAZÍVEL no workspace isolado, independentemente da qualidade do patch — medido em
 * 2026-10-09: missões com patch válido (`valid=true`) morriam em TESTING, árvore limpa também
 * reprovava, e o histórico do próprio repo era 1 GREEN em 75 aprovações. A suíte completa (e os
 * gates de selo/release) continua obrigatória no pipeline de release
 * (`validate:governance-enforcement`, `npm run test:unit` do humano/CI) — o que muda é o que uma
 * missão de BUMP DE DEPENDÊNCIA precisa provar aqui.
 *
 * `npm run test:flow` (`jest tests/flow engine/__tests__`, o núcleo determinístico) foi medido no
 * workspace isolado: **30 suítes / 264 testes / 40 s**, verde sem nenhum artefato de estado.
 */
const SERVICE_TEST_COMMANDS = Object.freeze({
  api: ['npm run test:flow'],
  // Limitação declarada: `frontend/node_modules` não existe no workspace isolado (e criar
  // symlink gravável para ele é exatamente o defeito ER-V1-FINAL-001), então não há suíte de
  // frontend executável ali. O sinal funcional fica com o núcleo determinístico (compartilhado
  // com o frontend via `engine/`) e a prova mecânica da versão abaixo.
  frontend: ['npm run test:flow'],
  'rag-service': ['./venv/bin/python -m pytest tests -q'],
});

/**
 * Prova MECÂNICA de que o alvo foi aplicado: o pacote resolvido tem versão >= alvo.
 *
 * É a asserção direta do que um bump faz. O fechamento do ACHADO não é afirmado aqui: quem
 * decide isso é o Release Security Gate, que re-escaneia e deixa de contar o achado como aberto.
 */
function dependencyResolutionCommand(plan = {}) {
  const packageName = String(plan.packageName || '').trim();
  const target = String(plan.targetVersion || '').trim();
  if (!packageName || !target) return null;
  const ecosystem = String(plan.ecosystem || (String(plan.service || '').toLowerCase() === 'rag-service' ? 'pypi' : 'npm')).toLowerCase();

  if (ecosystem === 'pypi') {
    return `./venv/bin/python -c "import importlib.metadata as m, sys; from packaging.version import Version; v = m.version('${packageName}'); sys.exit(0 if Version(v) >= Version('${target}') else 1)"`;
  }
  // Aspas simples no shell, duplas no JS: o comando é executado por `sh -c`.
  const script = `const v=require("${packageName}/package.json").version;`
    + `const t="${target}";`
    + 'const p=s=>String(s).split("-")[0].split(".").map(Number);'
    + 'const c=(a,b)=>{const A=p(a),B=p(b);for(let i=0;i<3;i++){const d=(A[i]||0)-(B[i]||0);if(d)return d}return 0};'
    + 'if(c(v,t)<0){console.error("ALVO NAO APLICADO: "+v+" < "+t);process.exit(1)}'
    + 'console.log("ALVO APLICADO: "+v)';
  return `node -e '${script}'`;
}


/**
 * Escopo de caminho de uma correção de DEPENDÊNCIA (o que o patch pode tocar).
 *
 * Não é decoração: `allowedPaths` vazio/ausente NUNCA significa "tudo permitido" —
 * é `NO_PATCH_SCOPE` (reject) por decisão explícita do Roteador (ER-V1-FINAL-003).
 * Sem declarar o escopo, o coder pode produzir exatamente o patch certo e ele é
 * rejeitado: medido em 2026-10-09, o patch correto do `package.json` (fast-uri
 * 3.1.0 -> 3.1.8) foi barrado com `NO_PATCH_SCOPE` e a missão esgotou as tentativas.
 *
 * O escopo é o MANIFESTO/LOCKFILE que declara a dependência — nunca o código do
 * serviço: uma atualização de dependência não edita `api/server.js`.
 */
const DEPENDENCY_SCOPE_BY_SERVICE = Object.freeze({
  // npm é um workspace: a árvore resolvida vive no lock da raiz, mesmo para pacote
  // que pertence ao serviço `api` (não existe api/package.json neste repositório).
  api: ['package.json', 'package-lock.json'],
  // Dependência do frontend pode estar hoisted para a raiz; manter os dois conjuntos
  // é necessário para o override/bump real, e ainda é só manifesto+lock.
  frontend: ['frontend/package.json', 'frontend/package-lock.json', 'package.json', 'package-lock.json'],
  'rag-service': ['rag-service/requirements.txt'],
});
const DEFAULT_DEPENDENCY_SCOPE = Object.freeze(['package.json', 'package-lock.json']);

/**
 * Caminhos que uma correção de dependência NÃO pode tocar, mesmo que apareçam no
 * patch: governança, gates, políticas de roteamento, CI e segredos. O texto da
 * missão já proíbe; aqui a proibição passa a ser MECÂNICA (forbidden sempre vence
 * sobre allowed). Motivo: já houve patch de missão que alterou
 * `modelCapabilities.js` (peça de governança do roteador) durante um fix.
 */
const DEPENDENCY_FORBIDDEN_PATHS = Object.freeze([
  'scripts/governance/**',
  'governance/**',
  'qa/**',
  'qa-mesh/**',
  '.github/**',
  'migrations/**',
  'config/**',
  'engine/engineeringRouter/**',
  'api/services/engineeringRouter/**',
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
]);

/** Escopo declarado para o alvo da correção (serviço/ecossistema). */
function dependencyScopeOf(plan = {}) {
  const service = String(plan.service || '').toLowerCase();
  const ecosystem = String(plan.ecosystem || '').toLowerCase();
  if (ecosystem === 'pypi' || service === 'rag-service') return [...DEPENDENCY_SCOPE_BY_SERVICE['rag-service']];
  return [...(DEPENDENCY_SCOPE_BY_SERVICE[service] || DEFAULT_DEPENDENCY_SCOPE)];
}

/**
 * Monta o payload da missão do Roteador Engenheiro para um candidato.
 *
 * PURO: não cria nada. O chamador é quem submete (e é isso que mantém a
 * criação de missão explícita, autorizada e auditável).
 */
function buildPatchMissionSpec({ plan, finding = {}, component = {} } = {}) {
  if (!plan) throw new Error('patch_plan_required');
  const service = plan.service || component.service || null;
  // Aceite = prova MECÂNICA (versão alvo aplicada) + sinal FUNCIONAL que cabe no deadline de
  // comando do Runner (120 s). A suíte completa e os gates de selo ficam no pipeline de release.
  const testCommands = [
    dependencyResolutionCommand(plan),
    ...(SERVICE_TEST_COMMANDS[service] || []),
  ].filter(Boolean);
  const risk = plan.updateRisk === UPDATE_RISK.MAJOR || plan.severity === 'CRITICAL'
    ? 'high'
    : (plan.severity === 'HIGH' || plan.kev) ? 'medium' : 'low';

  const lines = [
    `Corrigir vulnerabilidade ${plan.advisoryId || '(advisory não identificado)'} em ${plan.packageName}.`,
    '',
    `Contexto: ${plan.packageName}@${plan.currentVersion} (serviço ${service || 'desconhecido'})`,
    `Alvo: ${plan.targetVersion || '(sem versão corrigida publicada)'} — tipo de correção ${plan.kind}, risco ${plan.updateRisk}.`,
    `Severidade do achado: ${plan.severity || 'desconhecida'}${plan.kev ? ' (CISA KEV: exploração conhecida)' : ''}${plan.devOnly ? ' [dependência dev-only]' : ''}.`,
    '',
    'Restrições inegociáveis:',
    '- Atualizar SOMENTE a dependência alvo e o que for estritamente necessário para ela compilar.',
    '- NÃO reduzir cobertura de teste nem desabilitar/ignorar testes para obter verde.',
    '- NÃO alterar governança, políticas, gates ou scripts de release.',
    '- Se a atualização introduzir regressão mais grave que o problema original, PARAR e reportar.',
    '',
    'Pré-condições antes de considerar concluído:',
    ...plan.preconditions.map((item) => `- ${item}`),
    '',
    'Aceite executado por comando (o que precisa passar):',
    ...testCommands.map((cmd) => `- ${cmd}`),
  ];

  return {
    mission: lines.join('\n'),
    options: {
      title: `security: atualizar ${plan.packageName} ${plan.currentVersion} -> ${plan.targetVersion || 'sem alvo'} (${plan.advisoryId || 'advisory'})`,
      scope: 'single-dependency-update',
      risk,
      // Escopo MECÂNICO: sem `allowedPaths` o Roteador rejeita todo patch
      // (NO_PATCH_SCOPE); com ele, o patch só pode tocar manifesto/lock da
      // dependência, e governança/segredos ficam proibidos por contrato.
      allowedPaths: dependencyScopeOf(plan),
      forbiddenPaths: [...DEPENDENCY_FORBIDDEN_PATHS],
      constraints: plan.preconditions,
      contextHints: {
        advisoryId: plan.advisoryId || null,
        findingKey: plan.findingKey || null,
        candidateKey: plan.candidateKey || null,
        currentVersion: plan.currentVersion || null,
        targetVersion: plan.targetVersion || null,
        updateRisk: plan.updateRisk,
        autonomy: plan.autonomy,
        service,
        devOnly: plan.devOnly === true,
      },
      acceptanceCriteria: [
        `${plan.packageName} resolvido em versão >= ${plan.targetVersion || 'corrigida'}`,
        'comando funcional do aceite verde (núcleo determinístico do serviço; a suíte completa e os gates de selo são do pipeline de release, não da missão)',
        'nenhuma dependência não relacionada alterada',
      ],
      testCommands,
    },
  };
}

/**
 * Consolida os planos por PACOTE — distinção exigida pelo contrato de
 * Version & Patch Intelligence:
 *
 *   MINIMUM_FIXED_VERSION  → menor versão que corrige UM advisory.
 *   RECOMMENDED_VERSION    → menor versão que corrige TODOS os advisories
 *                            conhecidos do pacote (ou seja, o maior dos
 *                            mínimos) — é o alvo útil para quem vai atualizar.
 *
 * Quando algum advisory do pacote NÃO tem versão corrigida publicada, o pacote
 * NÃO é "limpo por bump": `fullyClearable = false` e a ação é humana
 * (controle compensatório/waiver), independentemente de qualquer atualização.
 */
function consolidatePlansByPackage(plans = []) {
  const groups = new Map();
  for (const plan of plans) {
    if (plan.kind === PATCH_KINDS.NOT_APPLICABLE) continue;
    const key = `${plan.ecosystem || '?'}:${plan.packageName}@${plan.service || '-'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ecosystem: plan.ecosystem || null,
        packageName: plan.packageName,
        service: plan.service || null,
        currentVersion: plan.currentVersion || null,
        severity: plan.severity || null,
        kev: plan.kev === true,
        devOnly: plan.devOnly === true,
        advisories: [],
        targets: [],
      });
    }
    const group = groups.get(key);
    group.advisories.push(plan.advisoryId || null);
    if (plan.severity === 'CRITICAL') group.severity = 'CRITICAL';
    else if (plan.severity === 'HIGH' && group.severity !== 'CRITICAL') group.severity = 'HIGH';
    if (plan.kev) group.kev = true;
    if (plan.targetVersion) group.targets.push(plan.targetVersion);
  }

  return [...groups.values()].map((group) => {
    const withoutFix = group.advisories.length - group.targets.length;
    const recommendedVersion = group.targets.length === 0
      ? null
      : group.targets.reduce((max, candidate) => {
        const comparison = compareVersions(candidate, max, { ecosystem: group.ecosystem });
        return comparison !== null && comparison > 0 ? candidate : max;
      });
    const updateRisk = recommendedVersion
      ? classifyUpdateRisk({ from: group.currentVersion, to: recommendedVersion, ecosystem: group.ecosystem })
      : UPDATE_RISK.NONE;
    const fullyClearable = withoutFix === 0 && recommendedVersion !== null;
    const autonomy = (updateRisk === UPDATE_RISK.MAJOR || !fullyClearable)
      ? AUTONOMY.LEVEL_C
      : AUTONOMY.LEVEL_B;
    return {
      key: group.key,
      ecosystem: group.ecosystem,
      packageName: group.packageName,
      service: group.service,
      currentVersion: group.currentVersion,
      minimumFixedVersion: group.targets.length > 0
        ? group.targets.reduce((min, candidate) => {
          const comparison = compareVersions(candidate, min, { ecosystem: group.ecosystem });
          return comparison !== null && comparison < 0 ? candidate : min;
        })
        : null,
      recommendedVersion,
      updateRisk,
      autonomy,
      requiresHumanApproval: autonomy === AUTONOMY.LEVEL_C,
      advisoriesTotal: group.advisories.length,
      advisoriesWithoutFix: withoutFix,
      fullyClearable,
      severity: group.severity,
      kev: group.kev,
      devOnly: group.devOnly,
    };
  }).sort((a, b) => {
    if (a.fullyClearable !== b.fullyClearable) return a.fullyClearable ? 1 : -1;
    if (a.kev !== b.kev) return a.kev ? -1 : 1;
    const severityWeight = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };
    const diff = (severityWeight[a.severity] ?? 9) - (severityWeight[b.severity] ?? 9);
    if (diff !== 0) return diff;
    return String(a.packageName).localeCompare(String(b.packageName));
  });
}

/** Resumo do plano (para relatório e para o corpo da missão). */
function summarizePlans(plans = []) {
  const byKind = {};
  const byRisk = {};
  const byAutonomy = {};
  for (const plan of plans) {
    byKind[plan.kind] = (byKind[plan.kind] || 0) + 1;
    byRisk[plan.updateRisk] = (byRisk[plan.updateRisk] || 0) + 1;
    byAutonomy[plan.autonomy] = (byAutonomy[plan.autonomy] || 0) + 1;
  }
  return {
    total: plans.length,
    byKind,
    byRisk,
    byAutonomy,
    actionable: plans.filter((plan) => plan.kind !== PATCH_KINDS.NOT_APPLICABLE && plan.kind !== PATCH_KINDS.NO_PATCH).length,
    withoutPatch: plans.filter((plan) => plan.kind === PATCH_KINDS.NO_PATCH).length,
    requiringHumanApproval: plans.filter((plan) => plan.requiresHumanApproval).length,
  };
}

module.exports = {
  PATCH_KINDS,
  UPDATE_RISK,
  AUTONOMY,
  RAG_SERVICES,
  SERVICE_TEST_COMMANDS,
  minimumFixedVersion,
  classifyUpdateRisk,
  preconditionsFor,
  planPatch,
  buildPatchMissionSpec,
  dependencyScopeOf,
  dependencyResolutionCommand,
  consolidatePlansByPackage,
  rankPlans,
  summarizePlans,
};
