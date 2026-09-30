'use strict';

/**
 * tests/helpers/purgeTestFindings.js — PURGE DE FINDINGS DE TESTE.
 *
 * DEFEITO REAL medido em 2026-09-30: depois de uma execução de suíte INTERROMPIDA (timeout/kill), o
 * `afterAll` não roda e os findings ficam no banco. Como a varredura do laço (`runBugLoopSweep`) é
 * GLOBAL por natureza — ela existe para encontrar TODO bug pendente —, 94 findings residuais de
 * teste fizeram o sweep tentar reproduzir cada um (execuções reais), e uma suíte que levava 26s
 * passou a estourar 60s. Poluição de teste degradando o próprio mecanismo que está sendo testado.
 *
 * Este helper apaga findings criados por ATORES DE TESTE conhecidos. É deliberadamente restrito:
 *   - só atores da lista explícita (nunca "tudo que parece teste");
 *   - nunca toca findings de produção (`SYSTEM:MISSION`, `SYSTEM:TELEMETRY`, humanos).
 *
 * As suítes do laço NÃO podem rodar em paralelo entre si (o runner E2E é compartilhado), então o
 * purge em `beforeAll`/`afterAll` é seguro: nenhuma suíte ativa perde dado que ainda vai usar.
 */

const TEST_ACTORS = Object.freeze([
  'jest-review',
  'jest-natural',
  'jest-bug-loop',
  'TEST',
  'PROOF',
  'CONCURRENT',
]);

/**
 * Remove findings (e seus eventos) criados por atores de teste.
 *
 * @returns {Promise<{removed:number, eventsRemoved:number, actors:string[]}>}
 */
async function purgeTestFindings({ actors = TEST_ACTORS } = {}) {
  const models = require('../../api/db/models');
  const Finding = models.EngineeringBugFinding();
  const Event = models.EngineeringBugFindingEvent();

  const rows = await Finding.findAll({ where: { created_by: actors }, attributes: ['id'] });
  const ids = rows.map((row) => row.get('id'));
  if (ids.length === 0) return { removed: 0, eventsRemoved: 0, actors: [...actors] };

  const eventsRemoved = await Event.destroy({ where: { finding_id: ids } }).catch(() => 0);
  const removed = await Finding.destroy({ where: { id: ids } });
  return { removed, eventsRemoved, actors: [...actors] };
}

module.exports = { purgeTestFindings, TEST_ACTORS };
