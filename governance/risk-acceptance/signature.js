'use strict';

/**
 * governance/risk-acceptance/signature.js — INTEGRIDADE E ASSINATURA DO ACEITE DE RISCO.
 *
 * Por que existe: a missão L-1 FINAL exige que aceite de risco NÃO seja "um JSON editável como
 * única autoridade". Um arquivo versionado pode ser editado por qualquer agente — inclusive pelo
 * próprio Engenheiro que se beneficiaria do aceite. Aqui a autoridade vem de uma assinatura
 * Ed25519 produzida com chave PRIVADA que o agente não possui; o repositório guarda apenas as
 * chaves públicas das autoridades humanas registradas.
 *
 * Consequências de desenho (todas verificáveis por teste):
 *   - `canonicalJson` ordena chaves recursivamente: a assinatura não depende de formatação;
 *   - `approvalArtifactHash` é o sha256 do payload canônico — se qualquer campo for editado depois
 *     da assinatura, o hash deixa de casar e o aceite é recusado;
 *   - `verifyEd25519` usa a chave pública do REGISTRO (`authorities.json`), nunca uma chave
 *     embutida no próprio aceite (senão o agente assinaria com a própria chave).
 */

const crypto = require('crypto');

/**
 * JSON canônico determinístico: chaves ordenadas em todos os níveis, sem espaços.
 * @param {*} valor
 * @returns {string}
 */
function canonicalJson(valor) {
  const ordenar = (v) => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === 'object') {
      const saida = {};
      for (const chave of Object.keys(v).sort()) saida[chave] = ordenar(v[chave]);
      return saida;
    }
    return v;
  };
  return JSON.stringify(ordenar(valor));
}

/** sha256 hex de uma string (utf8). */
function sha256(texto) {
  return crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
}

/**
 * Campos que a assinatura cobre. `approvalArtifactHash` e `signature` ficam de fora porque são o
 * resultado da assinatura (incluí-los seria circular).
 */
const CAMPOS_ASSINADOS = Object.freeze([
  'riskId',
  'riskDescription',
  'severity',
  'affectedScope',
  'allowedScope',
  'prohibitedScope',
  'justification',
  'residualImpact',
  'compensatingControls',
  'approvedBy',
  'approverIdentity',
  'approverAuthority',
  'approvedAt',
  'expiresAt',
  'sourceCommit',
  'evidenceReferences',
]);

/** Payload canônico (o que a autoridade humana assina). */
function construirPayload(aceite) {
  const base = {};
  for (const campo of CAMPOS_ASSINADOS) base[campo] = aceite ? aceite[campo] : undefined;
  return canonicalJson(base);
}

/** Hash do payload — é o valor que `approvalArtifactHash` precisa carregar. */
function hashDoPayload(aceite) {
  return sha256(construirPayload(aceite));
}

/**
 * Verifica assinatura Ed25519.
 * @param {string} payload texto canônico assinado
 * @param {string} assinaturaBase64 valor base64 da assinatura
 * @param {string} chavePublicaPem chave pública PEM (registro de autoridades)
 * @returns {{ok:boolean, reason?:string}}
 */
function verificarEd25519(payload, assinaturaBase64, chavePublicaPem) {
  try {
    if (typeof assinaturaBase64 !== 'string' || assinaturaBase64.trim() === '') {
      return { ok: false, reason: 'ASSINATURA_AUSENTE' };
    }
    if (typeof chavePublicaPem !== 'string' || !chavePublicaPem.includes('PUBLIC KEY')) {
      return { ok: false, reason: 'CHAVE_PUBLICA_AUSENTE' };
    }
    const chave = crypto.createPublicKey(chavePublicaPem);
    const ok = crypto.verify(null, Buffer.from(payload, 'utf8'), chave, Buffer.from(assinaturaBase64, 'base64'));
    return ok ? { ok: true } : { ok: false, reason: 'ASSINATURA_INVALIDA' };
  } catch (err) {
    return { ok: false, reason: `ASSINATURA_ILEGIVEL:${err.message}` };
  }
}

/**
 * Registro de autoridades (somente chaves PÚBLICAS).
 *
 * `mayAcceptRisks` e `decisions` são a autoridade declarada; o gate exige ambos — ter a chave não
 * implica poder aceitar risco em qualquer decisão.
 */
function carregarAutoridades(lerJson) {
  const doc = lerJson('governance/risk-acceptance/authorities.json');
  const lista = doc && Array.isArray(doc.authorities) ? doc.authorities : [];
  return lista;
}

module.exports = {
  CAMPOS_ASSINADOS,
  canonicalJson,
  sha256,
  construirPayload,
  hashDoPayload,
  verificarEd25519,
  carregarAutoridades,
};
