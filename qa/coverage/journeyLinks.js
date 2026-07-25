'use strict';

/**
 * Journey Links — ligação precisa jornada ↔ cenários do mesh.
 *
 * Módulo puro (sem I/O): recebe estruturas já carregadas e devolve ligações.
 * Consumido por `coverageGate.js` (motor) e por
 * `scripts/governance/validate-coverage-gate.js` (CLI, que faz o I/O).
 *
 * Fontes de ligação (todas versionadas no repositório):
 *
 * a) `config/journey-scenario-links.json` (source 'journey-coverage'):
 *    declaração versionada jornada → cenários (sincronizada a partir de
 *    qa-waves/journey-coverage/*.json via `npm run coverage-gate:links` —
 *    os arquivos verticais são artefatos do platform-readiness, reescritos
 *    em runtime, e por isso não são lidos diretamente pelo gate). Cenários
 *    com status ligável (`active` ou `approved` — `deprecated`
 *    nunca liga) cujo id EXISTE no meshRegistry. O id da jornada é o campo
 *    `journey` de cada entrada da vertical.
 *
 * b) Convenção de nome (source 'scenario-name'): para uma jornada presente
 *    num arquivo vertical de vertical V, cenários do mesh cujo id contém o
 *    id da jornada como TOKEN delimitado por `-` ou `_` (ex.:
 *    `fitness-matricula-checkin` contém o token `checkin`;
 *    `fitness-matricula-agendamento-ui` contém `agendamento`). O token nunca
 *    casa dentro de uma palavra maior: `checkin` não casa em `x-checkins`.
 *    O domínio do cenário correspondente à vertical V é tratado como
 *    PREFERÊNCIA, não requisito: quando há candidatos no domínio preferido,
 *    só eles ligam; quando não há (ex.: `fitness-matricula-leads`, que vive
 *    no domínio `omnichannel`), os demais candidatos ligam mesmo assim.
 *    Correspondência vertical ↔ domínio passa pelos aliases
 *    (vertical `clinic` ↔ domínio `clinica`).
 *
 * Precedência: quando (a) produz links para a jornada, o resultado é a UNIÃO
 * de (a) e (b) com source 'journey-coverage'; caso contrário, usa-se (b) com
 * source 'scenario-name'. Jornada sem nenhum link não aparece no resultado.
 *
 * Aliases de domínio (`resolveDomainAliases`): mapa alias → canônico lido de
 * `config/qa-waves-registry.json` (`domainAliases`, ex.: `servicos` →
 * `services`, `clinica` → `clinic`, `varejo`/`ecommerce` → `market`).
 * `journeyMatchesDomain` normaliza o domínio para o canônico antes do
 * `includes`: `'market_default_journey'.includes('mercado')` é false, mas
 * `'clinic_default_journey'.includes(canon('clinica')='clinic')` é true.
 * Também casa quando a jornada contém qualquer alias do mesmo grupo
 * canônico do domínio.
 */

/** Status de cenário (nos arquivos verticais) que podem gerar link direto. */
const LINKABLE_SCENARIO_STATUSES = Object.freeze(['active', 'approved']);

