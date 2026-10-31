'use strict';

/**
 * governance/risk-acceptance/policy.js — POLÍTICA DE CLASSIFICAÇÃO DE BLOQUEIOS E ACEITE DE RISCO.
 *
 * Missão L-1 FINAL (§3, §4, §5, §6): separar "bloqueio real para engenharia supervisionada" de
 * "pendência de certificação comercial", "pendência de release" e "dependência externa" — sem
 * confundir aceite com resolução e sem permitir que o agente aceite risco por conta própria.
 *
 * Regras que este módulo torna executáveis:
 *   1. CLASSES FECHADAS: só existem as seis classes da missão. Qualquer outro rótulo é BLOCKED.
 *   2. NÃO DISPENSÁVEL: existe um conjunto de categorias (violação de isolamento, vazamento,
 *      execução sem autorização, bypass de aprovação, manipulação de evidência, falso PASS,
 *      teste obrigatório ausente, revisor não independente, execução fora do workspace, escrita
 *      após perda de fencing, corrupção de dados, publicação não autorizada, P0 no escopo,
 *      P1 de segurança/integridade) que impede GO em QUALQUER classe — inclusive
 *      NOT_APPLICABLE. Rotear para outro gate não "resolve" um problema não dispensável.
 *   3. ACEITE NUNCA VIRA RESOLUÇÃO: `ACCEPTED_RISK` e `RESOLVED_VERIFIED` são estados distintos e
 *      o relatório os mostra separados; este módulo reprova qualquer tentativa de apresentar um
 *      aceite como resolução.
 *   4. AUTORIDADE REAL: o aceite exige autoridade registrada (chave pública + `mayAcceptRisks` +
 *      decisão autorizada) e assinatura Ed25519 válida sobre o payload canônico. Aceite sem
 *      assinatura, de identidade de agente, expirado, revogado, de outro commit/escopo ou para
 *      outro risco é RECUSADO.
 */

const { construirPayload, hashDoPayload, verificarEd25519 } = require('./signature');

/** As três decisões formalmente separadas (§5). */
const DECISOES = Object.freeze({
  ENGINEER_SUPERVISED_READINESS: Object.freeze({
    id: 'ENGINEER_SUPERVISED_READINESS',
    escopo: 'cadeia do Engenheiro (L0/L1/L2/L3 do Router e da Mission) em execução supervisionada',
    autoridade: 'dono da plataforma + auditoria externa',
    validadores: ['scripts/governance/validate-engineer-supervised-readiness.js'],
    aceitaClasses: ['ACCEPTED_RISK', 'NOT_APPLICABLE_WITH_EVIDENCE', 'RESOLVED_VERIFIED'],
  }),
  PLATFORM_PRODUCTION_READINESS: Object.freeze({
    id: 'PLATFORM_PRODUCTION_READINESS',
    escopo: 'plataforma inteira pronta para operação (dados, isolamento, integrações)',
    autoridade: 'dono da plataforma',
    validadores: ['scripts/governance/validate-governance-enforcement.js', 'scripts/governance/validate-release-governance.js'],
    aceitaClasses: ['ACCEPTED_RISK', 'RESOLVED_VERIFIED'],
  }),
  RELEASE_CERTIFICATION_READINESS: Object.freeze({
    id: 'RELEASE_CERTIFICATION_READINESS',
    escopo: 'selagem, empacotamento, cadeia criptográfica e publicação',
    autoridade: 'dono do release',
    validadores: ['scripts/governance/seal-release.sh', 'scripts/governance/validate-dist-cleanliness.js'],
    aceitaClasses: ['ACCEPTED_RISK', 'RESOLVED_VERIFIED'],
  }),
});

/** Classes permitidas (§2 da missão). */
const CLASSES = Object.freeze([
  'L1_BLOCKING',
  'PLATFORM_BLOCKING',
  'RELEASE_ONLY',
  'EXTERNAL_DEPENDENCY',
  'RESOLVED_VERIFIED',
  'NOT_APPLICABLE_WITH_EVIDENCE',
]);

