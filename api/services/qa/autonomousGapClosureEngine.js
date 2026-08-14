const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');
const gapDetectionEngine = require('./gapDetectionEngine');
const autoScenarioGenerator = require('./autoScenarioGenerator');
const uiStepInference = require('./uiStepInferenceService');
const validatorInference = require('./validatorInferenceService');
const seedInference = require('./seedInferenceService');
const executionChainValidator = require('./executionChainValidator');
const operationalReplayValidator = require('./operationalReplayValidator');
const preflightEngine = require('./preflightEngine');
const replayNormalizationService = require('./replayNormalizationService');
const dataTestIdValidationService = require('./dataTestIdValidationService');
const transitionInferenceService = require('./transitionInferenceService');
const operationalStateEngine = require('./operationalStateEngine');
const { runMesh } = require('../../../qa-mesh/meshRunner');
const {
  belongsToTenant,
  normalizeTenantKey,
  redactDeep,
  stripInternalFilesystemPaths,
} = require('../../../lib/rpaSecurity');
const { validateReplayIntegrity } = require('../../../lib/replayIntegrity');
const { writeJsonAtomic } = require('../../utils/atomicJsonFile');

const JOURNEY_CONTRACTS_PATH = path.join(__dirname, '../../../config/journey-contracts.json');

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, payload);
}

function publicPayload(value) {
  return stripInternalFilesystemPaths(redactDeep(value));
}

function buildNoGo(reason, missing = [], extra = {}) {
  return {
    status: 'NO_GO',
    reason,
    missing,
    ...extra,
  };
}

function inferJourneyForCapability(capability = {}) {
  return capability.journeyId || capability.journey || capability.vertical || capability.id || capability.name;
}

function persistAutoWaveExpansion(capabilities = [], options = {}) {
  const store = safeReadJson(JOURNEY_CONTRACTS_PATH, {
    version: 1,
    generatedAt: new Date().toISOString(),
    journeys: {},
  });

  const journeys = store.journeys || {};
  let changed = false;

  for (const capability of capabilities) {
    const journeyId = inferJourneyForCapability(capability);
    if (!journeyId) continue;

    if (!journeys[journeyId]) {
      journeys[journeyId] = {
        requiredCapabilities: [capability.id || capability.name].filter(Boolean),
        missingCapabilities: [],
        confidence: 0.5,
        source: 'autonomous_gap_closure',
      };
      changed = true;
      continue;
    }

    const required = new Set(journeys[journeyId].requiredCapabilities || []);
    const capabilityId = capability.id || capability.name;
    if (capabilityId && !required.has(capabilityId)) {
      required.add(capabilityId);
      journeys[journeyId].requiredCapabilities = Array.from(required);
      changed = true;
    }
  }

  const persist = options.persist === true;
  if (changed && persist) {
    store.generatedAt = new Date().toISOString();
    store.journeys = journeys;
    safeWriteJson(JOURNEY_CONTRACTS_PATH, store);
  }

  return { changed, persisted: changed && persist, journeys: Object.keys(journeys).length };
}

/**
 * AUTONOMOUS GAP CLOSURE ENGINE
 *
 * Envolve gapDetectionEngine e automatiza:
 * 1. Identificação de gaps operacionais
 * 2. Geração de cenários
 * 3. Geração de uiSteps
 * 4. Geração de validators
 * 5. Geração de seeds
 * 6. Sugestões de remediação com ações concretas
 * 7. Validação operacional completa
 * 8. Preflight engine
 */

/**
 * Executa detecção de gaps + gera remediações automáticas
 */
