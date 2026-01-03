/**
 * Códigos de erro centralizados e estáveis do sistema.
 * 
 * Este arquivo define todos os códigos de erro usados no sistema,
 * garantindo consistência e facilitando classificação e diagnóstico.
 * 
 * REGRAS:
 * - Códigos são strings estáveis (não mudam entre versões)
 * - Prefixos indicam origem: FLOW_, ENGINE_, DATA_, SCRIPT_, RPA_
 * - Cada código deve ter mensagem clara e tipo de falha associado
 */

/**
 * @typedef {Object} ErrorCodeDefinition
 * @property {string} code - Código único do erro
 * @property {string} category - Categoria: 'FLOW', 'ENGINE', 'DATA', 'SCRIPT', 'RPA'
 * @property {string} type - Tipo de falha: 'FALHA_ESTRUTURAL', 'FALHA_DE_DADOS', 'FALHA_DE_FLUXO', 'FALHA_E2E'
 * @property {string} description - Descrição do erro
 */

/**
 * Mapa de códigos de erro com suas definições.
 */
const ERROR_CODES = {
  // ============================================
  // ERROS DE VALIDAÇÃO DE FLUXO (FLOW_*)
  // ============================================
  FLOW_ERROR_START_INVALID: {
    code: 'FLOW_ERROR_START_INVALID',
    category: 'FLOW',
    type: 'FALHA_ESTRUTURAL',
    description: 'Nó start inválido (múltiplos starts ou start sem next)',
  },
  FLOW_ERROR_ROUTER_NO_FALLBACK: {
    code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
    category: 'FLOW',
    type: 'FALHA_ESTRUTURAL',
    description: 'Router sem fallback explícito (sem regra always e sem defaultNext)',
  },
  FLOW_ERROR_SET_VARIABLE_INVALID: {
    code: 'FLOW_ERROR_SET_VARIABLE_INVALID',
    category: 'FLOW',
    type: 'FALHA_ESTRUTURAL',
    description: 'Set variable com configuração inválida (varName vazio ou value undefined)',
  },
  FLOW_ERROR_USER_INPUT_INVALID: {
    code: 'FLOW_ERROR_USER_INPUT_INVALID',
    category: 'FLOW',
    type: 'FALHA_ESTRUTURAL',
    description: 'User input com configuração inválida (outputVar vazio)',
  },
  FLOW_ERROR_MESSAGE_EMPTY: {
    code: 'FLOW_ERROR_MESSAGE_EMPTY',
    category: 'FLOW',
    type: 'FALHA_ESTRUTURAL',
    description: 'Message com texto vazio',
  },
  FLOW_ERROR_END_HAS_OUTPUTS: {
    code: 'FLOW_ERROR_END_HAS_OUTPUTS',
    category: 'FLOW',
    type: 'FALHA_ESTRUTURAL',
    description: 'Nó end não pode ter saídas (deve ser folha)',
  },

  // ============================================
  // ERROS DE RUNTIME (ENGINE_*)
  // ============================================
  ENGINE_ROUTER_NO_MATCH: {
    code: 'ENGINE_ROUTER_NO_MATCH',
    category: 'ENGINE',
    type: 'FALHA_DE_FLUXO',
    description: 'Router não encontrou regra correspondente e não tem fallback',
  },
  ENGINE_START_MISSING_NEXT: {
    code: 'ENGINE_START_MISSING_NEXT',
    category: 'ENGINE',
    type: 'FALHA_DE_FLUXO',
    description: 'Start node sem campo next definido',
  },
  ENGINE_USER_INPUT_MISSING: {
    code: 'ENGINE_USER_INPUT_MISSING',
    category: 'ENGINE',
    type: 'FALHA_DE_FLUXO',
    description: 'User input não recebeu input do usuário',
  },
  ENGINE_SET_VARIABLE_INVALID_VALUE: {
    code: 'ENGINE_SET_VARIABLE_INVALID_VALUE',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Set variable tentou setar valor inválido',
  },
  ENGINE_MESSAGE_EMPTY_TEXT: {
    code: 'ENGINE_MESSAGE_EMPTY_TEXT',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Message node com texto vazio',
  },
  ENGINE_MESSAGE_RENDER_ERROR: {
    code: 'ENGINE_MESSAGE_RENDER_ERROR',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Erro ao renderizar template de mensagem',
  },
  ENGINE_END_EXECUTED: {
    code: 'ENGINE_END_EXECUTED',
    category: 'ENGINE',
    type: 'FALHA_DE_FLUXO',
    description: 'Tentativa de executar após nó end (conversa já finalizada)',
  },
  ENGINE_END_HAS_OUTPUTS: {
    code: 'ENGINE_END_HAS_OUTPUTS',
    category: 'ENGINE',
    type: 'FALHA_ESTRUTURAL',
    description: 'Nó end não pode ter saídas (deve ser folha)',
  },
  ENGINE_DELAY_INVALID_DURATION: {
    code: 'ENGINE_DELAY_INVALID_DURATION',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Delay node com duração inválida (não positiva)',
  },
  ENGINE_SET_VARIABLE_INVALID: {
    code: 'ENGINE_SET_VARIABLE_INVALID',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Set variable com configuração inválida',
  },
  ENGINE_SET_VARIABLE_INVALID_NAME: {
    code: 'ENGINE_SET_VARIABLE_INVALID_NAME',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Set variable com nome de variável inválido',
  },
  ENGINE_SET_VARIABLE_UNDEFINED_VALUE: {
    code: 'ENGINE_SET_VARIABLE_UNDEFINED_VALUE',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Set variable tentou setar valor undefined',
  },
  ENGINE_USER_INPUT_INVALID_CONFIG: {
    code: 'ENGINE_USER_INPUT_INVALID_CONFIG',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'User input com configuração inválida',
  },
  ENGINE_USER_INPUT_TYPE_MISMATCH: {
    code: 'ENGINE_USER_INPUT_TYPE_MISMATCH',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'User input recebeu tipo diferente do esperado',
  },
  ENGINE_MESSAGE_EMPTY_RENDERED: {
    code: 'ENGINE_MESSAGE_EMPTY_RENDERED',
    category: 'ENGINE',
    type: 'FALHA_DE_DADOS',
    description: 'Message node renderizou texto vazio',
  },

  // ============================================
  // ERROS DE VALIDAÇÃO DE DADOS (DATA_*)
  // ============================================
  DATA_VALIDATION_FAILED: {
    code: 'DATA_VALIDATION_FAILED',
    category: 'DATA',
    type: 'FALHA_DE_DADOS',
    description: 'Validação de dados do sistema falhou',
  },
  DATA_MISSING_REQUIRED: {
    code: 'DATA_MISSING_REQUIRED',
    category: 'DATA',
    type: 'FALHA_DE_DADOS',
    description: 'Dados obrigatórios faltando no sistema',
  },

  // ============================================
  // ERROS DE SCRIPTS (SCRIPT_*)
  // ============================================
  SCRIPT_REQUIREMENT_FAILED: {
    code: 'SCRIPT_REQUIREMENT_FAILED',
    category: 'SCRIPT',
    type: 'FALHA_DE_DADOS',
    description: 'Script não pode ser executado: dependências faltando',
  },
  SCRIPT_EXECUTION_FAILED: {
    code: 'SCRIPT_EXECUTION_FAILED',
    category: 'SCRIPT',
    type: 'FALHA_DE_FLUXO',
    description: 'Falha na execução do script de conversa',
  },

  // ============================================
  // ERROS DE RPA (RPA_*)
  // ============================================
  RPA_E2E_FAILED: {
    code: 'RPA_E2E_FAILED',
    category: 'RPA',
    type: 'FALHA_E2E',
    description: 'Teste E2E RPA falhou (caixa-preta)',
  },
  RPA_REPLAY_FAILED: {
    code: 'RPA_REPLAY_FAILED',
    category: 'RPA',
    type: 'FALHA_E2E',
    description: 'Replay de execução RPA falhou',
  },
  RPA_ACTION_FAILED: {
    code: 'RPA_ACTION_FAILED',
    category: 'RPA',
    type: 'FALHA_E2E',
    description: 'Ação RPA falhou durante execução',
  },
  RPA_ELEMENT_NOT_FOUND: {
    code: 'RPA_ELEMENT_NOT_FOUND',
    category: 'RPA',
    type: 'FALHA_E2E',
    description: 'Elemento não encontrado na página',
  },
  RPA_SCREEN_MISMATCH: {
    code: 'RPA_SCREEN_MISMATCH',
    category: 'RPA',
    type: 'FALHA_E2E',
    description: 'Tela não corresponde ao esperado',
  },
  RPA_TIMEOUT: {
    code: 'RPA_TIMEOUT',
    category: 'RPA',
    type: 'FALHA_E2E',
    description: 'Timeout na execução RPA',
  },
};

