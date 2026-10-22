'use strict';

/**
 * governance/bug-closure/closure-proof.js — PROVA DE FECHAMENTO DE DEFEITO (Camada B).
 *
 * MISSÃO P0 (2026-10-22) — BLINDAGEM DO BUG CLOSURE FIRST.
 *
 * DEFEITO MEDIDO (reproduzido em `bypass-reproducao.txt`): `eBloqueanteParaCertificacao`
 * decide pelo campo PERSISTIDO `state`. Editar `AI_MEMORY/hardening-queue.json` para
 * `state: "RESOLVED"` (ou só `status: "prevention_active"`, que a migração legada traduz
 * para RESOLVED) fazia `evaluateExecutionEligibility(..., 'SELO_FINAL')` devolver
 * `ALLOWED` — sem nenhuma regressão executada, sem SHA verificado e sem prova alguma.
 *
 * Arquitetura da correção: o ESTADO (camada A, `defect-states.js`) descreve o andamento
 * da correção; a PROVA (camada B, este módulo) é a única coisa que pode suspender o
 * bloqueio para operações CERTIFICANTES. Uma prova de fechamento só é válida se:
 *
 *   1. identificar o defeito e a transição exata (from → to) permitida pela máquina de estados;
 *   2. estiver amarrada ao SHA **atual** do código e ao `sourceFingerprint` **atual**;
 *   3. listar os testes exigidos e comprovar, para CADA um, comando, exit code 0,
 *      timestamps e sha256 da saída — teste não executado, exit != 0, exit ausente ou
 *      timeout RECUSAM (nunca "presume-se que passou");
 *   4. trazer evidência negativa (o defeito foi reproduzido/atacado), exigida em P0;
 *   5. trazer hashes dos artefatos citados, conferidos contra os bytes em disco;
 *   6. estar registrada em um LIVRO DE TRANSIÇÕES append-only com hash chain, sem
 *      duplicação, replay ou reordenação;
 *   7. estar ASSINADA (Ed25519) por autoridade registrada com permissão de fechamento.
 *
 * ÂNCORA DE CONFIANÇA (o ponto central): um sha256 calculado pelo próprio agente que
 * editou o JSON não prova nada — o atacante que altera o inventário também altera o hash.
 * A autenticidade vem da chave PRIVADA de uma autoridade humana registrada em
 * `governance/risk-acceptance/authorities.json` (o repositório guarda só a pública). Se
 * NENHUMA autoridade com `mayCloseDefects` estiver registrada, a verificação falha com
 * `SEM_ANCORA_DE_CONFIANCA` e a certificação permanece BLOQUEADA — é o estado medido do
 * repositório hoje (`authorities: []`), e ele é declarado, não contornado.
 *
 * Módulo PURO quanto a rede/relógio: `agora` é injetável e todo I/O de leitura é
 * parametrizado, para que os testes adversariais provem o comportamento sem tocar na
 * fila real.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ESTADOS, validarTransicao, normalizarSeveridade } = require('./defect-states');
const { canonicalJson, sha256, verificarEd25519 } = require('../risk-acceptance/signature');

const ARTIFACT_TYPE = 'defect-closure-proof';
const ARTIFACT_VERSION = '1.0.0';

/** Estados de fechamento que uma prova pode reivindicar. */
const ESTADOS_ALVO = Object.freeze([ESTADOS.VERIFIED, ESTADOS.RESOLVED]);

/** Idade máxima da prova — prova velha não certifica código novo (fail-closed). */
const IDADE_MAXIMA_MS = Number(process.env.CLOSURE_PROOF_MAX_AGE_MS) || 7 * 24 * 60 * 60 * 1000;

/** Identidades que NÃO podem fechar defeito (agente não se auto-certifica). */
const PADRAO_IDENTIDADE_AGENTE = /(\bagent(e)?\b|\bcopilot\b|\bclaude\b|\bgpt\b|\bcodex\b|\bbot\b|\bllm\b|\bm[aá]quina\b)/i;

