'use strict';

/**
 * engine/engineeringMission/bugFinding/constants.js — vocabulário fechado do ciclo de BUG do RAP.
 *
 * Módulo puro (sem I/O, sem relógio, sem random). Fonte única de verdade para os enums usados pelo
 * registro/deduplicação/triagem/reprodução/correção/regressão de findings de engenharia.
 *
 * RELAÇÃO COM O VOCABULÁRIO EXISTENTE: `engine/engineeringRouter/constants.js#FINDING_SEVERITIES`
 * (`BLOCKER`/`REGRESSION`/`POST_RELEASE`) é o vocabulário do PARECER de revisão (um finding de
 * review dentro de `EngineeringReview.findings`). Este arquivo é o ciclo de vida de um BUG — um
 * conceito DIFERENTE, que atravessa missão, task, reprodução, correção e regressão. Os dois
 * convivem: um finding de review BLOCKER/REGRESSION pode ORIGINAR um BugFinding (source META_REVIEW
 * / ADVERSARIAL_REVIEW), mas nenhum dos dois é derivado do outro.
 */

/**
 * Estados do ciclo de vida. A ordem é a do fluxo canônico:
 *   SUSPECTED → REPRODUCING → CONFIRMED → FIXING → FIXED → REGRESSION_VALIDATED → CLOSED
 * com os desvios NOT_REPRODUCED / DUPLICATE / BLOCKED declarados explicitamente.
 *
 * REGRESSION/RECURRENCE não é um estado novo: um finding já FIXED/REGRESSION_VALIDATED/CLOSED que
 * reaparece volta a CONFIRMED e incrementa `recurrenceCount` (a severidade é escalada), porque o
 * ciclo é o MESMO — criar um estado paralelo duplicaria a máquina de estados.
 */
const FINDING_STATUSES = Object.freeze([
  'SUSPECTED',
  'REPRODUCING',
  'CONFIRMED',
  'NOT_REPRODUCED',
  'DUPLICATE',
  'FIXING',
  'FIXED',
  'REGRESSION_VALIDATED',
  'CLOSED',
  'BLOCKED',
]);

/**
 * Transições permitidas. Qualquer outra transição é `INVALID_FINDING_TRANSITION` — a máquina é
 * fail-closed, nunca "avança por omissão".
 *
 * CONFIRMED→CLOSED existe para o caso legítimo "confirmado, mas não corrigível por policy"
 * (aceito como risco conhecido com evidência), NUNCA como atalho para esconder bug.
 */
const FINDING_TRANSITIONS = Object.freeze({
  SUSPECTED: Object.freeze(['REPRODUCING', 'CONFIRMED', 'NOT_REPRODUCED', 'DUPLICATE', 'BLOCKED', 'CLOSED']),
  REPRODUCING: Object.freeze(['CONFIRMED', 'NOT_REPRODUCED', 'DUPLICATE', 'BLOCKED', 'SUSPECTED']),
  CONFIRMED: Object.freeze(['FIXING', 'DUPLICATE', 'BLOCKED', 'CLOSED']),
  NOT_REPRODUCED: Object.freeze(['REPRODUCING', 'CLOSED']),
  DUPLICATE: Object.freeze(['CLOSED']),
  FIXING: Object.freeze(['FIXED', 'CONFIRMED', 'BLOCKED']),
  FIXED: Object.freeze(['REGRESSION_VALIDATED', 'CONFIRMED']),
  REGRESSION_VALIDATED: Object.freeze(['CLOSED', 'CONFIRMED']),
  CLOSED: Object.freeze(['CONFIRMED']),
  BLOCKED: Object.freeze(['FIXING', 'REPRODUCING', 'CLOSED']),
});

/** Estados em que o finding não está mais em trabalho ativo. */
const TERMINAL_FINDING_STATUSES = Object.freeze(['CLOSED']);

/** Estados a partir dos quais uma REINCIDÊNCIA é reconhecida (BUG-17). */
const RECURRENCE_SOURCE_STATUSES = Object.freeze(['FIXED', 'REGRESSION_VALIDATED', 'CLOSED']);

/** Estados que exigem uma EngineeringTask de correção vinculada. */
const FIX_REQUIRED_STATUSES = Object.freeze(['CONFIRMED', 'FIXING', 'FIXED', 'REGRESSION_VALIDATED']);

/** Severidades canônicas (conceitualmente iguais às do Router, deliberadamente as mesmas strings). */
const FINDING_SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const SEVERITY_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });
const SEVERITY_ORDER = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Severidades que exigem CODER ≠ REVIEWER (e, preferencialmente, provider diferente). */
const INDEPENDENT_REVIEW_SEVERITIES = Object.freeze(['HIGH', 'CRITICAL']);

