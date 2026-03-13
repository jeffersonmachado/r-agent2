/**
 * Tipos canônicos suportados nesta fase.
 *
 * A camada canônica não substitui o editor nem a engine atual.
 * Ela atua como um formato intermediário estável para:
 * - validação semântica
 * - adapters de import/export
 * - compilação determinística para runtime
 * - futuras integrações com BPMN e IA de autoria
 */

/**
 * Tipo canônico de entrada.
 * Representa o ponto de entrada do processo.
 */
export const CANONICAL_START = 'start';

/**
 * Tipo canônico terminal.
 * Representa encerramento explícito do processo.
 */
export const CANONICAL_END = 'end';

/**
 * Tipo canônico para chamadas de serviço/API.
 */
export const CANONICAL_TASK_SERVICE = 'task.service';

/**
 * Tipo canônico para tarefas orientadas por IA/RAG/classificação.
 */
export const CANONICAL_TASK_AI = 'task.ai';

/**
 * Tipo canônico para tarefas determinísticas/script/configuração.
 */
export const CANONICAL_TASK_SCRIPT = 'task.script';

/**
 * Tipo canônico para interação humana ou handoff operacional.
 */
export const CANONICAL_TASK_USER = 'task.user';

/**
 * Tipo canônico para envio explícito de mensagem.
 */
export const CANONICAL_TASK_MESSAGE_SEND = 'task.message.send';

/**
 * Tipo canônico para recebimento/captura de entrada do usuário.
 */
export const CANONICAL_TASK_MESSAGE_RECEIVE = 'task.message.receive';

/**
 * Tipo canônico para gateways de decisão.
 */
export const CANONICAL_GATEWAY_EXCLUSIVE = 'gateway.exclusive';

/**
 * Tipo canônico para esperas temporais e delays.
 */
export const CANONICAL_WAIT_TIMER = 'wait.timer';

/**
 * Tipo canônico para chamada de subprocesso/subflow.
 */
export const CANONICAL_CALL_SUBPROCESS = 'call.subprocess';

/**
 * Tipo canônico para fallback explícito.
 */
export const CANONICAL_FALLBACK = 'fallback';

/**
 * Tipo canônico para atribuição de variáveis.
 */
export const CANONICAL_VARIABLE_SET = 'variable.set';

/**
 * Tipo canônico para transformações utilitárias.
 */
export const CANONICAL_UTILITY_TRANSFORM = 'utility.transform';

/**
 * Tipo canônico para acesso a horário/data.
 */
export const CANONICAL_UTILITY_TIME = 'utility.time';

/**
 * Tipo canônico para geração de UUID.
 */
export const CANONICAL_UTILITY_UUID = 'utility.uuid';

/**
 * Tipo canônico para geração randômica.
 */
export const CANONICAL_UTILITY_RANDOM = 'utility.random';

export const CANONICAL_NODE_TYPES = [
  CANONICAL_START,
  CANONICAL_END,
  CANONICAL_TASK_SERVICE,
  CANONICAL_TASK_AI,
  CANONICAL_TASK_SCRIPT,
  CANONICAL_TASK_USER,
  CANONICAL_TASK_MESSAGE_SEND,
  CANONICAL_TASK_MESSAGE_RECEIVE,
  CANONICAL_GATEWAY_EXCLUSIVE,
  CANONICAL_WAIT_TIMER,
  CANONICAL_CALL_SUBPROCESS,
  CANONICAL_FALLBACK,
  CANONICAL_VARIABLE_SET,
  CANONICAL_UTILITY_TRANSFORM,
  CANONICAL_UTILITY_TIME,
  CANONICAL_UTILITY_UUID,
  CANONICAL_UTILITY_RANDOM,
];

