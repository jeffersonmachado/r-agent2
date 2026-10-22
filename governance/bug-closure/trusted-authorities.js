'use strict';

/**
 * governance/bug-closure/trusted-authorities.js — ÂNCORA DE CONFIANÇA FORA DO JSON.
 *
 * ACHADO DO REVISOR INDEPENDENTE (2026-10-22, Alert 1 — P0): a primeira versão da prova de
 * fechamento lia a chave pública da autoridade de `governance/risk-acceptance/authorities.json`
 * — um JSON comum, gravável pelo MESMO ator que edita a fila de defeitos. O atacante registrava
 * a própria chave, assinava a própria prova e fechava um P0 sem executar teste algum. A frase
 * "o agente não possui a chave privada" era falsa: ele gera a dele.
 *
 * Correção — o registro de autoridades deixa de ser autoridade por si só. A chave só é aceita se
 * a IMPRESSÃO (sha256 da chave pública em DER/SPKI) estiver PINADA em código versionado, e:
 *
 *   - pinar em código é um ato visível: aparece no diff e altera o `sourceFingerprint`, que a
 *     própria prova assina — logo, editar o pin invalida todas as provas existentes;
 *   - quando o operador/CI fornece `RAP_CLOSURE_TRUST_ANCHOR_SHA256` (âncora EXTERNA à árvore),
 *     o pin tem de casar com ela. Sem âncora externa e sem pin, NÃO há âncora de confiança e a
 *     certificação permanece bloqueada (missão §5: sem âncora confiável, o veredito é bloqueado).
 *
 * Estado medido do repositório em 2026-10-22: `PINNED_AUTHORITY_FINGERPRINTS = []` e nenhuma
 * âncora externa configurada ⇒ `SEM_ANCORA_DE_CONFIANCA`. Isso é DECLARADO, não contornado: o
 * dono precisa registrar a chave pública (e o fingerprint pinado + âncora externa) para que
 * fechamentos passem a ser certificáveis.
 */

const crypto = require('crypto');

/**
 * Impressões SHA-256 (hex) das chaves públicas autorizadas a FECHAR defeito.
 * Vazio = nenhuma autoridade reconhecida ⇒ certificação bloqueada.
 * Para registrar: `node -e "console.log(require('./governance/bug-closure/trusted-authorities').fingerprintDaChavePem(require('fs').readFileSync('autoridade.pub','utf8')))"`
 */
const PINNED_AUTHORITY_FINGERPRINTS = Object.freeze([]);

/** Normaliza a PEM e devolve sha256 do DER (SPKI) — estável a espaços/quebras de linha. */
function fingerprintDaChavePem(publicKeyPem) {
  try {
    const chave = crypto.createPublicKey(String(publicKeyPem));
    const der = chave.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
  } catch (_) {
    return null;
  }
}

/** Âncora EXTERNA opcional (fornecida pelo operador/CI, nunca versionada). */
function ancoraExterna() {
  const valor = String(process.env.RAP_CLOSURE_TRUST_ANCHOR_SHA256 || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(valor) ? valor : null;
}

/**
 * A chave está ancorada?
 * @param {string} publicKeyPem
 * @param {object} [opcoes] { pins?: string[], externa?: string|null }
 * @returns {{ok:boolean, motivo:string|null, fingerprint:string|null}}
 */
function chaveAncorada(publicKeyPem, opcoes = {}) {
  const pins = Array.isArray(opcoes.pins) ? opcoes.pins : PINNED_AUTHORITY_FINGERPRINTS;
  const externa = opcoes.externa !== undefined ? opcoes.externa : ancoraExterna();
  const fingerprint = fingerprintDaChavePem(publicKeyPem);
  if (!fingerprint) return { ok: false, motivo: 'CHAVE_PUBLICA_ILEGIVEL', fingerprint: null };
  if (pins.length === 0) return { ok: false, motivo: 'SEM_PIN_VERSIONADO', fingerprint };
  if (!pins.map((p) => String(p).toLowerCase()).includes(fingerprint)) {
    return { ok: false, motivo: 'FINGERPRINT_NAO_PINADO', fingerprint };
  }
  if (externa && externa !== fingerprint) {
    return { ok: false, motivo: 'ANCORA_EXTERNA_DIVERGENTE', fingerprint };
  }
  return { ok: true, motivo: null, fingerprint };
}

module.exports = {
  PINNED_AUTHORITY_FINGERPRINTS,
  fingerprintDaChavePem,
  ancoraExterna,
  chaveAncorada,
};