async function detectGapsWithAutoRemediations(options = {}) {
  // 1. Executar detecção de gaps padrão
  const gapReport = gapDetectionEngine.detectGaps(options);

  // 2. Identificar capabilities com gaps críticos
  const gappedCapabilities = [];
  for (const gap of gapReport.gaps.operational || []) {
    const capId = gap.capability;
    const cap = options.capabilities?.find((c) => c.id === capId);
    if (cap) {
      gappedCapabilities.push(cap);
    }
  }

  // 3. Gerar remediações automáticas
  const remediations = await generateAutoRemediations(gappedCapabilities, options);

  return {
    gapReport,
    gappedCapabilities: gappedCapabilities.map((c) => c.id),
    remediations,
    closure: {
      totalGaps: gapReport.gaps.operational?.length || 0,
      scenariosCanBeGenerated: remediations.scenarios.length,
      uiStepsCanBeGenerated: remediations.uiSteps.coverage,
      validatorsCanBeGenerated: remediations.validators.coverage,
      seedsCanBeGenerated: remediations.seeds.coverage,
      automationPotential: Math.round(
        ((remediations.scenarios.length +
          Object.keys(remediations.uiSteps.byCapability).length +
          Object.keys(remediations.validators.byCapability).length) /
          (gappedCapabilities.length * 3)) *
          100
      ),
    },
  };
}

/**
 * Gera remediações automáticas para capabilities com gaps
 */
async function generateAutoRemediations(gappedCapabilities = [], options = {}) {
  const tenantId = normalizeTenantKey(options.tenantId, { defaultValue: 'system' });
  const remediations = {
    scenarios: [],
    uiSteps: { byCapability: {}, coverage: 0 },
    validators: { byCapability: {}, coverage: 0 },
    seeds: { byCapability: {}, coverage: 0 },
    preflightSuggestions: [],
    chainValidationSuggestions: [],
    replayImprovements: [],
  };

  const dataTestIdScan = dataTestIdValidationService.scanDataTestIds({
    rootDir: options.rootDir || path.join(__dirname, '..', '..', '..', '..'),
  });
  const frontendData = {
    ...(options.discovery?.frontend || {}),
    dataTestIdScan,
  };

  // 1. Gerar scenarios
  try {
    remediations.scenarios = autoScenarioGenerator.generateScenariosForGaps(
      gappedCapabilities,
      frontendData,
      {
        persist: options.persistGeneratedScenarios !== false,
        tenantId,
      }
    );
  } catch (err) {
    logger.error(`[AutonomousGapClosureEngine] Erro ao gerar scenarios: ${err.message}`);
  }

  // 2. Gerar uiSteps
  for (const capability of gappedCapabilities) {
    const selectorValidation = dataTestIdValidationService.validateCapabilityDataTestIds(
      capability,
      dataTestIdScan
    );
    if (selectorValidation.status === 'NO_GO') {
      remediations.preflightSuggestions.push({
        capability: capability.id,
        missing: selectorValidation.missing,
        action: 'missing_data_testid',
        remediation: selectorValidation.remediation,
      });
      continue;
    }

    try {
      const steps = uiStepInference.inferUIStepsForCapability(capability, frontendData);
      if (steps.length > 0) {
        remediations.uiSteps.byCapability[capability.id] = steps;
        remediations.uiSteps.coverage++;
      }
    } catch (err) {
      logger.warn(
        `[AutonomousGapClosureEngine] Erro ao gerar uiSteps para ${capability.id}: ${err.message}`
      );
    }
  }

  // 3. Gerar validators
  for (const capability of gappedCapabilities) {
    try {
      const validators = validatorInference.inferValidatorsForCapability(capability);
      if (validators.length > 0) {
        remediations.validators.byCapability[capability.id] = validators;
        remediations.validators.coverage++;
      }
    } catch (err) {
      logger.warn(
        `[AutonomousGapClosureEngine] Erro ao gerar validators para ${capability.id}: ${err.message}`
      );
    }
  }

  // 4. Gerar seeds
  for (const capability of gappedCapabilities) {
    try {
      const seeds = seedInference.generateSeedsForCapability(capability);
      if (seeds.length > 0) {
        remediations.seeds.byCapability[capability.id] = seeds;
        remediations.seeds.coverage++;
      }
    } catch (err) {
      logger.warn(
        `[AutonomousGapClosureEngine] Erro ao gerar seeds para ${capability.id}: ${err.message}`
      );
    }
  }

  // 5. Preflight suggestions
  for (const capability of gappedCapabilities) {
    const journeyId = capability.name || capability.id;
    const preflightResult = await preflightEngine.validateJourneyPreconditions(journeyId, options.context || {});

    if (preflightResult.status === 'NO_GO') {
      remediations.preflightSuggestions.push({
        capability: capability.id,
        missing: preflightResult.missing,
        action: 'Implementar pré-condições obrigatórias antes de executar',
      });
    }
  }

  // 6. Execution chain validation suggestions
  for (const capability of gappedCapabilities) {
    const chainName = executionChainValidator.inferExpectedChain(capability.id);
    if (chainName !== 'unknown') {
      remediations.chainValidationSuggestions.push({
        capability: capability.id,
        expectedChain: chainName,
        action: `Validar que replay percorre chain completo: ${chainName}`,
      });
    }
  }

  // 7. Replay improvements
  if (options.discovery?.replay?.sampleReplays) {
    for (const replay of options.discovery.replay.sampleReplays.slice(0, 5)) {
      try {
          const validation = operationalReplayValidator.validateOperationalReplay(replay);
        if (!validation.isOperational) {
          const improvements = operationalReplayValidator.suggestReplayImprovements(validation);
          remediations.replayImprovements.push(...improvements);
        }
      } catch (err) {
        logger.debug(
          `[AutonomousGapClosureEngine] Erro ao validar replay: ${err.message}`
        );
      }
    }
  }

  return remediations;
}