/** Severidades em que a autoaprovação de self-modification é proibida por policy. */
const SELF_MODIFICATION_REVIEW_SEVERITIES = Object.freeze(['HIGH', 'CRITICAL']);

/**
 * Categorias. A categoria decide o ROTEAMENTO (capabilities), não a severidade: um BUG de banco e
 * um BUG de UI são a mesma severidade e exigem especialistas diferentes.
 */
const FINDING_CATEGORIES = Object.freeze([
  'BUG',
  'INFRA',
  'PROVIDER',
  'CONFIGURATION',
  'DATA',
  'SECURITY',
  'PERFORMANCE',
  'TIMEOUT',
  'CONCURRENCY',
  'RECOVERY',
  'GOVERNANCE',
  'TEST_DEFECT',
  'UNKNOWN',
]);

/**
 * Fontes de detecção. Todas convergem para o MESMO modelo de Finding — nunca uma integração por
 * fonte, que é o que a missão proíbe.
 */
const FINDING_SOURCES = Object.freeze([
  'UNIT_TEST',
  'INTEGRATION_TEST',
  'E2E_TEST',
  'REGRESSION_TEST',
  'RELEASE_GATE',
  'EXCEPTION',
  'STACK_TRACE',
  'HTTP_ERROR',
  'DATABASE_ERROR',
  'PROVIDER_ERROR',
  'PROCESS_CRASH',
  'TIMEOUT',
  'NO_PROGRESS',
  'INVARIANT_VIOLATION',
  'SECURITY_SCAN',
  'META_REVIEW',
  'ADVERSARIAL_REVIEW',
  'STATIC_ANALYSIS',
  'TELEMETRY_ANOMALY',
  'STALE_WRITE',
  'LEASE_FENCING',
  'GOVERNANCE_INCONSISTENCY',
  'HUMAN_REPORT',
]);

/** Fontes que produzem, por construção, apenas SUSPECTED (nunca CONFIRMED sozinhas). */
const SUSPICION_ONLY_SOURCES = Object.freeze([
  'META_REVIEW',
  'ADVERSARIAL_REVIEW',
  'STATIC_ANALYSIS',
  'TELEMETRY_ANOMALY',
  'HUMAN_REPORT',
]);

/**
 * BASES OBJETIVAS DE CONFIRMAÇÃO. Um finding só vira CONFIRMED com pelo menos uma delas.
 * `LLM_SUSPICION` está na lista de PROPÓSITO: existe para poder ser REJEITADA explicitamente e
 * para que a evidência registrada diga que a base era insuficiente (BUG-02).
 */
const CONFIRMATION_BASES = Object.freeze([
  'REPRODUCED_TEST_FAILURE',
  'DETERMINISTIC_INVARIANT_VIOLATION',
  'RUNTIME_ERROR_REPRODUCED',
  'UNEQUIVOCAL_EVIDENCE',
]);

/** Bases que NÃO confirmam nada — declaradas para nunca serem aceitas por engano. */
const NON_CONFIRMATION_BASES = Object.freeze(['LLM_SUSPICION', 'HEURISTIC', 'TIMEOUT_ONLY']);

/** Tipos de evidência persistidos em `evidenceRefs`. */
const EVIDENCE_TYPES = Object.freeze([
  'TEST_REPORT',
  'STACK_TRACE',
  'LOG_CORRELATION',
  'REQUEST_RESPONSE',
  'DATABASE_STATE',
  'SCREENSHOT',
  'ARTIFACT',
  'INVARIANT_EVALUATION',
  'REPRODUCTION_RESULT',
  'REGRESSION_RESULT',
  'REVIEW_VERDICT',
  'COMMAND_RUN',
]);

/** Tipos de evento do histórico append-only do finding. */
const FINDING_EVENT_TYPES = Object.freeze([
  'REGISTERED',
  'OCCURRENCE',
  'EVIDENCE_ADDED',
  'STATUS_CHANGED',
  'REPRODUCTION_ATTEMPTED',
  'TRIAGED',
  'FIX_TASK_LINKED',
  'FIX_APPLIED',
  'REGRESSION_VALIDATED',
  'RECURRENCE',
  'BLOCKED',
  'UNBLOCKED',
  'COMMENT',
]);

/**
 * Códigos de falha estruturados (nunca texto livre). Prefixo BUG_ para nunca colidir com os
 * códigos do Router/Mission.
 */
