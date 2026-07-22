'use strict';

/**
 * Learning Routine Service — rotina agregadora de aprendizado.
 *
 * Executa o ciclo NÃO-humano do pipeline RAP Learn:
 *   1. detectRegressions (janela configurável) → falhas recentes
 *   2. agrupa por source + classification
 *   3. grupos >= minGroupSize:
 *      - classifica registros 'detected' (regras determinísticas por padrão de erro)
 *      - gera sugestão no registro representativo (IA quando disponível;
 *        fallback determinístico explícito quando não)
 *
 * Governança: NUNCA valida nem promove. As transições 'validated' e 'promoted'
 * continuam exigindo ação humana via /api/rap-learn/validate e /promote.
 *
 * Registro é best-effort: falha de ledger/IA não derruba a rotina, mas é
 * sempre logada e refletida no relatório.
 */

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_MIN_GROUP_SIZE = 3;

/**
 * Regras determinísticas de classificação por padrão de erro.
 * Avaliadas em ordem; a primeira que casa vence.
 */
const CLASSIFICATION_RULES = [
  { pattern: /timeout|timed[\s_]?out|deadline|econnrefused|econnreset/i, classification: 'timeout_or_connectivity', rootCause: 'Timeout ou falha de conectividade em dependência externa' },
  { pattern: /intent|confidence|misclassif/i, classification: 'intent_misclassification', rootCause: 'Intenção classificada incorretamente ou com confiança abaixo do limiar' },
  { pattern: /whatsapp|channel|inbound|outbound|pbx|voice/i, classification: 'channel_integration', rootCause: 'Falha na integração de canal de comunicação' },
  { pattern: /provider|openai|anthropic|ai_provider|no_provider/i, classification: 'ai_provider', rootCause: 'Falha ou ausência de provider de IA configurado' },
  { pattern: /persistence|sequelize|database|deadlock|db_/i, classification: 'persistence', rootCause: 'Falha de persistência em banco de dados' },
  { pattern: /auth|unauthorized|forbidden|token/i, classification: 'auth', rootCause: 'Falha de autenticação ou autorização' },
];

/**
 * Extrai texto pesquisável de um registro de falha (metrics + classification).
 */
function recordText(record = {}) {
  const metrics = record.metrics || {};
  return [
    record.classification,
    record.source,
    metrics.intent,
    metrics.failure ? JSON.stringify(metrics.failure) : null,
  ].filter(Boolean).join(' ');
}

/**
 * Infere a classificação de UM registro pelas regras determinísticas.
 * @returns {{classification: string, rootCause: string, rule: string}|null}
 */
function inferRecordClassification(record = {}) {
  const text = recordText(record);
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(text)) {
      return { classification: rule.classification, rootCause: rule.rootCause, rule: String(rule.pattern) };
    }
  }
  return null;
}

/**
 * Classifica um grupo de falhas pelas regras determinísticas.
 * @returns {{classification: string, rootCause: string, rule: string}|null}
 */
function classifyGroup(records = []) {
  return inferRecordClassification({ metrics: { failure: records.map(recordText).join(' ') } });
}

/**
 * Agrupa registros por `source::classification`, usando a classification
 * armazenada OU a inferida deterministicamente ('unclassified' quando nenhuma).
 * Assim falhas recorrentes do mesmo padrão caem no mesmo grupo mesmo antes
 * de serem classificadas.
 */