/** token como segmento delimitado por `-`/`_` (início/fim contam como borda). */
function containsToken(id, token) {
  if (typeof id !== 'string' || typeof token !== 'string' || token.length === 0) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[-_])${escaped}($|[-_])`).test(id);
}

/**
 * Mapa alias → canônico a partir da config do QA Waves registry
 * (`config/qa-waves-registry.json`). Entrada ausente/inválida → {}.
 */
function resolveDomainAliases(registryConfig) {
  const aliases = (registryConfig && registryConfig.domainAliases) || {};
  return { ...aliases };
}

/** Domínio canônico: aliases[domain] quando existe; senão o próprio domínio. */
function canonicalDomain(domain, aliases) {
  return (aliases && aliases[domain]) || domain;
}

/**
 * Jornada está ligada a um domínio quando o id contém o domínio, o canônico
 * do domínio (via aliases) ou qualquer alias do mesmo grupo canônico.
 * Sem `aliases` o comportamento é o original: `journeyId.includes(domain)`.
 */
function journeyMatchesDomain(journeyId, domain, aliases) {
  if (typeof journeyId !== 'string' || typeof domain !== 'string' || domain.length === 0) {
    return false;
  }
  const canonical = canonicalDomain(domain, aliases);
  if (journeyId.includes(domain) || journeyId.includes(canonical)) return true;
  for (const [alias, target] of Object.entries(aliases || {})) {
    if (target === canonical && journeyId.includes(alias)) return true;
  }
  return false;
}

/** Normaliza entrada de cenário do mesh: string id ou { id, domain }. */
function normalizeMeshScenario(entry) {
  if (typeof entry === 'string') return { id: entry, domain: undefined };
  if (entry && typeof entry.id === 'string') return { id: entry.id, domain: entry.domain };
  return null;
}

/** Domínio do cenário corresponde à vertical (via aliases em ambos os lados). */
function domainMatchesVertical(domain, vertical, aliases) {
  if (typeof domain !== 'string' || typeof vertical !== 'string') return false;
  return canonicalDomain(domain, aliases) === canonicalDomain(vertical, aliases);
}

/**
 * Monta as ligações jornada → cenários do mesh.
 *
 * @param {object} input
 * @param {object[]} input.journeyCoverageFiles conteúdo parseado de
 *   `qa-waves/journey-coverage/*.json` ({ vertical, journeys: [{ journey,
 *   scenarios: [{ scenarioId, status }] }] }).
 * @param {Array<string|{id:string,domain:string}>} input.meshScenarioIds
 *   cenários do meshRegistry; objetos com `domain` habilitam a preferência
 *   de domínio na convenção de nome.
 * @param {object} [input.aliases] mapa alias → canônico
 *   (ver `resolveDomainAliases`).
 * @returns {Object<string, {scenarioIds: string[], source: string}>}
 */
function buildJourneyScenarioLinks({ journeyCoverageFiles = [], meshScenarioIds = [], aliases = {} } = {}) {
  const mesh = (meshScenarioIds || []).map(normalizeMeshScenario).filter(Boolean);
  const meshIds = new Set(mesh.map((scenario) => scenario.id));
  const linkableStatuses = new Set(LINKABLE_SCENARIO_STATUSES);

  const links = {};

  function merge(journeyId, scenarioIds, source) {
    const existing = links[journeyId];
    const combined = existing ? [...existing.scenarioIds] : [];
    for (const id of scenarioIds) {
      if (!combined.includes(id)) combined.push(id);
    }
    links[journeyId] = {
      scenarioIds: combined,
      // 'journey-coverage' (link direto por arquivo vertical) prevalece.
      source: (existing && existing.source === 'journey-coverage') || source === 'journey-coverage'
        ? 'journey-coverage'
        : 'scenario-name',
    };
  }

  for (const file of journeyCoverageFiles || []) {
    if (!file || !Array.isArray(file.journeys)) continue;
    for (const entry of file.journeys) {
      if (!entry || typeof entry.journey !== 'string' || entry.journey.length === 0) continue;
      const journeyId = entry.journey;

      // (a) Link direto: cenário ligável (active/approved) presente no mesh.
      const direct = (entry.scenarios || [])
        .filter((scenario) => scenario
          && linkableStatuses.has(scenario.status)
          && meshIds.has(scenario.scenarioId))
        .map((scenario) => scenario.scenarioId);

      // (b) Convenção de nome: id da jornada como token no id do cenário.
      const candidates = mesh.filter((scenario) => containsToken(scenario.id, journeyId));
      const preferred = candidates.filter((scenario) => domainMatchesVertical(scenario.domain, file.vertical, aliases));
      const byName = (preferred.length > 0 ? preferred : candidates).map((scenario) => scenario.id);

      if (direct.length > 0) {
        merge(journeyId, [...direct, ...byName], 'journey-coverage');
      } else if (byName.length > 0) {
        merge(journeyId, byName, 'scenario-name');
      }
    }
  }

  return links;
}

module.exports = {
  LINKABLE_SCENARIO_STATUSES,
  containsToken,
  resolveDomainAliases,
  canonicalDomain,
  journeyMatchesDomain,
  buildJourneyScenarioLinks,
};
