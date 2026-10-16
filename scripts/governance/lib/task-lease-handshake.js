'use strict';

/**
 * Handshake do worker de lease de TASK — parsing inequívoco.
 *
 * DEFEITO MEDIDO (2026-10-16, selo V2 abortado num passo OBRIGATÓRIO):
 *   `[FAIL] FENCE_AVANCOU — antes=undefined depois=2`
 * O harness `verify-real-task-recovery.js` aceitava como handshake **qualquer
 * linha JSON com `state` string**:
 *   `if (!parsed || typeof parsed.state !== 'string') continue;`
 * O filho (`tests/helpers/taskLeaseWorkerChild.js`) roda o CAMINHO REAL do
 * produto, que também LOGA JSON no stdout. Sob carga, uma linha de LOG com
 * `state` era adotada como handshake, o filho era morto no lugar errado e o
 * verificador seguia com um payload que não tem `taskFence` ⇒ `fenceA=undefined`
 * ⇒ `2 > undefined` é falso ⇒ falha com motivo ENGANOSO ("fence não avançou",
 * quando o fence avançou). O mesmo passo passa isolado — sintoma clássico de
 * corrida dependente de carga.
 *
 * Regra nova:
 *   1. o handshake legítimo é emitido com um MARCADOR único (inequívoco);
 *   2. o caminho legado só aceita objeto que traz `state` E pelo menos um dos
 *      campos exclusivos do handshake (`taskFence` ou `taskLeaseToken`) — um log
 *      genérico deixa de poder se passar por handshake.
 *
 * Sempre: o valor do fence é conferido como número finito por quem consome —
 * comparação com `undefined` nunca mais decide um veredito em silêncio.
 */

const HANDSHAKE_SENTINEL = '__TASK_LEASE_HANDSHAKE__';

/** Campos exclusivos do handshake: sem um deles, não é handshake. */
const CAMPOS_EXCLUSIVOS = ['taskFence', 'taskLeaseToken'];

/** Linha canônica de handshake: marcador + JSON na MESMA linha. */
function formatHandshakeLine(payload) {
  return `${HANDSHAKE_SENTINEL}${JSON.stringify(payload)}\n`;
}

/**
 * @param {string} linha
 * @returns {{ok:boolean, payload:object|null, via:'sentinel'|'legacy'|null, motivo:string|null}}
 */
function parseHandshakeLine(linha) {
  const texto = typeof linha === 'string' ? linha.trim() : '';
  if (!texto) return { ok: false, payload: null, via: null, motivo: 'LINHA_VAZIA' };

  const comMarcador = texto.startsWith(HANDSHAKE_SENTINEL);
  const corpo = comMarcador ? texto.slice(HANDSHAKE_SENTINEL.length) : texto;

  if (!corpo.startsWith('{')) {
    return { ok: false, payload: null, via: null, motivo: 'NAO_E_OBJETO_JSON' };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(corpo);
  } catch (_) {
    return { ok: false, payload: null, via: null, motivo: 'JSON_INVALIDO' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, payload: null, via: null, motivo: 'NAO_E_OBJETO' };
  }

  if (comMarcador) {
    if (typeof parsed.state !== 'string') {
      return { ok: false, payload: null, via: null, motivo: 'MARCADO_SEM_STATE' };
    }
    return { ok: true, payload: parsed, via: 'sentinel', motivo: null };
  }

  // Caminho legado (compatibilidade): exige state + campo exclusivo.
  if (typeof parsed.state !== 'string') {
    return { ok: false, payload: null, via: null, motivo: 'SEM_STATE' };
  }
  const temCampoExclusivo = CAMPOS_EXCLUSIVOS.some((campo) => Object.prototype.hasOwnProperty.call(parsed, campo));
  if (!temCampoExclusivo) {
    return { ok: false, payload: null, via: null, motivo: 'LOG_NAO_E_HANDSHAKE' };
  }
  return { ok: true, payload: parsed, via: 'legacy', motivo: null };
}

/** Fence legível? Número finito — nunca `undefined` decidindo veredito. */
function fenceLegivel(valor) {
  return valor !== null && valor !== undefined && Number.isFinite(Number(valor));
}

module.exports = {
  HANDSHAKE_SENTINEL,
  CAMPOS_EXCLUSIVOS,
  formatHandshakeLine,
  parseHandshakeLine,
  fenceLegivel,
};
