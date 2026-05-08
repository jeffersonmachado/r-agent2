'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const SCENARIO_STORE_PATH = path.join(ROOT_DIR, 'qa', 'qa-waves', 'scenario-store.json');

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function loadScenarioStore() {
  const payload = readJsonSafe(SCENARIO_STORE_PATH, { scenarios: [] });
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.scenarios) ? payload.scenarios : [];
}

function capabilityCoverage(capability, context) {
  const id = capability.id;
  const backend = context.discovery?.backend || {};
  const frontend = context.discovery?.frontend || {};
  const devices = context.discovery?.devices || {};
  const channels = context.discovery?.omnichannel || {};
  const replayStatus = context.discovery?.replay?.replayStatusByCapability?.[id] || {};

  const scenarioStore = context.scenarios || [];
  const e2eCapabilities = new Set((context.discovery?.e2e?.inferredCapabilities || []).map((item) => item.id));

  const implementedBackend = (backend.inferredCapabilities || []).some((item) => item.id === id);
  const implementedFrontend = (frontend.inferredCapabilities || []).some((item) => item.id === id);

  const deviceMatched = Boolean(
    devices[id]?.detected
    || devices[id.replace(/_/g, '-')]?.detected
    || channels[id]?.detected
  );

  const implemented = implementedBackend || implementedFrontend || deviceMatched;
  const replayed = Boolean(replayStatus.replayed);
  const validated = e2eCapabilities.has(id);

  const dependencyConfig = context.dependencies?.[id] || { dependsOn: [] };
  const deps = Array.isArray(dependencyConfig.dependsOn) ? dependencyConfig.dependsOn : [];
  const depMissing = deps.filter((depId) => !context.capabilityIds.has(depId));

  const policy = context.policy || {};
  const isCritical = capability.required === true || (capability.tags || []).includes('critical');
  const requireTraceForCritical = policy.requireTraceForCritical !== false;
  const requireScreenshotsForCritical = policy.requireScreenshotsForCritical !== false;
  const requireFreshReplay = Number(policy.requireFreshReplayDays || 7) > 0;

  const hasOperationalReplay = replayed && Boolean(replayStatus.operationalEvidence);
  const hasScreenshots = Boolean(replayStatus.hasScreenshots);
  const hasTrace = Boolean(replayStatus.hasTrace);
  const hasFreshReplay = replayed && (replayStatus.hasFreshReplay !== false);

  const criticalScreenshotsSatisfied = !isCritical || !requireScreenshotsForCritical || hasScreenshots;
  const criticalTraceSatisfied = !isCritical || !requireTraceForCritical || hasTrace;
  const freshReplaySatisfied = !requireFreshReplay || hasFreshReplay;

  const hasEvidence = hasOperationalReplay && criticalScreenshotsSatisfied && criticalTraceSatisfied;
  const operationallyVerified = implemented
    && validated
    && hasEvidence
    && freshReplaySatisfied
    && depMissing.length === 0;

  const scenarioLinked = scenarioStore.filter((scenario) => {
    const text = JSON.stringify(scenario || {}).toLowerCase();
    return text.includes(id.toLowerCase()) || (capability.tags || []).some((tag) => text.includes(String(tag).toLowerCase()));
  }).length;

  return {
    implemented,
    replayed,
    validated,
    operationallyVerified,
    implementation: {
      backend: implementedBackend,
      frontend: implementedFrontend,
      deviceOrChannel: deviceMatched,
    },
    replay: {
      replayed,
      hasScreenshots,
      hasTrace,
      operationalEvidence: Boolean(replayStatus.operationalEvidence),
      hasFreshReplay,
      latestFinishedAt: replayStatus.latestFinishedAt || null,
      replayCount: Number(replayStatus.replayCount || 0),
    },
    critical: {
      isCritical,
      traceRequired: isCritical && requireTraceForCritical,
      screenshotsRequired: isCritical && requireScreenshotsForCritical,
      traceSatisfied: criticalTraceSatisfied,
      screenshotsSatisfied: criticalScreenshotsSatisfied,
      freshReplayRequired: requireFreshReplay,
      freshReplaySatisfied,
    },
    e2e: {
      validated,
      linkedScenarios: scenarioLinked,
    },
    dependencies: {
      required: deps,
      missing: depMissing,
      valid: depMissing.length === 0,
    },
  };
}

function detectUxGaps(discovery) {
  const uxSignals = discovery?.e2e?.uxSignals || {};
  const gaps = [];
  if (Number(uxSignals.loadingChecks || 0) === 0) {
    gaps.push({ type: 'ux_loading', message: 'Nao ha validacoes de loading/spinner em E2E.' });
  }
  if (Number(uxSignals.timeoutChecks || 0) === 0) {
    gaps.push({ type: 'ux_timeout', message: 'Nao ha validacoes de timeout/espera em E2E.' });
  }
  if (Number(uxSignals.visualErrorChecks || 0) === 0) {
    gaps.push({ type: 'ux_visual_error', message: 'Nao ha validacoes de erro visual/tela vazia em E2E.' });
  }
  return gaps;
}