const CODIGOS = Object.freeze({
  PROVA_MALFORMADA: 'PROVA_MALFORMADA',
  DEFEITO_DIVERGENTE: 'DEFEITO_DIVERGENTE',
  SEVERIDADE_INVALIDA: 'SEVERIDADE_INVALIDA',
  REBAIXAMENTO_DE_SEVERIDADE: 'REBAIXAMENTO_DE_SEVERIDADE',
  TRANSICAO_INVALIDA: 'TRANSICAO_INVALIDA',
  SHA_DIVERGENTE: 'SHA_DIVERGENTE',
  FINGERPRINT_DIVERGENTE: 'FINGERPRINT_DIVERGENTE',
  REGRESSAO_AUSENTE: 'REGRESSAO_AUSENTE',
  TESTE_NAO_EXECUTADO: 'TESTE_NAO_EXECUTADO',
  TESTE_INEXISTENTE: 'TESTE_INEXISTENTE',
  EXIT_CODE_AUSENTE: 'EXIT_CODE_AUSENTE',
  EXIT_CODE_NAO_ZERO: 'EXIT_CODE_NAO_ZERO',
  TIMEOUT_NO_TESTE: 'TIMEOUT_NO_TESTE',
  EVIDENCIA_NEGATIVA_AUSENTE: 'EVIDENCIA_NEGATIVA_AUSENTE',
  EVIDENCIA_ADULTERADA: 'EVIDENCIA_ADULTERADA',
  APROVACAO_HUMANA_AUSENTE: 'APROVACAO_HUMANA_AUSENTE',
  ATOR_INVALIDO: 'ATOR_INVALIDO',
  SEM_ANCORA_DE_CONFIANCA: 'SEM_ANCORA_DE_CONFIANCA',
  ASSINATURA_INVALIDA: 'ASSINATURA_INVALIDA',
  TRANSICAO_NAO_REGISTRADA: 'TRANSICAO_NAO_REGISTRADA',
  EVENTO_DUPLICADO: 'EVENTO_DUPLICADO',
  EVENTO_FORA_DE_ORDEM: 'EVENTO_FORA_DE_ORDEM',
  REPLAY_DE_EVENTO: 'REPLAY_DE_EVENTO',
  PROVA_VENCIDA: 'PROVA_VENCIDA',
  POLITICA_RECUSA: 'POLITICA_RECUSA',
});

const sha256Arquivo = (abs) => (fs.existsSync(abs)
  ? crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
  : null);

const naoVazio = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const sha40 = (v) => /^[0-9a-f]{40}$/i.test(String(v || ''));
const sha64 = (v) => /^[0-9a-f]{64}$/i.test(String(v || ''));

/**
 * Campos cobertos pela assinatura/hash da prova. `proofHash` e `signature` ficam fora
 * porque são o RESULTADO da assinatura (incluí-los seria circular).
 */
const CAMPOS_ASSINADOS = Object.freeze([
  'artifactType',
  'artifactVersion',
  'transitionId',
  'defectId',
  'severityBefore',
  'severityAfter',
  'fromState',
  'toState',
  'evaluatedCommit',
  'codeFingerprint',
  'requiredTests',
  'executions',
  'negativeEvidence',
  'artifactHashes',
  'actor',
  'humanAuthorization',
  'policyDecision',
  'createdAt',
]);

function payloadAssinavel(prova) {
  const base = {};
  for (const campo of CAMPOS_ASSINADOS) base[campo] = prova ? prova[campo] : undefined;
  return base;
}

/** Hash canônico do payload (detecta edição de qualquer campo assinado). */
function hashDoPayload(prova) {
  return sha256(canonicalJson(payloadAssinavel(prova)));
}

/**
 * Constrói um documento de prova de fechamento.
 * NÃO assina: a assinatura exige chave privada de autoridade humana, que o agente não possui.
 *
 * @param {object} entrada
 * @returns {object} prova com `proofHash` calculado
 */
function construirProvaDeFechamento(entrada = {}) {
  const prova = {
    artifactType: ARTIFACT_TYPE,
    artifactVersion: ARTIFACT_VERSION,
    transitionId: entrada.transitionId || crypto.randomUUID(),
    defectId: entrada.defectId || null,
    severityBefore: entrada.severityBefore || null,
    severityAfter: entrada.severityAfter || null,
    fromState: entrada.fromState || null,
    toState: entrada.toState || null,
    evaluatedCommit: entrada.evaluatedCommit || null,
    codeFingerprint: entrada.codeFingerprint || null,
    requiredTests: Array.isArray(entrada.requiredTests) ? entrada.requiredTests : [],
    executions: Array.isArray(entrada.executions) ? entrada.executions : [],
    negativeEvidence: Array.isArray(entrada.negativeEvidence) ? entrada.negativeEvidence : [],
    artifactHashes: Array.isArray(entrada.artifactHashes) ? entrada.artifactHashes : [],
    actor: entrada.actor || null,
    humanAuthorization: entrada.humanAuthorization || null,
    policyDecision: entrada.policyDecision || null,
    createdAt: entrada.createdAt || new Date().toISOString(),
  };
  prova.proofHash = hashDoPayload(prova);
  return prova;
}