/** Categorias que NÃO podem ser aceitas nem roteadas para fora de L-1 (§4). */
const CATEGORIAS_NAO_DISPENSAVEIS = Object.freeze([
  'TENANT_ISOLATION_VIOLATION',
  'DATA_LEAK',
  'UNAUTHORIZED_EXECUTION',
  'APPROVAL_BYPASS',
  'EVIDENCE_MANIPULATION',
  'FALSE_PASS',
  'MISSING_MANDATORY_TEST',
  'NON_INDEPENDENT_REVIEWER',
  'OUT_OF_WORKSPACE_EXECUTION',
  'WRITE_AFTER_FENCING_LOSS',
  'DATA_CORRUPTION',
  'UNAUTHORIZED_PUBLICATION',
  'OPEN_P0_IN_SCOPE',
  'BLOCKING_SECURITY_P1',
]);

/** Identidades que NÃO podem assinar (o agente não aceita risco nem se auto-aprova). */
const PADRAO_IDENTIDADE_AGENTE = /(\bagent(e)?\b|\bcopilot\b|\bclaude\b|\bgpt\b|\bcodex\b|\bbot\b|\bia\b|\bllm\b|\bm[aá]quina\b)/i;

const SEVERIDADES = ['P0', 'P1', 'P2', 'P3', 'INFO'];

const ESCOPOS_PROIBIDOS_OBRIGATORIOS = Object.freeze([
  'release',
  'publicacao',
  'main',
  'aprovacao_humana',
]);

function textoValido(v, minimo = 1) {
  return typeof v === 'string' && v.trim().length >= minimo;
}