/**
 * Executa preflight engine e retorna bloqueadores
 */
function checkPreflightBlockers(waveSpec = {}) {
  return preflightEngine.executeFullPreflight(waveSpec);
}

/**
 * Valida se replay é operacional real
 */
function validateReplayOperationality(replay = {}) {
  return operationalReplayValidator.validateOperationalReplay(replay);
}

/**
 * Valida cadeia de execução
 */
function validateExecutionChain(chainName, executedModules = []) {
  const validation = executionChainValidator.validateExecutionChain(chainName, executedModules);
  const suggestions = executionChainValidator.suggestChainRemediations(validation);

  return {
    validation,
    suggestions,
  };
}

/**
 * Classifica operacionalidade de uma execução
 */
function classifyOperationality(executionTrace = {}, chainName = null) {
  let chainValidation = null;

  if (chainName) {
    const modules = executionChainValidator.traceExecutionChain(executionTrace);
    chainValidation = executionChainValidator.validateExecutionChain(chainName, modules);
  }

  return executionChainValidator.classifyOperationality(executionTrace, chainValidation || {});
}

/**
 * Gera report completo de closure automático de gaps
 */
async function generateClosureReport(options = {}) {
  // 1. Detectar gaps com remediações
  const detection = await detectGapsWithAutoRemediations(options);

  // 2. Marcar bloqueadores críticos
  const blockingIssues = [];
  if (detection.gapReport.governance.goNoGo === 'NO_GO') {
    blockingIssues.push({
      type: 'governance_blocker',
      reason: 'GO/NO_GO decisão: NO_GO',
      blockers: detection.gapReport.governance.blockers,
    });
  }

  // 3. Sugerir ações imediatas
  const immediateActions = [];
  if (detection.remediations.scenarios.length > 0) {
    immediateActions.push({
      priority: 'critical',
      action: 'auto_generate_scenarios',
      count: detection.remediations.scenarios.length,
      message: `Gerar ${detection.remediations.scenarios.length} scenarios automaticamente`,
    });
  }

  if (detection.remediations.preflightSuggestions.length > 0) {
    immediateActions.push({
      priority: 'critical',
      action: 'implement_preflights',
      count: detection.remediations.preflightSuggestions.length,
      message: 'Implementar pré-condições obrigatórias',
    });
  }

  if (detection.remediations.chainValidationSuggestions.length > 0) {
    immediateActions.push({
      priority: 'high',
      action: 'validate_chains',
      count: detection.remediations.chainValidationSuggestions.length,
      message: 'Validar cadeias de execução',
    });
  }

  return {
    timestamp: new Date().toISOString(),
    detection,
    blockingIssues,
    immediateActions,
    closureStatus: blockingIssues.length === 0 ? 'ready_to_automate' : 'blockers_detected',
    nextSteps:
      blockingIssues.length === 0
        ? 'Executar geração automática de cenários, uiSteps, validators e seeds'
        : 'Resolver bloqueadores antes de automação',
  };
}

