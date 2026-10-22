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

/**
 * Âncora EXTERNA da chave de fechamento (operador/CI, NUNCA versionada).
 * 2ª passada do revisor: era OPCIONAL — logo o pin em código virava raiz de confiança e o
 * atacante que reescreve a árvore reescrevia o pin. Agora é OBRIGATÓRIA: sem ela não há
 * âncora e a certificação permanece bloqueada.
 */
function ancoraExterna() {
  const valor = String(process.env.RAP_CLOSURE_TRUST_ANCHOR_SHA256 || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(valor) ? valor : null;
}

/**
 * Pins das chaves de APROVAÇÃO HUMANA (missões/readiness). Separados dos de fechamento:
 * quem fecha defeito não é necessariamente quem aprova a missão.
 */
const PINNED_APPROVAL_FINGERPRINTS = Object.freeze([]);

/**
 * Âncora externa da chave de aprovação. Mesmo achado do Alert 1, aplicado ao gate de
 * readiness: validar a assinatura contra um registro JSON editável não prova autoria.
 */
function ancoraDeAprovacao() {
  const valor = String(process.env.RAP_APPROVAL_TRUST_ANCHOR_SHA256 || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(valor) ? valor : null;
}

/** A chave de aprovação está ancorada (pin versionado + âncora externa)? */
function chaveDeAprovacaoAncorada(publicKeyPem, opcoes = {}) {
  const ambienteDeTeste = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  const pinsDoChamador = ambienteDeTeste && Array.isArray(opcoes.pins) ? opcoes.pins : null;
  return chaveAncorada(publicKeyPem, {
    pins: pinsDoChamador || PINNED_APPROVAL_FINGERPRINTS,
    externa: opcoes.externa !== undefined ? opcoes.externa : ancoraDeAprovacao(),
  });
}

/**
 * Âncora EXTERNA do INVENTÁRIO (membership). Fecha o achado "apagar itens libera o selo":
 * o digest do inventário é comparado com um valor que vive FORA da árvore.
 */
function ancoraDoInventario() {
  const valor = String(process.env.RAP_CLOSURE_INVENTORY_SHA256 || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(valor) ? valor : null;
}

/**
 * Digest canônico do inventário: identidade + severidade + estado de cada item, ordenado.
 * Remover, renomear, rebaixar severidade ou "fechar" item muda o digest.
 */
function digestDoInventario(itens) {
  const { canonicalJson, sha256 } = require('../risk-acceptance/signature');
  const triplas = (Array.isArray(itens) ? itens : [])
    .map((i) => [String((i && i.id) || ''), String((i && i.severity) || '').toUpperCase(), String((i && i.state) || '').toUpperCase()])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(canonicalJson(triplas));
}

/**
 * A chave está ancorada?
 * @param {string} publicKeyPem
 * @param {object} [opcoes] { pins?: string[], externa?: string|null }
 * @returns {{ok:boolean, motivo:string|null, fingerprint:string|null}}
 */
function chaveAncorada(publicKeyPem, opcoes = {}) {
  // Pins vindos do CHAMADOR só valem em contexto de teste. Em execução real a raiz é
  // SEMPRE o código versionado — senão o mesmo ator que edita o JSON poderia passar a
  // própria lista de pins de dentro de um script.
  const ambienteDeTeste = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  const pinsDoChamador = ambienteDeTeste && Array.isArray(opcoes.pins) ? opcoes.pins : null;
  const pins = pinsDoChamador || PINNED_AUTHORITY_FINGERPRINTS;
  const externa = opcoes.externa !== undefined ? opcoes.externa : ancoraExterna();
  const fingerprint = fingerprintDaChavePem(publicKeyPem);
  if (!fingerprint) return { ok: false, motivo: 'CHAVE_PUBLICA_ILEGIVEL', fingerprint: null };
  if (!externa) return { ok: false, motivo: 'SEM_ANCORA_EXTERNA', fingerprint };
  if (pins.length === 0) return { ok: false, motivo: 'SEM_PIN_VERSIONADO', fingerprint };
  if (!pins.map((p) => String(p).toLowerCase()).includes(fingerprint)) {
    return { ok: false, motivo: 'FINGERPRINT_NAO_PINADO', fingerprint };
  }
  if (externa !== fingerprint) {
    return { ok: false, motivo: 'ANCORA_EXTERNA_DIVERGENTE', fingerprint };
  }
  return { ok: true, motivo: null, fingerprint };
}

module.exports = {
  PINNED_AUTHORITY_FINGERPRINTS,
  PINNED_APPROVAL_FINGERPRINTS,
  ancoraDeAprovacao,
  chaveDeAprovacaoAncorada,
  fingerprintDaChavePem,
  ancoraExterna,
  ancoraDoInventario,
  digestDoInventario,
  chaveAncorada,
};
