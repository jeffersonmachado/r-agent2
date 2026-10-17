'use strict';

/**
 * Pendências de missão e governança (leitura) para a superfície de engenharia.
 *
 * Fontes:
 *   1. fila oficial de missão (`AI_MEMORY/hardening-queue.json`) — a ÚNICA fonte
 *      de verdade sobre "o que ainda falta";
 *   2. waivers de risco aguardando aprovação (nada é isentado até a aprovação de
 *      OUTRO ator);
 *   3. bloqueios de release com decisão diferente de GO.
 *
 * Postura de honestidade: fonte ausente é declarada em `sourceUnavailable` e NÃO
 * vira item inventado. Uma lista de pendências que preenche tela com item falso é
 * pior que uma lista vazia com a razão escrita.
 */

const fs = require('fs');
const path = require('path');

const logger = require('../../utils/logger');
const { buildPendencies, filterPendencies } = require('../../../engine/governance/pendenciesModel');
const { collectReleaseBlockers, DEFAULT_ROOT } = require('./releaseStateService');

const QUEUE_RELATIVE = path.resolve('AI_MEMORY', 'hardening-queue.json');

function queuePath(rootDir) {
  return path.join(rootDir, QUEUE_RELATIVE);
}

/**
 * Lê a fila oficial. Ausente/ilegível é resultado EXPLÍCITO (`unavailable`), não
 * lista vazia silenciosa: a tela precisa poder dizer "não consegui ler a fila".
 */
function readQueue(rootDir = DEFAULT_ROOT) {
  const abs = queuePath(rootDir);
  try {
    if (!fs.existsSync(abs)) return { items: [], unavailable: `${QUEUE_RELATIVE} ausente` };
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return { items, unavailable: null };
  } catch (error) {
    logger.warn(`[dev-governance] fila de missão ilegível: ${error.message}`);
    return { items: [], unavailable: `${QUEUE_RELATIVE} ilegível: ${error.message}` };
  }
}

async function readWaivers({ tenantKey = 'system' } = {}) {
  try {
    const { listWaivers } = require('../securityIntel/waiverService');
    const result = await listWaivers({ tenantKey, state: 'ALL', limit: 500 });
    return { items: Array.isArray(result.items) ? result.items : [], unavailable: null };
  } catch (error) {
    logger.warn(`[dev-governance] waivers indisponíveis: ${error.message}`);
    return { items: [], unavailable: `waivers indisponíveis: ${error.message}` };
  }
}

/**
 * @param {object} input
 * @param {string} [input.tenantKey]
 * @param {boolean} [input.onlyPending] lista SÓ o que exige ação humana agora
 * @param {string} [input.rootDir]
 */
async function getPendencies({ tenantKey = 'system', onlyPending = false, rootDir = DEFAULT_ROOT } = {}) {
  const queue = readQueue(rootDir);
  const waivers = await readWaivers({ tenantKey });
  const { blockers, unavailable: releaseUnavailable } = collectReleaseBlockers(rootDir);

  const sourceUnavailable = [];
  if (queue.unavailable) sourceUnavailable.push(queue.unavailable);
  if (waivers.unavailable) sourceUnavailable.push(waivers.unavailable);
  for (const missing of releaseUnavailable) {
    sourceUnavailable.push(`${missing.path}: ${missing.reason}`);
  }

  const pendencies = buildPendencies({
    queueItems: queue.items,
    waivers: waivers.items,
    releaseBlockers: blockers,
    sourceUnavailable,
    // O instante é do SERVIÇO (o engine é puro e não cria relógio).
    now: new Date(),
  });

  return filterPendencies(pendencies, { onlyPending: onlyPending === true });
}

module.exports = {
  QUEUE_RELATIVE,
  queuePath,
  readQueue,
  readWaivers,
  getPendencies,
};
