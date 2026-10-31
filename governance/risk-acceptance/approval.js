'use strict';

/**
 * governance/risk-acceptance/approval.js — APROVAÇÃO HUMANA DE MISSÃO (missão L-1 FINAL §7/§8).
 *
 * Aceite de risco e aprovação de missão são atos DIFERENTES e nunca se substituem:
 *   - aceitar um risco NÃO autoriza execução;
 *   - aprovar uma missão NÃO aceita todos os riscos.
 *
 * Regras que este módulo torna executáveis (cenários 16–19 do §8):
 *   16. sem arquivo de aprovação ⇒ não aprovado (o gate fica PENDING_HUMAN_APPROVAL);
 *   17. aprovação de OUTRA missão ⇒ recusada (missionId precisa casar com o pedido vigente);
 *   18. aprovação ANTERIOR a alteração do código ⇒ recusada (vinculada a `sourceCommit`);
 *   19. assinatura inválida ⇒ recusada (Ed25519 com chave pública da autoridade registrada).
 *
 * O agente prepara o PEDIDO (`*approval-request.json`) e nunca a aprovação.
 */

const { canonicalJson, sha256, verificarEd25519 } = require('./signature');

const CAMPOS_APROVACAO = Object.freeze([
  'approver',
  'approvedAt',
  'missionId',
  'scope',
  'statement',
  'sourceCommit',
]);

const PADRAO_IDENTIDADE_AGENTE = /(\bagent(e)?\b|\bcopilot\b|\bclaude\b|\bgpt\b|\bcodex\b|\bbot\b|\bia\b|\bllm\b)/i;

function payloadAprovacao(doc) {
  const base = {};
  for (const campo of CAMPOS_APROVACAO) base[campo] = doc ? doc[campo] : undefined;
  return canonicalJson(base);
}

function hashDaAprovacao(doc) {
  return sha256(payloadAprovacao(doc));
}

/**
 * Valida a aprovação humana de missão.
 *
 * @param {object} doc conteúdo de `engineer-supervised-approval.json`
 * @param {object} ctx
 * @param {string} ctx.sourceCommit commit corrente (HEAD)
 * @param {string} ctx.missionId id da missão pedida (do approval-request)
 * @param {object[]} ctx.autoridades registro de autoridades
 * @param {number} [ctx.agora]
 * @returns {{ok:boolean, motivos:string[]}}
 */
function validarAprovacaoHumana(doc, ctx = {}) {
  const motivos = [];
  if (!doc || typeof doc !== 'object') return { ok: false, motivos: ['APROVACAO_AUSENTE'] };

  for (const campo of CAMPOS_APROVACAO) {
    if (!doc[campo] || String(doc[campo]).trim() === '') motivos.push(`CAMPO_AUSENTE:${campo}`);
  }
  if (doc.simulated === true) motivos.push('APROVACAO_SIMULADA');
  if (doc.approver && PADRAO_IDENTIDADE_AGENTE.test(String(doc.approver))) motivos.push('APROVADOR_E_AGENTE');
  if (Number.isNaN(Date.parse(String(doc.approvedAt || '')))) motivos.push('APPROVED_AT_INVALIDO');
  if (ctx.missionId && String(doc.missionId) !== String(ctx.missionId)) motivos.push('MISSAO_DIFERENTE');
  if (ctx.sourceCommit && String(doc.sourceCommit).toLowerCase() !== String(ctx.sourceCommit).toLowerCase()) {
    motivos.push('APROVACAO_DE_OUTRO_COMMIT');
  }

  const identidade = String(doc.approverIdentity || doc.approver || '');
  const autoridades = Array.isArray(ctx.autoridades) ? ctx.autoridades : [];
  const autoridade = autoridades.find((a) => a && a.identity === identidade);
  if (!autoridade) motivos.push('AUTORIDADE_NAO_REGISTRADA');
  else {
    if (autoridade.mayApproveMissions !== true) motivos.push('AUTORIDADE_SEM_PERMISSAO_DE_APROVACAO');
    const v = verificarEd25519(payloadAprovacao(doc), doc.signature && doc.signature.value, autoridade.publicKeyPem);
    if (!v.ok) motivos.push(v.reason || 'ASSINATURA_INVALIDA');
  }

  if (doc.approvalArtifactHash && doc.approvalArtifactHash !== hashDaAprovacao(doc)) {
    motivos.push('HASH_DA_APROVACAO_DIVERGENTE');
  }

  return { ok: motivos.length === 0, motivos };
}

module.exports = { CAMPOS_APROVACAO, payloadAprovacao, hashDaAprovacao, validarAprovacaoHumana };
