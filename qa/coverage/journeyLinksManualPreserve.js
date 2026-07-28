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