function buildAutoGenerationSuggestions(capability, coverage) {
  const suggestions = [];

  if (!coverage.implemented) {
    suggestions.push({
      type: 'scenario',
      capability: capability.id,
      message: `Criar cenario operacional para capability ${capability.id}.`,
    });
  }

  if (!coverage.validated) {
    suggestions.push({
      type: 'e2e',
      capability: capability.id,
      message: `Adicionar E2E com uiSteps e validacao de ${capability.id}.`,
    });
  }

  if (!coverage.replay.replayed) {
    suggestions.push({
      type: 'replay',
      capability: capability.id,
      message: `Gerar replay operacional com screenshot, trace e jornada completa para ${capability.id}.`,
    });
  }

  if (!coverage.replay.hasScreenshots || !coverage.replay.operationalEvidence) {
    suggestions.push({
      type: 'validators',
      capability: capability.id,
      message: `Incluir validators/evidencias reais (screenshots + operacao real) para ${capability.id}.`,
    });
  }

  return suggestions;
}

function evaluateOperationalGoNoGo(capabilitiesCoverage, requiredCapabilities, policy = {}, runtime = {}) {
  const blockers = [];

  for (const capabilityId of requiredCapabilities) {
    const coverage = capabilitiesCoverage[capabilityId];
    if (!coverage) {
      blockers.push({ capability: capabilityId, reason: 'capability_nao_descoberta' });
      continue;
    }
    if (!coverage.implemented) blockers.push({ capability: capabilityId, reason: 'capability_sem_implementacao' });
    if (!coverage.validated) blockers.push({ capability: capabilityId, reason: 'capability_sem_e2e' });
    if (!coverage.replay.replayed) blockers.push({ capability: capabilityId, reason: 'capability_sem_replay' });
    if (!coverage.replay.hasScreenshots) blockers.push({ capability: capabilityId, reason: 'capability_sem_screenshots' });
    if (coverage.critical?.traceRequired && !coverage.replay.hasTrace) {
      blockers.push({ capability: capabilityId, reason: 'capability_critica_sem_trace' });
    }
    if (coverage.critical?.freshReplayRequired && !coverage.replay.hasFreshReplay) {
      blockers.push({ capability: capabilityId, reason: 'capability_replay_desatualizado' });
    }
    if (!coverage.operationallyVerified) blockers.push({ capability: capabilityId, reason: 'capability_sem_validacao_operacional' });
    if (!coverage.dependencies.valid) blockers.push({ capability: capabilityId, reason: 'dependencias_invalidas' });
  }

  if (runtime.skipDetected === true) {
    blockers.push({ capability: '*', reason: 'skip_detected' });
  }
  if (runtime.replayMissing === true) {
    blockers.push({ capability: '*', reason: 'replay_absente' });
  }
  if (runtime.fakeSelectorDetected === true) {
    blockers.push({ capability: '*', reason: 'selector_ficticio_detectado' });
  }
  if (runtime.missingOperationalConsequence === true) {
    blockers.push({ capability: '*', reason: 'consequencia_operacional_ausente' });
  }
  if (runtime.transitionNeverValidated === true) {
    blockers.push({ capability: '*', reason: 'transition_nunca_validada' });
  }
  if (runtime.stateNeverReached === true) {
    blockers.push({ capability: '*', reason: 'estado_nunca_alcancado' });
  }
  if (runtime.sideEffectNeverValidated === true) {
    blockers.push({ capability: '*', reason: 'side_effect_nunca_validado' });
  }
  if (runtime.clickWithoutConsequence === true) {
    blockers.push({ capability: '*', reason: 'click_sem_consequencia_operacional' });
  }

  const coverage = {
    implementedCoverage: 0,
    e2eCoverage: 0,
    replayCoverage: 0,
    operationalCoverage: 0,
    consequenceCoverage: 0,
    transitionCoverage: 0,
    stateValidationCoverage: 0,
    sideEffectCoverage: 0,
    operationalConsequenceCoverage: 0,
  };
  const capabilities = Object.values(capabilitiesCoverage || {});
  const total = Math.max(1, capabilities.length);
  coverage.implementedCoverage = Math.round((capabilities.filter((item) => item.implemented).length / total) * 100);
  coverage.e2eCoverage = Math.round((capabilities.filter((item) => item.validated).length / total) * 100);
  coverage.replayCoverage = Math.round((capabilities.filter((item) => item.replay?.replayed).length / total) * 100);
  coverage.operationalCoverage = Math.round((capabilities.filter((item) => item.operationallyVerified).length / total) * 100);
  coverage.consequenceCoverage = Number.isFinite(Number(runtime.consequenceCoverage))
    ? Number(runtime.consequenceCoverage)
    : coverage.operationalCoverage;
  coverage.transitionCoverage = Number.isFinite(Number(runtime.transitionCoverage))
    ? Number(runtime.transitionCoverage)
    : coverage.operationalCoverage;
  coverage.stateValidationCoverage = Number.isFinite(Number(runtime.stateValidationCoverage))
    ? Number(runtime.stateValidationCoverage)
    : coverage.operationalCoverage;
  coverage.sideEffectCoverage = Number.isFinite(Number(runtime.sideEffectCoverage))
    ? Number(runtime.sideEffectCoverage)
    : coverage.operationalCoverage;
  coverage.operationalConsequenceCoverage = Number.isFinite(Number(runtime.operationalConsequenceCoverage))
    ? Number(runtime.operationalConsequenceCoverage)
    : Math.round(
      Math.max(
        0,
        Math.min(
          100,
          (coverage.transitionCoverage * 0.2)
          + (coverage.stateValidationCoverage * 0.3)
          + (coverage.sideEffectCoverage * 0.5)
        )
      )
    );

  const operationalGateOpen = coverage.operationalCoverage > 0
    && coverage.consequenceCoverage > 0
    && coverage.transitionCoverage > 0
    && coverage.stateValidationCoverage > 0
    && coverage.sideEffectCoverage > 0
    && coverage.operationalConsequenceCoverage > 0;

  return {
    goNoGo: blockers.length === 0 && operationalGateOpen ? 'GO' : 'NO_GO',
    blockers,
    policy,
    coverage,
    operationalGateOpen,
  };
}

