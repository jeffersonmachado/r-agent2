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
 * PREFIXO `jest` — a lista explícita ACIMA já falhou uma vez, e a falha foi medida.
 *
 * MEDIDO 2026-10-06: um finding do fixture (`E2E_TEST`, título "fixture mathUtils não
 * exporta add()") ficou em `FIXING` com `created_by = 'jest-e2e'`. Como `jest-e2e` NÃO
 * estava na lista, o purge não o removeu; na execução seguinte `registerFinding`
 * DEDUPLICOU por fingerprint e devolveu o finding antigo, e a reprodução tentou
 * `FIXING → SUSPECTED` — transição proibida. O lote 2 do runner autoritativo morreu
 * (`BATCH_REPORT_MISSING`) por causa de um resíduo que o purge deveria ter varrido.
 *
 * A enumeração por nome sempre vai atrás da realidade (cada suíte nova inventa um ator).
 * O prefixo é o critério estável: nenhum ator de PRODUÇÃO se chama `jest*` — as suítes
 * são a única origem possível.
 */
const TEST_ACTOR_PREFIXES = Object.freeze(['jest']);

/**
 * Remove findings (e seus eventos) criados por atores de teste, MAIS os ÓRFÃOS de
 * missão de teste.
 *
 * ÓRFÃO = finding com `mission_id` que não corresponde a nenhuma missão existente. O
 * `afterAll` das suítes destrói as missões que criou, mas os findings do sistema
 * (`SYSTEM:MISSION`, que o purge não pode apagar por ATOR) ficavam apontando para
 * missões já destruídas: inalcançáveis por qualquer missão viva, mas ainda visíveis ao
 * `runBugLoopSweep`, que é GLOBAL e tentava reprocessá-los (medido: 111 resíduos).
 * Nenhuma missão viva os referencia — apagá-los não remove prova de ninguém.
 *
 * @returns {Promise<{removed:number, eventsRemoved:number, orphaned:number, actors:string[]}>}
 */
async function purgeTestFindings({ actors = TEST_ACTORS, prefixes = TEST_ACTOR_PREFIXES } = {}) {
  const models = require('../../api/db/models');
  const Finding = models.EngineeringBugFinding();
  const Event = models.EngineeringBugFindingEvent();
  const Mission = models.EngineeringMission();

  const byActor = await Finding.findAll({ where: { created_by: actors }, attributes: ['id'] });
  const orphanCandidates = await Finding.findAll({
    where: {
      mission_id: { [require('sequelize').Op.ne]: null },
    },
    attributes: ['id', 'mission_id'],
  });
  const missionIds = [...new Set(orphanCandidates.map((row) => row.get('mission_id')).filter(Boolean))];
  const alive = missionIds.length
    ? new Set((await Mission.findAll({ where: { id: missionIds }, attributes: ['id'] })).map((row) => row.get('id')))
    : new Set();
  const orphanIds = orphanCandidates.filter((row) => !alive.has(row.get('mission_id'))).map((row) => row.get('id'));

  // Findings de atores com prefixo de teste (a enumeração por nome sempre atrasa).
  const prefixed = prefixes.length
    ? await Finding.findAll({
      where: {
        [require('sequelize').Op.or]: prefixes.map((prefix) => ({
          created_by: { [require('sequelize').Op.like]: `${prefix}%` },
        })),
      },
      attributes: ['id'],
    })
    : [];

  const ids = [...new Set([
    ...byActor.map((row) => row.get('id')),
    ...prefixed.map((row) => row.get('id')),
    ...orphanIds,
  ])];
  if (ids.length === 0) return { removed: 0, eventsRemoved: 0, orphaned: 0, actors: [...actors] };

  // LOTES + FAIL-LOUD. O código anterior fazia UM destroy de eventos com `.catch(() => 0)`,
  // que ENGOLIA a falha: com eventos demais a deleção não acontecia, o destroy dos findings
  // estourava a FK e o helper parecia ter rodado. Um purge que falha em silêncio é pior que
  // não existir — ele deixa o resíduo exatamente onde o próximo lote vai tropeçar (medido:
  // 41.632 eventos acumulados).
  const CHUNK = 400;
  let eventsRemoved = 0;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    eventsRemoved += await Event.destroy({ where: { finding_id: slice } });
    removed += await Finding.destroy({ where: { id: slice } });
  }
  return { removed, eventsRemoved, orphaned: orphanIds.length, actors: [...actors] };
}

module.exports = { purgeTestFindings, TEST_ACTORS, TEST_ACTOR_PREFIXES };
