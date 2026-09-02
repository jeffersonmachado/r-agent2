'use strict';

/**
 * Mescla as verticais regeneradas com as declarações manuais do config
 * existente de journey-scenario-links:
 * - vertical inteira com "manual": true é preservada quando a regeneração
 *   não a cobre;
 * - jornada com "manual": true DENTRO de uma vertical regenerada é
 *   preservada quando some dos artefatos (ex.: `calendar`, ligada por
 *   declaração a business-core-cap-scheduling — o mesh não emite journeyId
 *   'calendar', então ela nunca aparece em qa-waves/journey-coverage).
 * - cenário com "manual": true dentro de uma jornada regenerada é mesclado
 *   de volta (ex.: `fitness_customer_checkin` → business-fit-flow-checkin,
 *   ligação HARD-016 que os artefatos gerados não emitem).
 * Jornadas NÃO manuais ausentes da regeneração são removidas (o sync reflete
 * a realidade dos artefatos).
 *
 * Vive em qa/coverage (e não em scripts/) para ser alcançável pelos roots
 * do Jest.
 */
function preserveManualEntries(generatedVerticals, existing) {
  const verticals = generatedVerticals.map((v) => ({
    vertical: v.vertical,
    journeys: [...v.journeys],
  }));
  let journeyCount = verticals.reduce((sum, v) => sum + v.journeys.length, 0);
  let scenarioRefCount = verticals.reduce(
    (sum, v) => sum + v.journeys.reduce((acc, j) => acc + ((j && j.scenarios) || []).length, 0),
    0,
  );

  const existingVerticals = existing && Array.isArray(existing.verticals) ? existing.verticals : [];

  // Jornadas manuais dentro de verticais regeneradas.
  for (const existingVertical of existingVerticals) {
    if (!existingVertical || !Array.isArray(existingVertical.journeys)) continue;
    const target = verticals.find((v) => v.vertical === existingVertical.vertical);
    if (!target) continue;
    for (const journey of existingVertical.journeys) {
      if (!journey || journey.manual !== true || typeof journey.journey !== 'string') continue;
      if (target.journeys.some((j) => j && j.journey === journey.journey)) continue;
      target.journeys.push(journey);
      journeyCount += 1;
      scenarioRefCount += (journey.scenarios || []).length;
    }
  }

  // Cenários com "manual": true dentro de jornadas que TAMBÉM existem na
  // regeneração: sem este merge o sync descartava a ligação manual ao regerar
  // a jornada a partir dos artefatos (regressão observada em
  // fitness_customer_checkin → business-fit-flow-checkin, HARD-016).
  for (const existingVertical of existingVerticals) {
    if (!existingVertical || !Array.isArray(existingVertical.journeys)) continue;
    const target = verticals.find((v) => v.vertical === existingVertical.vertical);
    if (!target) continue;
    for (const journey of existingVertical.journeys) {
      if (!journey || typeof journey.journey !== 'string' || !Array.isArray(journey.scenarios)) continue;
      const targetJourney = target.journeys.find((j) => j && j.journey === journey.journey);
      if (!targetJourney) continue;
      for (const scenario of journey.scenarios) {
        if (!scenario || scenario.manual !== true || typeof scenario.scenarioId !== 'string') continue;
        const already = (targetJourney.scenarios || [])
          .some((item) => item && item.scenarioId === scenario.scenarioId);
        if (already) continue;
        targetJourney.scenarios = [...(targetJourney.scenarios || []), scenario];
        scenarioRefCount += 1;
      }
    }
  }

  // Verticais manuais inteiras (não regeneradas).
  for (const existingVertical of existingVerticals) {
    if (!existingVertical || existingVertical.manual !== true || !Array.isArray(existingVertical.journeys)) continue;
    if (verticals.some((v) => v.vertical === existingVertical.vertical)) continue;
    verticals.push(existingVertical);
    journeyCount += existingVertical.journeys.length;
    scenarioRefCount += existingVertical.journeys.reduce((sum, j) => sum + ((j && j.scenarios) || []).length, 0);
  }

  return { verticals, journeyCount, scenarioRefCount };
}

module.exports = { preserveManualEntries };
