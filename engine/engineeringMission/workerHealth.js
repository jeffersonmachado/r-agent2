'use strict';

/**
 * engine/engineeringMission/workerHealth.js
 *
 * SAÚDE DOS WORKERS OBRIGATÓRIOS DO SUBSISTEMA DE ENGENHARIA.
 *
 * GAP QUE ESTE MÓDULO FECHA (confirmado no código em 2026-10-02):
 *
 *   `api/runtime/startWorkers.js` iniciava o worker do laço de bugs dentro de um `try/catch` que
 *   apenas registrava `logger.warn('... Falha ao iniciar worker (ignorado)')`. Com o Engineer Router
 *   HABILITADO, uma falha de start deixava o subsistema SEM o worker que processa os findings — e
 *   nada, em lugar nenhum, aparecia como não-saudável. A plataforma exibia saúde normal sobre uma
 *   capacidade que não estava funcionando.
 *
 *   Pior: um worker VIVO mas sem ciclos (travado, por exemplo esperando um recurso que nunca volta)
 *   também parecia saudável, porque o único sinal exposto era "tem timer?".
 *
 * REGRA: um worker obrigatório que não roda tem de ser VISÍVEL. Não se trata de derrubar a
 * plataforma inteira (a tolerância do resto do RAP é preservada) — trata-se de não mentir sobre a
 * capacidade: o subsistema de engenharia aparece DEGRADED/NO_GO, e o motivo exato fica exposto.
 *
 * Módulo PURO: recebe observações, devolve estado. Sem timers, sem I/O, sem relógio próprio —
 * `nowMs` é parâmetro, para que a decisão seja determinística e testável.
 */

/** Vocabulário FECHADO de estados de um worker. */
const WORKER_STATES = Object.freeze([
  'RUNNING',            // iniciado e produzindo ciclos dentro do esperado
  'DEGRADED',           // iniciado, mas sem ciclos (STUCK) ou acumulando erros
  'DOWN',               // deveria estar rodando e não está (falha de start declarada)
  'STOPPED',            // parado de forma deliberada/terminal (shutdown, nunca iniciado)
  'DISABLED_BY_POLICY', // desabilitado por política explícita — não é falha
]);

/** Prontidão do subsistema de engenharia derivada da saúde dos workers obrigatórios. */
const ENGINEERING_READINESS = Object.freeze(['GREEN', 'DEGRADED', 'NO_GO']);

/** Quantos ciclos consecutivos com erro antes de considerar o worker degradado. */
const DEFAULT_CONSECUTIVE_ERROR_THRESHOLD = 3;

/**
 * Deriva o estado de UM worker a partir de observações.
 *
 * A ordem das checagens é deliberada: política vence tudo (um worker desabilitado por política não é
 * falha); depois a falha de start (DOWN é mais grave que STOPPED); depois "rodando mas sem produzir"
 * (DEGRADED/STUCK), que é o caso que passava invisível.
 *
 * @param {object} observation
 * @param {boolean} observation.enabledByPolicy   a política habilita este worker?
 * @param {boolean} observation.started           o start foi executado com sucesso (tem timer)?
 * @param {string|null} observation.startError    erro do start, se houve
 * @param {number|null} observation.startedAtMs   quando foi iniciado
 * @param {number|null} observation.nowMs         agora (injetado)
 * @param {number|null} observation.lastCycleAtMs  último ciclo (sucesso OU falha)
 * @param {number|null} observation.lastSuccessAtMs último ciclo BEM-SUCEDIDO
 * @param {number} observation.consecutiveErrors  erros consecutivos
 * @param {number} observation.staleAfterMs       silêncio tolerado antes de STUCK
 * @returns {{state:string, code:string|null, reason:string, stuck:boolean, healthy:boolean}}
 */