function isoValido(v) {
  if (typeof v !== 'string') return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Valida um aceite de risco.
 *
 * @param {object} aceite documento do aceite
 * @param {object} ctx
 * @param {string} ctx.riskId risco que está sendo aceito (precisa casar)
 * @param {string} ctx.sourceCommit commit corrente (40 hex)
 * @param {string} ctx.decisao decisão alvo (`ENGINEER_SUPERVISED_READINESS`…)
 * @param {object[]} ctx.autoridades registro de autoridades
 * @param {string[]} ctx.categorias categorias declaradas para o risco
 * @param {string[]} [ctx.revogados] riscos revogados
 * @param {number} [ctx.agora] epoch ms (injetável para teste)
 * @param {(rel:string)=>boolean} [ctx.existeArquivo]
 * @returns {{ok:boolean, estado:'ACCEPTED_RISK'|'BLOCKED', motivos:string[]}}
 */
function validarAceite(aceite, ctx = {}) {
  const motivos = [];
  const agora = Number.isFinite(ctx.agora) ? ctx.agora : Date.now();
  const negar = (codigo) => motivos.push(codigo);

  if (!aceite || typeof aceite !== 'object') {
    return { ok: false, estado: 'BLOCKED', motivos: ['ACEITE_AUSENTE'] };
  }

  // 1. Campos obrigatórios (§3) — todos, sem atalho.
  const obrigatorios = [
    'riskId', 'riskDescription', 'severity', 'affectedScope', 'allowedScope', 'prohibitedScope',
    'justification', 'residualImpact', 'compensatingControls', 'approvedBy', 'approverIdentity',
    'approverAuthority', 'approvedAt', 'expiresAt', 'sourceCommit', 'evidenceReferences',
    'approvalArtifactHash',
  ];
  for (const campo of obrigatorios) {
    if (aceite[campo] === undefined || aceite[campo] === null) negar(`CAMPO_AUSENTE:${campo}`);
  }

  // 2. Risco e severidade.
  if (aceite.riskId !== ctx.riskId) negar('RISCO_DIFERENTE_DO_ITEM');
  if (!SEVERIDADES.includes(String(aceite.severity || '').toUpperCase())) negar('SEVERIDADE_INVALIDA');

  // 3. Escopo: precisa cobrir a decisão alvo e precisar o que continua proibido.
  const allowed = Array.isArray(aceite.allowedScope) ? aceite.allowedScope : [];
  if (!allowed.includes(ctx.decisao)) negar('ESCOPO_NAO_COBRE_A_DECISAO');
  if (allowed.includes('*') || allowed.includes('ALL')) negar('ESCOPO_GENERICO_PROIBIDO');
  const proibidos = Array.isArray(aceite.prohibitedScope) ? aceite.prohibitedScope.map((p) => String(p).toLowerCase()) : [];
  for (const exigido of ESCOPOS_PROIBIDOS_OBRIGATORIOS) {
    if (!proibidos.some((p) => p.includes(exigido))) negar(`ESCOPO_PROIBIDO_NAO_DECLARADO:${exigido}`);
  }

  // 4. Justificativa, impacto residual e controles compensatórios.
  if (!textoValido(aceite.justification, 40)) negar('JUSTIFICATIVA_INSUFICIENTE');
  if (!textoValido(aceite.residualImpact, 20)) negar('IMPACTO_RESIDUAL_INSUFICIENTE');
  const controles = Array.isArray(aceite.compensatingControls) ? aceite.compensatingControls.filter((c) => textoValido(c, 5)) : [];
  if (controles.length === 0) negar('CONTROLES_COMPENSATORIOS_AUSENTES');

  // 5. Autoridade humana real.
  if (!textoValido(aceite.approvedBy)) negar('APROVADOR_AUSENTE');
  const identidade = String(aceite.approverIdentity || '');
  if (!textoValido(identidade)) negar('IDENTIDADE_AUSENTE');
  else if (PADRAO_IDENTIDADE_AGENTE.test(identidade)) negar('IDENTIDADE_DE_AGENTE');
  if (aceite.simulated === true) negar('ACEITE_SIMULADO');
  const autoridades = Array.isArray(ctx.autoridades) ? ctx.autoridades : [];
  const autoridade = autoridades.find((a) => a && a.identity === identidade);
  if (!autoridade) negar('AUTORIDADE_NAO_REGISTRADA');
  else {
    if (autoridade.mayAcceptRisks !== true) negar('AUTORIDADE_SEM_PERMISSAO_DE_ACEITE');
    const decisoes = Array.isArray(autoridade.decisions) ? autoridade.decisions : [];
    if (!decisoes.includes(ctx.decisao)) negar('AUTORIDADE_SEM_ALCANCE_PARA_DECISAO');
    if (aceite.approverAuthority !== autoridade.authority) negar('AUTORIDADE_DIVERGENTE_DO_REGISTRO');
  }

  // 6. Temporalidade e revogação.
  if (!isoValido(aceite.approvedAt)) negar('APPROVED_AT_INVALIDO');
  else if (Date.parse(aceite.approvedAt) > agora + 5 * 60 * 1000) negar('APPROVED_AT_NO_FUTURO');
  if (!isoValido(aceite.expiresAt)) negar('EXPIRES_AT_INVALIDO');
  else {
    if (Date.parse(aceite.expiresAt) <= Date.parse(aceite.approvedAt)) negar('EXPIRES_AT_ANTES_DA_APROVACAO');
    if (Date.parse(aceite.expiresAt) <= agora) negar('ACEITE_EXPIRADO');
  }
  const revogados = Array.isArray(ctx.revogados) ? ctx.revogados : [];
  if (revogados.includes(aceite.riskId)) negar('ACEITE_REVOGADO');

  // 7. Vínculo com o código aceito.
  if (!/^[0-9a-f]{40}$/i.test(String(aceite.sourceCommit || ''))) negar('SOURCE_COMMIT_INVALIDO');
  else if (String(aceite.sourceCommit).toLowerCase() !== String(ctx.sourceCommit || '').toLowerCase()) {
    negar('ACEITE_DE_OUTRO_COMMIT');
  }

  // 8. Evidências citadas precisam existir (e, quando com hash, casar).
  const evidencias = Array.isArray(aceite.evidenceReferences) ? aceite.evidenceReferences : [];
  if (evidencias.length === 0) negar('EVIDENCIAS_AUSENTES');
  for (const ev of evidencias) {
    const rel = typeof ev === 'string' ? ev : (ev && ev.path);
    if (!textoValido(rel)) { negar('EVIDENCIA_SEM_CAMINHO'); continue; }
    if (typeof ctx.existeArquivo === 'function' && !ctx.existeArquivo(rel)) negar(`EVIDENCIA_INEXISTENTE:${rel}`);
  }

  // 9. Integridade do próprio aceite: hash do payload canônico.
  const hashEsperado = hashDoPayload(aceite);
  if (String(aceite.approvalArtifactHash || '') !== hashEsperado) negar('HASH_DO_ACEITE_DIVERGENTE');

  // 10. Assinatura Ed25519 com a chave pública do registro.
  if (autoridade) {
    const assinatura = aceite.signature && aceite.signature.value;
    const v = verificarEd25519(construirPayload(aceite), assinatura, autoridade.publicKeyPem);
    if (!v.ok) negar(v.reason || 'ASSINATURA_INVALIDA');
  } else {
    negar('ASSINATURA_NAO_VERIFICAVEL_SEM_AUTORIDADE');
  }

  // 11. Não dispensável (§4) — nem aceite, nem roteamento.
  const categorias = Array.isArray(ctx.categorias) ? ctx.categorias : [];
  for (const cat of categorias) {
    if (CATEGORIAS_NAO_DISPENSAVEIS.includes(cat)) negar(`CATEGORIA_NAO_DISPENSAVEL:${cat}`);
  }

  return { ok: motivos.length === 0, estado: motivos.length === 0 ? 'ACCEPTED_RISK' : 'BLOCKED', motivos };
}

/**
 * Resolve o estado de um item bloqueado da fila para a decisão pedida.
 *
 * Ordem deliberada: resolução comprovada → não aplicável com evidência → aceite humano válido →
 * BLOCKED. Nunca o contrário: aceite não pode "pular" para resolução.
 *
 * @param {object} item item da fila (`id`, `status`)
 * @param {object} rota entrada do roteamento (`class`, `ownedBy`, `justification`, `evidenceReferences`, `probe`)
 * @param {object} ctx contexto (ver `validarAceite`) + `executarProbe`
 * @returns {{riskId:string, estado:string, classe:string|null, motivos:string[], detalhe:object}}
 */
function resolverItemBloqueado(item, rota, ctx = {}) {
  const riskId = String(item && item.id);
  const motivos = [];

  if (!rota || typeof rota !== 'object') {
    return { riskId, estado: 'BLOCKED', classe: null, motivos: ['SEM_ROTA_DECLARADA'], detalhe: {} };
  }
  const classe = String(rota.class || '');
  if (!CLASSES.includes(classe)) {
    return { riskId, estado: 'BLOCKED', classe: classe || null, motivos: [`CLASSE_INVALIDA:${classe}`], detalhe: {} };
  }
  if (classe === 'L1_BLOCKING') {
    return { riskId, estado: 'BLOCKED', classe, motivos: ['CLASSIFICADO_COMO_BLOQUEANTE_DE_L1'], detalhe: {} };
  }

  // Categorias não dispensáveis impedem qualquer estado positivo.
  const categorias = Array.isArray(rota.categories) ? rota.categories : [];
  const naoDispensavel = categorias.filter((c) => CATEGORIAS_NAO_DISPENSAVEIS.includes(c));
  if (naoDispensavel.length > 0) {
    return {
      riskId,
      estado: 'BLOCKED',
      classe,
      motivos: naoDispensavel.map((c) => `CATEGORIA_NAO_DISPENSAVEL:${c}`),
      detalhe: {},
    };
  }

  const evidencias = Array.isArray(rota.evidenceReferences) ? rota.evidenceReferences : [];

  // (a) RESOLVED_VERIFIED — exige PROVA EXECUTADA agora, não afirmação.
  if (classe === 'RESOLVED_VERIFIED') {
    if (typeof rota.probe !== 'string' || rota.probe.trim() === '') {
      return { riskId, estado: 'BLOCKED', classe, motivos: ['RESOLUCAO_SEM_PROBE'], detalhe: {} };
    }
    if (typeof ctx.executarProbe !== 'function') {
      return { riskId, estado: 'BLOCKED', classe, motivos: ['PROBE_NAO_EXECUTAVEL'], detalhe: {} };
    }
    const probe = ctx.executarProbe(rota.probe);
    if (!probe || probe.exitCode !== 0) {
      return {
        riskId,
        estado: 'BLOCKED',
        classe,
        motivos: ['PROBE_DE_RESOLUCAO_FALHOU'],
        detalhe: { probe: rota.probe, exitCode: probe ? probe.exitCode : null, sha256Saida: probe ? probe.sha256Saida : null },
      };
    }
    return {
      riskId,
      estado: 'RESOLVED_VERIFIED',
      classe,
      motivos: [],
      detalhe: { probe: rota.probe, exitCode: probe.exitCode, sha256Saida: probe.sha256Saida, evidencias },
    };
  }

  // (b) NOT_APPLICABLE_WITH_EVIDENCE — exige dono declarado entre as três decisões + evidência.
  if (classe === 'NOT_APPLICABLE_WITH_EVIDENCE') {
    if (!DECISOES[String(rota.ownedBy || '')] || rota.ownedBy === 'ENGINEER_SUPERVISED_READINESS') {
      motivos.push('OWNER_INVALIDO_PARA_NAO_APLICAVEL');
    }
    if (!textoValido(rota.justification, 60)) motivos.push('JUSTIFICATIVA_INSUFICIENTE');
    if (evidencias.length === 0) motivos.push('EVIDENCIAS_AUSENTES');
    if (typeof ctx.existeArquivo === 'function') {
      for (const ev of evidencias) {
        const rel = typeof ev === 'string' ? ev : ev && ev.path;
        if (!textoValido(rel) || !ctx.existeArquivo(rel)) motivos.push(`EVIDENCIA_INEXISTENTE:${rel}`);
      }
    }
    return motivos.length > 0
      ? { riskId, estado: 'BLOCKED', classe, motivos, detalhe: {} }
      : { riskId, estado: 'NOT_APPLICABLE', classe, motivos: [], detalhe: { ownedBy: rota.ownedBy, evidencias } };
  }

  // (c) PLATFORM_BLOCKING / RELEASE_ONLY / EXTERNAL_DEPENDENCY — risco continua vivo, roteado.
  if (['PLATFORM_BLOCKING', 'RELEASE_ONLY', 'EXTERNAL_DEPENDENCY'].includes(classe)) {
    if (!DECISOES[String(rota.ownedBy || '')] || rota.ownedBy === 'ENGINEER_SUPERVISED_READINESS') {
      motivos.push('OWNER_INVALIDO');
    }
    if (!textoValido(rota.justification, 60)) motivos.push('JUSTIFICATIVA_INSUFICIENTE');
    if (evidencias.length === 0) motivos.push('EVIDENCIAS_AUSENTES');

    // Aceite humano válido pode converter o item em ACCEPTED_RISK — nunca em resolução.
    if (ctx.aceite) {
      const avaliacao = validarAceite(ctx.aceite, { ...ctx, categorias });
      if (avaliacao.ok) {
        return {
          riskId,
          estado: 'ACCEPTED_RISK',
          classe,
          motivos: [],
          detalhe: { ownedBy: rota.ownedBy, aceiteExpiraEm: ctx.aceite.expiresAt, aprovadoPor: ctx.aceite.approverIdentity },
        };
      }
      motivos.push(...avaliacao.motivos.map((m) => `ACEITE:${m}`));
    }

    return motivos.length > 0
      ? { riskId, estado: 'BLOCKED', classe, motivos, detalhe: {} }
      : { riskId, estado: 'NOT_APPLICABLE', classe, motivos: [], detalhe: { ownedBy: rota.ownedBy, evidencias } };
  }

  return { riskId, estado: 'BLOCKED', classe, motivos: ['CLASSE_NAO_TRATADA'], detalhe: {} };
}

module.exports = {
  DECISOES,
  CLASSES,
  CATEGORIAS_NAO_DISPENSAVEIS,
  PADRAO_IDENTIDADE_AGENTE,
  SEVERIDADES,
  validarAceite,
  resolverItemBloqueado,
};