/**
 * Autoridades com permissão de FECHAR DEFEITO (chave pública registrada).
 * Lê o MESMO registro usado pelo aceite de risco — sem criar um segundo cofre de chaves.
 */
function carregarAutoridadesDeFechamento(rootDir) {
  // `path.join` INLINE dentro do readFileSync: o auditor de persistência (RAP-078) só
  // reconhece contexto de LEITURA assim; com o caminho numa variável, `authorities.json`
  // virava "alvo de escrita fantasma" UNKNOWN e derrubava o gate.
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(rootDir, 'governance', 'risk-acceptance', 'authorities.json'), 'utf8'));
    const lista = Array.isArray(doc && doc.authorities) ? doc.authorities : [];
    return lista.filter((a) => a && a.mayCloseDefects === true && naoVazio(a.publicKeyPem));
  } catch (_) {
    return [];
  }
}

/** Núcleo de validação estrutural (sem assinatura/ledger): usado por verificação e por testes. */
function validarEstrutura(prova, ctx) {
  const reasons = [];
  const detalhe = {};
  const defeito = ctx.defeito || {};

  if (!prova || typeof prova !== 'object') return { reasons: [CODIGOS.PROVA_MALFORMADA] };
  if (prova.artifactType !== ARTIFACT_TYPE) reasons.push(CODIGOS.PROVA_MALFORMADA);
  if (!naoVazio(prova.transitionId)) reasons.push(CODIGOS.PROVA_MALFORMADA);
  if (!naoVazio(prova.defectId) || prova.defectId !== defeito.id) reasons.push(CODIGOS.DEFEITO_DIVERGENTE);

  const sevAntes = normalizarSeveridade(prova.severityBefore);
  const sevDepois = normalizarSeveridade(prova.severityAfter);
  if (!sevAntes || !sevDepois) reasons.push(CODIGOS.SEVERIDADE_INVALIDA);
  // P0 é o MAIS grave: número maior = menos grave. Rebaixar é AUMENTAR o índice
  // (P1 → P3) para escapar de bloqueio — a comparação anterior estava invertida.
  if (sevAntes && sevDepois && Number(sevDepois[1]) > Number(sevAntes[1])) {
    reasons.push(CODIGOS.REBAIXAMENTO_DE_SEVERIDADE);
  }

  if (!ESTADOS_ALVO.includes(String(prova.toState))) reasons.push(CODIGOS.TRANSICAO_INVALIDA);
  const transicao = validarTransicao({
    de: prova.fromState,
    para: prova.toState,
    severity: sevAntes,
    regressionTest: (prova.requiredTests || [])[0] || null,
    evidence: (prova.artifactHashes || [])[0] && (prova.artifactHashes || [])[0].path,
    verificationCommit: prova.evaluatedCommit,
    currentCommit: ctx.currentCommit,
  });
  if (!transicao.ok) {
    reasons.push(CODIGOS.TRANSICAO_INVALIDA);
    detalhe.transicao = transicao.reasons || [];
  }

  // SHA e fingerprint têm de ser do código ATUAL — prova de outro commit não certifica.
  if (!sha40(prova.evaluatedCommit) || String(prova.evaluatedCommit).toLowerCase() !== String(ctx.currentCommit || '').toLowerCase()) {
    reasons.push(CODIGOS.SHA_DIVERGENTE);
  }
  if (!sha64(prova.codeFingerprint) || String(prova.codeFingerprint) !== String(ctx.currentFingerprint || '')) {
    reasons.push(CODIGOS.FINGERPRINT_DIVERGENTE);
  }

  // Regressão: precisa existir, ser exigida e ter sido executada com sucesso.
  const exigidos = Array.isArray(prova.requiredTests) ? prova.requiredTests.filter(naoVazio) : [];
  if (exigidos.length === 0) reasons.push(CODIGOS.REGRESSAO_AUSENTE);
  const execucoes = Array.isArray(prova.executions) ? prova.executions : [];
  for (const teste of exigidos) {
    const exec = execucoes.find((e) => e && e.testPath === teste);
    if (!exec) { reasons.push(CODIGOS.TESTE_NAO_EXECUTADO); detalhe.testeSemExecucao = teste; continue; }
    if (ctx.existeArquivo && !ctx.existeArquivo(teste)) { reasons.push(CODIGOS.TESTE_INEXISTENTE); detalhe.testeInexistente = teste; }
    if (!naoVazio(exec.command)) reasons.push(CODIGOS.TESTE_NAO_EXECUTADO);
    if (exec.exitCode === null || exec.exitCode === undefined) reasons.push(CODIGOS.EXIT_CODE_AUSENTE);
    else if (Number(exec.exitCode) !== 0) reasons.push(CODIGOS.EXIT_CODE_NAO_ZERO);
    if (exec.timeout === true || exec.signal) reasons.push(CODIGOS.TIMEOUT_NO_TESTE);
    if (!sha64(exec.outputSha256)) reasons.push(CODIGOS.EVIDENCIA_ADULTERADA);
    if (!naoVazio(exec.startedAt) || !naoVazio(exec.finishedAt)) reasons.push(CODIGOS.TESTE_NAO_EXECUTADO);
  }

  // P0 exige evidência NEGATIVA (reprodução do defeito) — sem ela, só há afirmação.
  if (sevAntes === 'P0' && !(Array.isArray(prova.negativeEvidence) && prova.negativeEvidence.length > 0)) {
    reasons.push(CODIGOS.EVIDENCIA_NEGATIVA_AUSENTE);
  }

  // P0 exige autorização humana explícita (missão §24: aprovação obrigatória ausente = DENY).
  if (sevAntes === 'P0') {
    const ha = prova.humanAuthorization;
    if (!ha || !naoVazio(ha.by) || !naoVazio(ha.at) || !naoVazio(ha.ref)) {
      reasons.push(CODIGOS.APROVACAO_HUMANA_AUSENTE);
    }
  }

  // Ator: identificado e NÃO pode ser identidade de agente.
  const ator = prova.actor || {};
  if (!naoVazio(ator.id) || PADRAO_IDENTIDADE_AGENTE.test(String(ator.id))) reasons.push(CODIGOS.ATOR_INVALIDO);

  // Decisão de política declarada e coerente.
  if (!prova.policyDecision || prova.policyDecision.decision !== 'CLOSE_VERIFIED') reasons.push(CODIGOS.POLITICA_RECUSA);

  // Hashes dos artefatos conferidos contra os bytes em disco.
  for (const item of Array.isArray(prova.artifactHashes) ? prova.artifactHashes : []) {
    if (!item || !naoVazio(item.path) || !sha64(item.sha256)) { reasons.push(CODIGOS.EVIDENCIA_ADULTERADA); continue; }
    const abs = path.isAbsolute(item.path) ? item.path : path.join(ctx.rootDir || process.cwd(), item.path);
    const real = sha256Arquivo(abs);
    if (!real || real !== item.sha256) {
      reasons.push(CODIGOS.EVIDENCIA_ADULTERADA);
      detalhe.artefatoAdulterado = item.path;
    }
  }

  // O hash da prova tem de casar com o payload canônico (qualquer edição posterior quebra).
  if (!sha64(prova.proofHash) || prova.proofHash !== hashDoPayload(prova)) {
    reasons.push(CODIGOS.EVIDENCIA_ADULTERADA);
  }

  // Validade temporal.
  const criada = Date.parse(prova.createdAt);
  const agora = ctx.agora || Date.now();
  if (!Number.isFinite(criada) || criada > agora + 5 * 60 * 1000 || (agora - criada) > IDADE_MAXIMA_MS) {
    reasons.push(CODIGOS.PROVA_VENCIDA);
  }

  return { reasons, detalhe };
}