function deriveWorkerState({
  enabledByPolicy = true,
  started = false,
  startError = null,
  startedAtMs = null,
  nowMs = null,
  lastCycleAtMs = null,
  lastSuccessAtMs = null,
  consecutiveErrors = 0,
  staleAfterMs = 120000,
  consecutiveErrorThreshold = DEFAULT_CONSECUTIVE_ERROR_THRESHOLD,
} = {}) {
  const detail = { stuck: false, healthy: false };

  if (!enabledByPolicy) {
    return { ...detail, health: 'DISABLED_BY_POLICY', code: 'WORKER_DISABLED_BY_POLICY', reason: 'worker desabilitado por política explícita — ausência declarada, não falha' };
  }
  if (startError) {
    return { ...detail, health: 'DOWN', code: 'WORKER_START_FAILED', reason: `o start do worker falhou e o subsistema seguiu como se estivesse saudável: ${startError}` };
  }
  if (!started) {
    return { ...detail, health: 'STOPPED', code: 'WORKER_NOT_STARTED', reason: 'worker não iniciado (e nenhuma falha de start registrada)' };
  }

  const errors = Number(consecutiveErrors) || 0;
  const now = Number.isFinite(nowMs) ? Number(nowMs) : null;

  // STUCK: o processo está vivo (timer ativo) mas não produz ciclos dentro da janela tolerada.
  // É o caso mais enganoso: "está rodando" e não faz nada.
  const reference = lastCycleAtMs !== null && lastCycleAtMs !== undefined ? Number(lastCycleAtMs) : null;
  const baseline = reference !== null ? reference : (startedAtMs !== null && startedAtMs !== undefined ? Number(startedAtMs) : null);
  if (now !== null && baseline !== null && Number(staleAfterMs) > 0 && (now - baseline) > Number(staleAfterMs)) {
    const silentMs = now - baseline;
    return {
      stuck: true,
      healthy: false,
      health: 'DEGRADED',
      code: 'WORKER_STUCK_NO_CYCLES',
      reason: `worker vivo mas sem ciclos há ${Math.round(silentMs / 1000)}s (tolerado: ${Math.round(Number(staleAfterMs) / 1000)}s) — processo de pé não é o mesmo que capacidade funcionando`,
      silentMs,
    };
  }

  if (errors >= Number(consecutiveErrorThreshold)) {
    return {
      ...detail,
      health: 'DEGRADED',
      code: 'WORKER_CONSECUTIVE_ERRORS',
      reason: `${errors} ciclos consecutivos com erro (limite ${consecutiveErrorThreshold}) — o worker roda, mas não conclui trabalho`,
    };
  }

  // SAUDÁVEL. `lastSuccessAtMs` é informativo: um worker vivo que ainda não teve nenhum ciclo
  // bem-sucedido não é automaticamente degradado (o primeiro ciclo pode não ter acontecido ainda) —
  // o que o degrada é o SILÊNCIO, medido acima.
  return {
    stuck: false,
    healthy: true,
    health: 'RUNNING',
    code: null,
    reason: lastSuccessAtMs
      ? 'worker iniciado e produzindo ciclos dentro do esperado'
      : 'worker iniciado e dentro da janela do primeiro ciclo',
  };
}

/**
 * Prontidão do subsistema de engenharia a partir da saúde dos workers OBRIGATÓRIOS.
 *
 * `requiredWorkers` são os que o subsistema NÃO funciona sem. Um worker obrigatório DOWN torna a
 * prontidão NO_GO; um DEGRADED torna DEGRADED. Sem obrigatórios, GREEN.
 *
 * O ponto é a DIREÇÃO da falha: enquanto o subsistema de engenharia estiver ativo, ele não pode se
 * declarar verde sem as peças que o fazem funcionar.
 */
function assessEngineeringReadiness({ requiredWorkers = [], engineerRouterEnabled = true } = {}) {
  if (engineerRouterEnabled !== true) {
    return { readiness: 'GREEN', code: null, reason: 'subsistema de engenharia desabilitado — nenhum worker é obrigatório', blocking: [], degraded: [] };
  }

  const blocking = [];
  const degraded = [];
  for (const worker of Array.isArray(requiredWorkers) ? requiredWorkers : []) {
    const health = String((worker && (worker.health || worker.state)) || '').toUpperCase();
    const type = (worker && worker.type) || 'UNKNOWN';
    if (health === 'DOWN') blocking.push({ type, health, code: worker.code || null, reason: worker.reason || null });
    else if (health === 'DEGRADED' || health === 'STOPPED') degraded.push({ type, health, code: worker.code || null, reason: worker.reason || null });
  }

  if (blocking.length > 0) {
    return {
      readiness: 'NO_GO',
      code: 'ENGINEERING_REQUIRED_WORKER_DOWN',
      reason: `worker(s) obrigatório(s) fora do ar: ${blocking.map((b) => b.type).join(', ')} — o subsistema de engenharia não pode aparecer saudável sem eles`,
      blocking,
      degraded,
    };
  }
  if (degraded.length > 0) {
    return {
      readiness: 'DEGRADED',
      code: 'ENGINEERING_REQUIRED_WORKER_DEGRADED',
      reason: `worker(s) obrigatório(s) degradado(s): ${degraded.map((d) => d.type).join(', ')}`,
      blocking,
      degraded,
    };
  }
  return { readiness: 'GREEN', code: null, reason: 'todos os workers obrigatórios saudáveis', blocking: [], degraded: [] };
}

module.exports = {
  WORKER_STATES,
  ENGINEERING_READINESS,
  DEFAULT_CONSECUTIVE_ERROR_THRESHOLD,
  deriveWorkerState,
  assessEngineeringReadiness,
};