function detectGaps(options = {}) {
  const discovery = options.discovery || {};
  const capabilities = Array.isArray(options.capabilities) ? options.capabilities : [];
  const dependencies = options.dependencies || {};
  const journeyContracts = options.journeyContracts || {};

  const scenarios = loadScenarioStore();
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));

  const policy = {
    requireTraceForCritical: options.policy?.requireTraceForCritical !== false,
    requireScreenshotsForCritical: options.policy?.requireScreenshotsForCritical !== false,
    requireFreshReplayDays: Number(options.policy?.requireFreshReplayDays || 7),
  };

  const context = {
    discovery,
    dependencies,
    scenarios,
    capabilityIds,
    policy,
  };

  const capabilitiesCoverage = {};
  const implementationGaps = [];
  const e2eGaps = [];
  const replayGaps = [];
  const operationalGaps = [];
  const autoGeneration = [];
  const stateBasedGaps = [];

  for (const capability of capabilities) {
    const coverage = capabilityCoverage(capability, context);
    capabilitiesCoverage[capability.id] = coverage;

    if (!coverage.implemented) {
      implementationGaps.push({ capability: capability.id, gap: 'sem_implementacao_real' });
    }
    if (!coverage.validated) {
      e2eGaps.push({ capability: capability.id, gap: 'sem_e2e' });
    }
    if (!coverage.replay.replayed || !coverage.replay.hasScreenshots || !coverage.replay.operationalEvidence) {
      replayGaps.push({
        capability: capability.id,
        gap: 'sem_replay_operacional',
        details: coverage.replay,
      });
    }
    if (!coverage.operationallyVerified) {
      operationalGaps.push({
        capability: capability.id,
        gap: 'nao_verificada_operacionalmente',
        details: coverage,
      });
    }

    autoGeneration.push(...buildAutoGenerationSuggestions(capability, coverage));
  }

  const uxGaps = detectUxGaps(discovery);

  if (options.runtime?.transitionNeverValidated === true) {
    stateBasedGaps.push({ gap: 'transition_nunca_validada', details: options.runtime });
  }
  if (options.runtime?.stateNeverReached === true) {
    stateBasedGaps.push({ gap: 'estado_nunca_alcancado', details: options.runtime });
  }
  if (options.runtime?.sideEffectNeverValidated === true) {
    stateBasedGaps.push({ gap: 'side_effect_nunca_validado', details: options.runtime });
  }
  if (options.runtime?.clickWithoutConsequence === true) {
    stateBasedGaps.push({ gap: 'click_sem_consequencia_operacional', details: options.runtime });
  }

  const requiredFromJourneys = Array.from(new Set(
    Object.values(journeyContracts).flatMap((journey) => journey.requiredCapabilities || [])
  ));

  const governance = evaluateOperationalGoNoGo(
    capabilitiesCoverage,
    requiredFromJourneys.length > 0 ? requiredFromJourneys : Array.from(capabilityIds),
    policy,
    options.runtime || {},
  );

  return {
    generatedAt: nowIso(),
    coverage: capabilitiesCoverage,
    gaps: {
      implementation: implementationGaps,
      e2e: e2eGaps,
      replay: replayGaps,
      ux: uxGaps,
      operational: operationalGaps,
      stateBased: stateBasedGaps,
    },
    replayCoverageAnalysis: {
      totalReplayFiles: Number(discovery?.replay?.replayFiles || 0),
      capabilitiesWithReplay: Object.values(capabilitiesCoverage).filter((item) => item.replay.replayed).length,
      capabilitiesWithOperationalReplay: Object.values(capabilitiesCoverage).filter((item) => item.replay.operationalEvidence).length,
    },
    finalCoverage: governance.coverage,
    autoGeneration,
    governance,
  };
}

module.exports = {
  detectGaps,
  evaluateOperationalGoNoGo,
};