const BUG_FAILURE_CODES = Object.freeze({
  INVALID_FINDING_TRANSITION: 'INVALID_FINDING_TRANSITION',
  INSUFFICIENT_CONFIRMATION_BASIS: 'INSUFFICIENT_CONFIRMATION_BASIS',
  REPRODUCTION_PLAN_MISSING: 'REPRODUCTION_PLAN_MISSING',
  REPRODUCTION_INCONCLUSIVE: 'REPRODUCTION_INCONCLUSIVE',
  FIX_WITHOUT_REPRODUCTION: 'FIX_WITHOUT_REPRODUCTION',
  FIX_WITHOUT_REVIEW: 'FIX_WITHOUT_REVIEW',
  REGRESSION_WITHOUT_FIX: 'REGRESSION_WITHOUT_FIX',
  REGRESSION_EVIDENCE_MISSING: 'REGRESSION_EVIDENCE_MISSING',
  FINDING_NOT_CONFIRMED: 'FINDING_NOT_CONFIRMED',
  FINDING_TASK_ALREADY_LINKED: 'FINDING_TASK_ALREADY_LINKED',
  SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED: 'SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED',
  FINDING_BLOCKED_EXTERNAL_DEPENDENCY: 'FINDING_BLOCKED_EXTERNAL_DEPENDENCY',
  FINDING_PERSISTENCE_REQUIRED: 'FINDING_PERSISTENCE_REQUIRED',
  MISSION_NOT_FOUND: 'MISSION_NOT_FOUND',
});

/**
 * SUBSISTEMAS SENSÍVEIS (self-modification). Um finding cujo fix toca qualquer um destes altera as
 * PRÓPRIAS REGRAS que julgam o sistema — exatamente o "detector não pode ser autoridade única sobre
 * si mesmo". Prefixos de caminho relativos à raiz do repositório.
 */
const SELF_MODIFICATION_PATH_PREFIXES = Object.freeze([
  'governance/',
  'scripts/governance/',
  'pipeline/',
  'tools/system/',
  'qa-mesh/',
  'qa-waves/',
  'api/services/engineeringMission/',
  'api/services/engineeringRouter/',
  'engine/engineeringMission/',
  'engine/engineeringRouter/',
  'api/modules/engineering-missions/',
  'config/timeout-policy.json',
  'config/engineering-router-v2-required-tests.json',
  'jest.config.cjs',
]);

/** Subsystem labels que também caracterizam self-modification (usados por findings sem path). */
const SELF_MODIFICATION_SUBSYSTEMS = Object.freeze([
  'ENGINEER_ROUTER',
  'ENGINEERING_MISSION',
  'RELEASE_PIPELINE',
  'GOVERNANCE',
  'POLICY',
  'LEASE_FENCING',
  'ANTI_GREENWASHING',
  'APPROVAL',
  'QA_GATE',
]);

/**
 * Categorias que, por natureza, elevam o risco de self-modification.
 *
 * Só GOVERNANCE: um bug de governança É um bug nas regras de julgamento. SECURITY e CONCURRENCY
 * ficaram DELIBERADAMENTE fora — esses exigem revisor de segurança e revisor independente (controle
 * próprio) e não devem impedir a correção autônoma. O caso de lease/fencing continua coberto pelo
 * caminho e pelo subsistema (`LEASE_FENCING`), que é onde a posse e o fence de fato vivem.
 */
const SELF_MODIFICATION_CATEGORIES = Object.freeze(['GOVERNANCE']);

/** Marcos temporais usados em fingerprint (para ele NÃO depender de tempo/ids). */
const FINGERPRINT_VERSION = 'bugfp-v1';

module.exports = {
  FINDING_STATUSES,
  FINDING_TRANSITIONS,
  TERMINAL_FINDING_STATUSES,
  RECURRENCE_SOURCE_STATUSES,
  FIX_REQUIRED_STATUSES,
  FINDING_SEVERITIES,
  SEVERITY_RANK,
  SEVERITY_ORDER,
  INDEPENDENT_REVIEW_SEVERITIES,
  SELF_MODIFICATION_REVIEW_SEVERITIES,
  FINDING_CATEGORIES,
  FINDING_SOURCES,
  SUSPICION_ONLY_SOURCES,
  CONFIRMATION_BASES,
  NON_CONFIRMATION_BASES,
  EVIDENCE_TYPES,
  FINDING_EVENT_TYPES,
  BUG_FAILURE_CODES,
  SELF_MODIFICATION_PATH_PREFIXES,
  SELF_MODIFICATION_SUBSYSTEMS,
  SELF_MODIFICATION_CATEGORIES,
  FINGERPRINT_VERSION,
};