/**
 * Verifica a assinatura Ed25519 da prova contra uma autoridade registrada.
 * Sem autoridade com `mayCloseDefects`: `SEM_ANCORA_DE_CONFIANCA` (nunca "assume válido").
 */
function validarAncora(prova, ctx) {
  const autoridades = (ctx.autoridades !== undefined)
    ? ctx.autoridades
    : carregarAutoridadesDeFechamento(ctx.rootDir || process.cwd());
  const lista = Array.isArray(autoridades) ? autoridades : [];
  if (lista.length === 0) return { reasons: [CODIGOS.SEM_ANCORA_DE_CONFIANCA], detalhe: { autoridades: 0 } };

  const assinatura = prova && prova.signature;
  if (!assinatura || assinatura.alg !== 'Ed25519' || !naoVazio(assinatura.keyId) || !naoVazio(assinatura.value)) {
    return { reasons: [CODIGOS.ASSINATURA_INVALIDA], detalhe: { motivo: 'assinatura ausente' } };
  }
  const autoridade = lista.find((a) => String(a.identity) === String(assinatura.keyId));
  if (!autoridade) return { reasons: [CODIGOS.SEM_ANCORA_DE_CONFIANCA], detalhe: { keyId: assinatura.keyId } };
  if (String(prova.actor && prova.actor.id) !== String(autoridade.identity)) {
    return { reasons: [CODIGOS.ASSINATURA_INVALIDA], detalhe: { motivo: 'ator diverge da autoridade assinante' } };
  }

  const verificacao = verificarEd25519(
    canonicalJson(payloadAssinavel(prova)),
    assinatura.value,
    autoridade.publicKeyPem,
  );
  return verificacao.ok
    ? { reasons: [], detalhe: {} }
    : { reasons: [CODIGOS.ASSINATURA_INVALIDA], detalhe: { motivo: verificacao.reason || null } };
}