function groupFailures(records = []) {
  const groups = new Map();
  for (const record of records) {
    const classification = record.classification || inferRecordClassification(record)?.classification || 'unclassified';
    const key = `${record.source || 'unknown'}::${classification}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function buildDeterministicSuggestion({ key, classification, rootCause, records }) {
  return {
    kind: 'recurrent_failure_group',
    group: key,
    classification: classification || 'unclassified',
    rootCause: rootCause || 'Causa raiz não determinada automaticamente — revisão humana necessária',
    occurrences: records.length,
    sampleSourceRefs: records.slice(0, 5).map((r) => r.sourceRef).filter(Boolean),
    proposedActions: [
      'Investigar a causa raiz agrupada e confirmar a classificação proposta',
      'Criar cenário de regressão cobrindo o padrão de falha (QA Waves/mesh)',
      'Após correção, validar via /api/rap-learn/validate e promover via /api/rap-learn/promote',
    ],
    generatedBy: 'learning-routine:deterministic',
    requiresHumanValidation: true,
  };
}

function buildAiPrompt({ key, classification, rootCause, records }) {
  const samples = records.slice(0, 5).map((r) => `- source=${r.source} ref=${r.sourceRef || 'n/a'} metrics=${JSON.stringify(r.metrics || {}).slice(0, 300)}`).join('\n');
  return [
    'Você é o analista de aprendizado da plataforma RAP.',
    `O grupo de falhas recorrentes "${key}" ocorreu ${records.length}x na janela analisada.`,
    `Classificação determinística: ${classification || 'nenhuma'} (${rootCause || 'sem causa raiz inferida'}).`,
    'Amostras:',
    samples,
    '',
    'Responda APENAS JSON válido com: {"rootCause": string, "proposedActions": string[3-5], "confidence": number 0-1}.',
    'As ações devem ser técnicas, específicas e verificáveis por QA.',
  ].join('\n');
}

function defaultDeps() {
  return {
    rapLearn: require('../modules/rap-learn/service'),
    logger: require('../utils/logger'),
    appendEvent: (args) => require('./eventLedgerService').appendEventV1(args),
  };
}

/**
 * Executa a rotina de aprendizado.
 *
 * @param {object} options
 * @param {string} [options.tenantId='system']
 * @param {number} [options.windowHours=24]
 * @param {number} [options.minGroupSize=3]
 * @param {boolean} [options.dryRun=false] - não persiste nada, só reporta
 * @param {object} [options.rapLearn] - módulo rap-learn (injetável p/ testes)
 * @param {function} [options.generateAiText] - async (prompt, tenantId) => string (opcional)
 * @param {function} [options.appendEvent] - ledger (injetável p/ testes)
 * @param {object} [options.logger]
 * @returns {Promise<object>} relatório da execução
 */
async function runLearningRoutine(options = {}) {
  const deps = defaultDeps();
  const rapLearn = options.rapLearn || deps.rapLearn;
  const log = options.logger || deps.logger;
  const appendEvent = options.appendEvent || deps.appendEvent;
  const tenantId = options.tenantId || 'system';
  const windowHours = Number(options.windowHours) > 0 ? Number(options.windowHours) : DEFAULT_WINDOW_HOURS;
  const minGroupSize = Number(options.minGroupSize) > 0 ? Number(options.minGroupSize) : DEFAULT_MIN_GROUP_SIZE;
  const dryRun = options.dryRun === true;
  const startedAt = new Date().toISOString();

  const report = {
    tenantId,
    windowHours,
    minGroupSize,
    dryRun,
    startedAt,
    finishedAt: null,
    failuresInWindow: 0,
    pendingDetected: 0,
    groupsFound: 0,
    groupsProcessed: 0,
    classified: 0,
    suggestions: 0,
    aiUsed: false,
    aiFallbacks: [],
    groups: [],
    errors: [],
  };

  const records = await rapLearn.detectRegressions({ tenantId, windowHours });
  report.failuresInWindow = records.length;

  // Só processa o que ainda está 'detected' — nunca reprocessa estados avançados.
  const pending = records.filter((r) => r.status === 'detected');
  report.pendingDetected = pending.length;

  const groups = groupFailures(pending);
  report.groupsFound = groups.size;

  for (const [key, groupRecords] of groups.entries()) {
    const groupInfo = { key, size: groupRecords.length, processed: false };
    report.groups.push(groupInfo);
    if (groupRecords.length < minGroupSize) continue;

    groupInfo.processed = true;
    report.groupsProcessed += 1;

    // 1. Classificação determinística (registros sem classification)
    const inferred = classifyGroup(groupRecords);
    const existingClassification = groupRecords.map((r) => r.classification).find(Boolean) || null;
    const classification = existingClassification || inferred?.classification || null;
    const rootCause = inferred?.rootCause || null;
    groupInfo.classification = classification;

    if (!dryRun) {
      for (const record of groupRecords) {
        if (record.classification) continue; // já classificado — não sobrescreve
        try {
          await rapLearn.classifyFailure(
            record.id,
            classification || 'unclassified',
            rootCause,
            tenantId,
          );
          report.classified += 1;
        } catch (error) {
          report.errors.push({ stage: 'classify', recordId: record.id, error: error.message });
          log.warn('[LearningRoutine] classifyFailure falhou', { recordId: record.id, error: error.message });
        }
      }
    }

    // 2. Sugestão no registro representativo (mais recente do grupo)
    const representative = groupRecords[0];
    let suggestion = null;
    if (typeof options.generateAiText === 'function') {
      try {
        const aiText = await options.generateAiText(buildAiPrompt({ key, classification, rootCause, records: groupRecords }), tenantId);
        const parsed = JSON.parse(String(aiText || '').replace(/```json|```/g, '').trim());
        suggestion = {
          kind: 'recurrent_failure_group',
          group: key,
          classification: classification || 'unclassified',
          rootCause: String(parsed.rootCause || rootCause || ''),
          occurrences: groupRecords.length,
          proposedActions: Array.isArray(parsed.proposedActions) ? parsed.proposedActions.map(String) : [],
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          generatedBy: 'learning-routine:ai',
          requiresHumanValidation: true,
        };
        report.aiUsed = true;
      } catch (error) {
        report.aiFallbacks.push({ group: key, error: error.message });
        log.warn('[LearningRoutine] IA indisponível para sugestão — fallback determinístico', { group: key, error: error.message });
      }
    }
    if (!suggestion) {
      suggestion = buildDeterministicSuggestion({ key, classification, rootCause, records: groupRecords });
    }

    if (!dryRun) {
      try {
        await rapLearn.generateSuggestion(representative.id, suggestion, tenantId);
        report.suggestions += 1;
      } catch (error) {
        report.errors.push({ stage: 'suggest', recordId: representative.id, error: error.message });
        log.warn('[LearningRoutine] generateSuggestion falhou', { recordId: representative.id, error: error.message });
      }
    }
  }

  report.finishedAt = new Date().toISOString();

  // 3. Ledger (best-effort)
  try {
    await appendEvent({
      tenantId,
      type: 'LearningRoutineCompleted',
      source: 'learning-routine',
      subject: { type: 'learning_routine', id: startedAt },
      actor: { type: 'system', id: 'learning-routine' },
      payload: {
        windowHours,
        failuresInWindow: report.failuresInWindow,
        groupsProcessed: report.groupsProcessed,
        classified: report.classified,
        suggestions: report.suggestions,
        dryRun,
      },
    });
  } catch (error) {
    log.warn('[LearningRoutine] Event ledger append falhou (best-effort)', { error: error.message });
  }

  log.info('[LearningRoutine] Rotina concluída', {
    tenantId,
    failuresInWindow: report.failuresInWindow,
    groupsProcessed: report.groupsProcessed,
    classified: report.classified,
    suggestions: report.suggestions,
  });

  return report;
}

module.exports = {
  runLearningRoutine,
  // exports p/ testes
  groupFailures,
  classifyGroup,
  buildDeterministicSuggestion,
  CLASSIFICATION_RULES,
  DEFAULT_WINDOW_HOURS,
  DEFAULT_MIN_GROUP_SIZE,
};