function calculateOperationalCoverage(executionResult = {}, replayValidation = {}, consequences = {}, stateFlow = {}) {
  const summary = executionResult.summary || {};
  const implementedCoverage = Number(summary.executionCoverage || 0);
  const e2eCoverage = Number(summary.executionCoverage || 0);
  const replayCoverage = replayValidation.isOperational ? 100 : Number(replayValidation.percentage || 0);
  const operationalCoverage = Number(summary.executionQuality === 'high' ? 100 : summary.executionCoverage || 0);
  const consequenceCoverage = consequences.valid ? 100 : Math.max(0, 100 - (consequences.missing || []).length * 20);
  const transitionCoverage = Number(stateFlow?.chain?.coverage?.transitionCoverage || 0);
  const stateValidationCoverage = Number(stateFlow?.chain?.coverage?.stateValidationCoverage || 0);
  const sideEffectCoverage = Number(stateFlow?.chain?.coverage?.sideEffectCoverage || 0);
  const operationalConsequenceCoverage = Number(stateFlow?.chain?.coverage?.operationalConsequenceCoverage || 0);

  return {
    implementedCoverage,
    e2eCoverage,
    replayCoverage,
    operationalCoverage,
    consequenceCoverage,
    transitionCoverage,
    stateValidationCoverage,
    sideEffectCoverage,
    operationalConsequenceCoverage,
  };
}