/**
 * Classifica um erro em uma das categorias principais.
 * 
 * @param {string|Error} error - Código de erro ou objeto Error
 * @returns {string} Tipo de falha: 'FALHA_ESTRUTURAL', 'FALHA_DE_DADOS', 'FALHA_DE_FLUXO', 'FALHA_E2E'
 */
function classifyErrorType(error) {
  const errorCode = typeof error === 'string' ? error : (error.code || error.message);
  
  if (!errorCode) {
    return 'FALHA_ESTRUTURAL'; // Default
  }

  const definition = ERROR_CODES[errorCode];
  if (definition) {
    return definition.type;
  }

  // Heurística baseada em prefixo
  if (errorCode.startsWith('FLOW_')) {
    return 'FALHA_ESTRUTURAL';
  }
  if (errorCode.startsWith('ENGINE_ROUTER_') || errorCode.startsWith('ENGINE_START_') || errorCode.startsWith('ENGINE_END_') || errorCode.startsWith('ENGINE_USER_INPUT_')) {
    return 'FALHA_DE_FLUXO';
  }
  if (errorCode.startsWith('ENGINE_SET_VARIABLE_') || errorCode.startsWith('ENGINE_MESSAGE_') || errorCode.startsWith('ENGINE_DELAY_')) {
    return 'FALHA_DE_DADOS';
  }
  if (errorCode.startsWith('DATA_') || errorCode.startsWith('SCRIPT_')) {
    return 'FALHA_DE_DADOS';
  }
  if (errorCode.startsWith('RPA_')) {
    return 'FALHA_E2E';
  }

  return 'FALHA_ESTRUTURAL'; // Default
}

/**
 * Obtém definição completa de um código de erro.
 * 
 * @param {string} code - Código do erro
 * @returns {ErrorCodeDefinition|null}
 */
function getErrorDefinition(code) {
  return ERROR_CODES[code] || null;
}

/**
 * Verifica se um código de erro é conhecido.
 * 
 * @param {string} code - Código do erro
 * @returns {boolean}
 */
function isKnownErrorCode(code) {
  return code in ERROR_CODES;
}

module.exports = {
  ERROR_CODES,
  classifyErrorType,
  getErrorDefinition,
  isKnownErrorCode,
};