const NODE_TYPE_TO_CANONICAL_TYPE = {
  start: CANONICAL_START,
  end: CANONICAL_END,
  message: CANONICAL_TASK_MESSAGE_SEND,
  user_input: CANONICAL_TASK_MESSAGE_RECEIVE,
  router: CANONICAL_GATEWAY_EXCLUSIVE,
  semantic_router: CANONICAL_GATEWAY_EXCLUSIVE,
  schedule_router: CANONICAL_GATEWAY_EXCLUSIVE,
  options: CANONICAL_GATEWAY_EXCLUSIVE,
  voice_branch: CANONICAL_GATEWAY_EXCLUSIVE,
  ai_task: CANONICAL_TASK_AI,
  ai: CANONICAL_TASK_AI,
  rag_answer: CANONICAL_TASK_AI,
  business_entry: CANONICAL_TASK_AI,
  api: CANONICAL_TASK_SERVICE,
  get_flow_info: CANONICAL_TASK_SERVICE,
  get_queue_status: CANONICAL_TASK_SERVICE,
  get_config_value: CANONICAL_TASK_SERVICE,
  list_flows: CANONICAL_TASK_SERVICE,
  get_user_info: CANONICAL_TASK_SERVICE,
  set_variable: CANONICAL_VARIABLE_SET,
  merge: CANONICAL_UTILITY_TRANSFORM,
  handoff: CANONICAL_TASK_USER,
  subflow: CANONICAL_CALL_SUBPROCESS,
  fallback: CANONICAL_FALLBACK,
  get_current_time: CANONICAL_UTILITY_TIME,
  generate_uuid: CANONICAL_UTILITY_UUID,
  delay: CANONICAL_WAIT_TIMER,
  format_date: CANONICAL_UTILITY_TRANSFORM,
  random_number: CANONICAL_UTILITY_RANDOM,
  voice_prompt_listen: CANONICAL_TASK_MESSAGE_RECEIVE,
  voice_listen_asr: CANONICAL_TASK_MESSAGE_RECEIVE,
  voice_gather_dtmf: CANONICAL_TASK_MESSAGE_RECEIVE,
  voice_transfer_ramal: CANONICAL_TASK_USER,
  voice_transfer_utils: CANONICAL_TASK_USER,
  voice_transfer_fila: CANONICAL_TASK_USER,
  voice_hangup: CANONICAL_END,
};

const CANONICAL_TO_DEFAULT_RETE_TYPE = {
  [CANONICAL_START]: 'start',
  [CANONICAL_END]: 'end',
  [CANONICAL_TASK_SERVICE]: 'api',
  [CANONICAL_TASK_AI]: 'ai_task',
  [CANONICAL_TASK_SCRIPT]: 'ai',
  [CANONICAL_TASK_USER]: 'handoff',
  [CANONICAL_TASK_MESSAGE_SEND]: 'message',
  [CANONICAL_TASK_MESSAGE_RECEIVE]: 'user_input',
  [CANONICAL_GATEWAY_EXCLUSIVE]: 'router',
  [CANONICAL_WAIT_TIMER]: 'delay',
  [CANONICAL_CALL_SUBPROCESS]: 'subflow',
  [CANONICAL_FALLBACK]: 'fallback',
  [CANONICAL_VARIABLE_SET]: 'set_variable',
  [CANONICAL_UTILITY_TRANSFORM]: 'format_date',
  [CANONICAL_UTILITY_TIME]: 'get_current_time',
  [CANONICAL_UTILITY_UUID]: 'generate_uuid',
  [CANONICAL_UTILITY_RANDOM]: 'random_number',
};

const CANONICAL_TO_DEFAULT_ENGINE_TYPE = {
  ...CANONICAL_TO_DEFAULT_RETE_TYPE,
};

export function getCanonicalTypeForNodeType(nodeType) {
  const normalized = String(nodeType || '').trim();
  return NODE_TYPE_TO_CANONICAL_TYPE[normalized] || CANONICAL_UTILITY_TRANSFORM;
}

export function getDefaultReteTypeForCanonicalType(canonicalType) {
  return CANONICAL_TO_DEFAULT_RETE_TYPE[String(canonicalType || '')] || 'message';
}

export function getDefaultEngineTypeForCanonicalType(canonicalType) {
  return CANONICAL_TO_DEFAULT_ENGINE_TYPE[String(canonicalType || '')] || 'message';
}

export function isCanonicalTerminalType(canonicalType, subtype = '') {
  const normalizedType = String(canonicalType || '').trim();
  const normalizedSubtype = String(subtype || '').trim();
  return normalizedType === CANONICAL_END
    || normalizedType === CANONICAL_FALLBACK
    || normalizedSubtype === 'handoff'
    || normalizedSubtype === 'voice_transfer_ramal'
    || normalizedSubtype === 'voice_transfer_utils'
    || normalizedSubtype === 'voice_transfer_fila'
    || normalizedSubtype === 'voice_hangup';
}