async function runAutonomousGapClosureLoop(options = {}) {
  const missing = [];
  const requiredInput = ['waveId', 'journeyId', 'scenarioIds', 'capabilityIds', 'tenantId'];
  for (const key of requiredInput) {
    if (options[key] === undefined || options[key] === null) {
      missing.push({ name: key, reason: 'missing_required_field' });
    }
  }

  if (!Array.isArray(options.scenarioIds) || options.scenarioIds.length === 0) {
    missing.push({ name: 'scenarioIds', reason: 'empty_scenarios' });
  }
  if (!Array.isArray(options.capabilityIds) || options.capabilityIds.length === 0) {
    missing.push({ name: 'capabilityIds', reason: 'empty_capabilities' });
  }

  if (missing.length > 0) {
    return buildNoGo('PRECONDITION_FAILED', missing);
  }
  const tenantId = normalizeTenantKey(options.tenantId);

  const preflight = await preflightEngine.executeFullPreflight({
    waveId: options.waveId,
    journeyId: options.journeyId,
    scenarioIds: options.scenarioIds,
    capabilityIds: options.capabilityIds,
    tenantId,
    context: { ...(options.context || {}), tenantId },
  });

  if (preflight.status === 'NO_GO') {
    return buildNoGo('PRECONDITION_FAILED', preflight.missing || preflight.blockingIssues || [], {
      preflight,
    });
  }

  const detection = await detectGapsWithAutoRemediations(options);
  const generatedScenarios = detection.remediations.scenarios || [];
  const generatedScenarioIds = generatedScenarios.map((item) => item.id);
  const expandedScenarioIds = Array.from(new Set([...(options.scenarioIds || []), ...generatedScenarioIds]));

  const discoveredCapabilities = (options.capabilities || []).filter((capability) => {
    const capabilityId = capability.id || capability.name;
    return capabilityId && !options.capabilityIds.includes(capabilityId);
  });
  const waveExpansion = persistAutoWaveExpansion(discoveredCapabilities, {
    // Runtime tenant executions may propose an expansion, but may never mutate
    // the canonical source registry.  That mutation remains an explicit,
    // system-tenant governance operation outside this HTTP workflow.
    persist: options.persistRegistryExpansion === true && tenantId === 'system',
  });

  const executionInput = {
    wave: options.waveId,
    tenantId,
    scenarioIds: expandedScenarioIds,
    executionOrigin: 'autonomous_gap_closure',
    closeGovernanceDbAfterIntegration: false,
    writeCanonicalOutputs: false,
  };

  let executionResult;
  let executionAttempts = 0;
  const maxRetries = Number.isFinite(Number(options.maxRetries)) ? Number(options.maxRetries) : 1;
  const remediationAttempts = [];

  while (executionAttempts <= maxRetries) {
    executionAttempts += 1;
    executionResult = await runMesh(executionInput);
    const goNoGo = executionResult?.summary?.goNoGo || 'NO_GO';
    if (goNoGo === 'GO') {
      break;
    }

    const remediation = {
      attempt: executionAttempts,
      reason: 'execution_failed',
      action: 'regenerate_seed_and_retry',
      generatedAt: new Date().toISOString(),
    };
    remediationAttempts.push(remediation);

    if (executionAttempts > maxRetries) {
      break;
    }

    for (const capability of options.capabilities || []) {
      const regeneratedSeeds = seedInference.generateSeedsForCapability(capability);
      if (regeneratedSeeds.length > 0) {
        const seedScenario = {
          id: `${capability.id || capability.name}-recovery-${Date.now()}`,
          tenantId,
          capabilityId: capability.id || capability.name,
          capabilityName: capability.name || capability.id,
          journeyId: inferJourneyForCapability(capability),
          seedType: regeneratedSeeds[0].type,
          seed: regeneratedSeeds[0].data,
          steps: uiStepInference.inferUIStepsForCapability(capability, options.discovery?.frontend || {}),
          validators: validatorInference.inferValidatorsForCapability(capability),
          governanceRules: [{ rule: 'recovery_retry', enabled: true }],
          replayRequirements: { requireOperationalConsequence: true },
        };
        autoScenarioGenerator.persistGeneratedArtifacts(seedScenario, { tenantId });
      }
    }
  }

  const replaySample = executionResult?.results?.[0]?.artifacts?.find((artifact) => artifact.type === 'replay');
  const replayArtifactBlockers = [];
  let replayPayload = { events: [], screenshots: [] };
  if (replaySample?.path && executionResult?.evidenceDir) {
    const evidenceRoot = path.resolve(executionResult.evidenceDir);
    const replayPath = path.resolve(replaySample.path);
    const isContained = replayPath.startsWith(`${evidenceRoot}${path.sep}`);
    if (!isContained) {
      replayArtifactBlockers.push({ reason: 'replay_path_outside_execution_evidence' });
    } else {
      const candidate = safeReadJson(replayPath, null);
      if (!candidate || !belongsToTenant(candidate, tenantId)) {
        replayArtifactBlockers.push({ reason: 'replay_tenant_mismatch' });
      } else {
        const integrity = validateReplayIntegrity(candidate, candidate.governance || {});
        if (!integrity.valid) {
          replayArtifactBlockers.push({ reason: 'replay_integrity_invalid', blockers: integrity.blockers });
        } else {
          replayPayload = candidate;
        }
      }
    }
  } else {
    replayArtifactBlockers.push({ reason: 'missing_operational_replay' });
  }
  const normalizedReplay = replayNormalizationService.normalizeReplay(replayPayload);
  // O validator faz sua própria normalização, mas a assinatura deve ser
  // verificada contra o artefato bruto canônico. Validar o objeto já
  // normalizado alteraria o hash e produziria falso tamper.
  const replayValidation = operationalReplayValidator.validateOperationalReplay(replayPayload);

  const expectedConsequences = options.expectedConsequences || [
    'ticket_status_changed',
    'crm_updated',
    'booking_created',
    'turnstile_released',
    'checkin_registered',
  ];
  const consequences = operationalReplayValidator.validateOperationalConsequences(
    normalizedReplay,
    expectedConsequences
  );

  const chainName = executionChainValidator.inferExpectedChain(options.capabilityIds[0]);
  const executedModules = executionChainValidator.traceExecutionChain(normalizedReplay);
  const chainValidation = executionChainValidator.validateExecutionChain(chainName, executedModules);

  const inferredTransitions = transitionInferenceService.inferTransitionsFromReplayEvents(
    normalizedReplay.events || []
  );
  const stateTransitions = inferredTransitions.map((item) => {
    const contract = item.contract || {};
    return {
      journeyId: options.journeyId || contract.journeyId || normalizedReplay.journeyId,
      transitionId: item.transitionId,
      action: item.action,
      initialState: normalizedReplay.initialState || contract.initialState || options.initialState || null,
      transitionState: normalizedReplay.transitionState || contract.expectedTransition || null,
      finalState: normalizedReplay.finalState || contract.finalState || null,
      beforeSnapshot: normalizedReplay.beforeSnapshot || { state: normalizedReplay.initialState || contract.initialState || null },
      afterSnapshot: normalizedReplay.afterSnapshot || { state: normalizedReplay.finalState || contract.finalState || null },
      observedSideEffects: consequences.observed || [],
      requiredSideEffects: contract.requiredSideEffects || [],
    };
  });

  const stateFlow = operationalStateEngine.evaluateOperationalStateFlow({
    transitions: stateTransitions,
    journeyId: options.journeyId || normalizedReplay.journeyId || null,
  });

  const coverage = calculateOperationalCoverage(executionResult, replayValidation, consequences, stateFlow);
  const fallbackUsed = Number(executionResult?.summary?.fallbackUsed || 0) > 0;
  const fallbackBlockingUsed = Number(executionResult?.summary?.fallbackBlockingUsed || 0) > 0;
  const goNoGo = replayValidation.isOperational
    && consequences.valid
    && chainValidation.valid
    && stateFlow.goNoGo === 'GO'
    && !fallbackUsed
    && !fallbackBlockingUsed
    && coverage.transitionCoverage > 0
    && coverage.stateValidationCoverage > 0
    && coverage.sideEffectCoverage > 0
    && coverage.operationalConsequenceCoverage > 0
    ? 'GO'
    : 'NO_GO';

  const governance = {
    goNoGo,
    blockers: [],
  };

  if (!replayValidation.isOperational) {
    const replayBlockers = Array.isArray(replayValidation.blockers) && replayValidation.blockers.length > 0
      ? replayValidation.blockers
      : [{ reason: replaySample ? 'replay_invalid' : 'missing_operational_replay', details: replayValidation.recommendation }];
    governance.blockers.push(...replayBlockers);
  }
  governance.blockers.push(...replayArtifactBlockers);
  if (!consequences.valid) {
    governance.blockers.push({ reason: 'missing_operational_consequence', missing: consequences.missing });
  }
  if (!chainValidation.valid) {
    governance.blockers.push({ reason: 'execution_chain_broken', missing: chainValidation.missing || [] });
  }
  if (stateFlow.goNoGo !== 'GO') {
    governance.blockers.push({ reason: 'state_transition_invalid', details: stateFlow.blockers });
  }
  if (fallbackUsed) {
    governance.blockers.push({ reason: 'fallback_used_strict_mode' });
  }
  if (fallbackBlockingUsed) {
    governance.blockers.push({ reason: 'fallback_on_blocking_scenario' });
  }
  if (replayValidation.results?.stateAware?.clickWithoutConsequence === true) {
    governance.blockers.push({ reason: 'click_without_operational_consequence' });
  }

  return publicPayload({
    status: goNoGo,
    reason: goNoGo === 'GO' ? null : 'PRECONDITION_FAILED',
    waveId: options.waveId,
    journeyId: options.journeyId,
    tenantId,
    flow: [
      'Gap Detection',
      'Scenario Generation',
      'Seed Generation',
      'UI Step Generation',
      'Validator Generation',
      'Persistencia',
      'Wave Expansion',
      'Browser Execution',
      'Replay Generation',
      'Replay Validation',
      'Governance Recalculation',
    ],
    detection,
    preflight,
    waveExpansion,
    execution: {
      attempts: executionAttempts,
      remediationAttempts,
      summary: executionResult?.summary || null,
    },
    replay: {
      validation: replayValidation,
      consequences,
      normalizedReplay,
      operationalTimeline: replayValidation.operationalTimeline || stateFlow.timeline,
    },
    chainValidation,
    stateFlow,
    coverage,
    governance,
    missing: governance.blockers,
  });
}

module.exports = {
  detectGapsWithAutoRemediations,
  generateAutoRemediations,
  checkPreflightBlockers,
  validateReplayOperationality,
  validateExecutionChain,
  classifyOperationality,
  generateClosureReport,
  runAutonomousGapClosureLoop,
};