/**
 * Verifica a prova completa (estrutura + âncora + livro de transições).
 *
 * @param {object} prova
 * @param {object} ctx { defeito, currentCommit, currentFingerprint, rootDir, autoridades, livro, agora, existeArquivo }
 * @returns {{ok:boolean, code:string|null, reasons:string[], detalhe:object}}
 */
function verificarProvaDeFechamento(prova, ctx = {}) {
  const estrutura = validarEstrutura(prova, ctx);
  const ancora = validarAncora(prova, ctx);
  const reasons = [...new Set([...(estrutura.reasons || []), ...(ancora.reasons || [])])];

  // Livro de transições: o evento tem de existir EXATAMENTE UMA vez e ser coerente.
  // `ctx.livro === null` é usado SOMENTE pelo serviço de transição no instante da criação
  // (o evento é anexado logo depois, e `anexarEvento` recusa transitionId repetido). Em
  // qualquer LEITURA o livro é obrigatório — sem ele a prova não é aceita.
  const livro = ctx.livro;
  if (livro === null) {
    // criação: nada a conferir aqui; a ordem é garantida pelo append atômico.
  } else if (livro) {
    const eventos = livro.eventos || [];
    const doDefeito = eventos.filter((e) => e && e.defectId === prova.defectId);
    const iguais = doDefeito.filter((e) => e.transitionId === prova.transitionId);
    if (iguais.length === 0) reasons.push(CODIGOS.TRANSICAO_NAO_REGISTRADA);
    else if (iguais.length > 1) reasons.push(CODIGOS.EVENTO_DUPLICADO);
    else if (doDefeito[doDefeito.length - 1].transitionId !== prova.transitionId) reasons.push(CODIGOS.EVENTO_FORA_DE_ORDEM);
    const anterior = doDefeito.length >= 2 ? doDefeito[doDefeito.length - 2] : null;
    if (anterior && anterior.to !== prova.fromState) reasons.push(CODIGOS.EVENTO_FORA_DE_ORDEM);
    if (livro.integridadeOk === false) reasons.push(CODIGOS.EVIDENCIA_ADULTERADA);
    const repetido = eventos.filter((e) => e && e.transitionId === prova.transitionId && e.defectId !== prova.defectId);
    if (repetido.length > 0) reasons.push(CODIGOS.REPLAY_DE_EVENTO);
  } else {
    reasons.push(CODIGOS.TRANSICAO_NAO_REGISTRADA);
  }

  const unicos = [...new Set(reasons)];
  return {
    ok: unicos.length === 0,
    code: unicos[0] || null,
    reasons: unicos,
    detalhe: { ...(estrutura.detalhe || {}), ...(ancora.detalhe || {}) },
  };
}

module.exports = {
  ARTIFACT_TYPE,
  ARTIFACT_VERSION,
  CODIGOS,
  CAMPOS_ASSINADOS,
  ESTADOS_ALVO,
  construirProvaDeFechamento,
  verificarProvaDeFechamento,
  validarEstrutura,
  validarAncora,
  hashDoPayload,
  payloadAssinavel,
  carregarAutoridadesDeFechamento,
};
