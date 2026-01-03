/**
 * Classificador de erros para testes.
 * 
 * Classifica erros em categorias padronizadas:
 * - FALHA_ESTRUTURAL: Erros detectados na validação estática (não chegam ao runtime)
 * - FALHA_DE_DADOS: Erros de validação, tipos incompatíveis, valores inválidos
 * - FALHA_DE_FLUXO: Erros de roteamento, estrutura de fluxo, nós faltando
 * 
 * Frase-guia: "Fluxos inválidos não devem executar. Falhas devem ser explícitas, cedo e diagnosticáveis."
 */

/**
 * Códigos de erro de validação estrutural (FLOW_ERROR_*)
 */
const FLOW_ERROR_CODES = [
  'INVALID_FLOW_STRUCTURE',
  'INVALID_NODES_ARRAY',
  'EMPTY_FLOW',
  'FLOW_TOO_LARGE',
  'INVALID_FLOW_ID',
  'INVALID_TENANT_ID',
  'INVALID_VERSION',
  'INVALID_NODE_STRUCTURE',
  'INVALID_NODE_ID',
  'INVALID_NODE_TYPE',
  'UNKNOWN_NODE_TYPE',
  'NODE_DISCONNECTED',
  'INVALID_LOOP',
  'TYPE_INCOMPATIBLE',
  'NODE_TARGET_MISSING',
  'DUPLICATE_NODE_ID',
  'MISSING_START_NODE',
  'MULTIPLE_START_NODES',
  'MISSING_END_NODE',
  'START_MISSING_NEXT',
  'END_HAS_OUTPUTS',
  'MESSAGE_MISSING_CONFIG',
  'MESSAGE_MISSING_TEXT',
  'MESSAGE_EMPTY_TEXT',
  'MESSAGE_TEXT_TOO_LONG',
  'USER_INPUT_MISSING_CONFIG',
  'USER_INPUT_INVALID_VARIABLE',
  'USER_INPUT_INVALID_VARIABLE_NAME',
  'USER_INPUT_INVALID_TYPE',
  'ROUTER_MISSING_CONFIG',
  'ROUTER_MISSING_RULES',
  'ROUTER_EMPTY_RULES',
  'ROUTER_INVALID_RULE',
  'ROUTER_RULE_MISSING_CONDITION',
  'ROUTER_INVALID_OPERATOR',
  'ROUTER_RULE_MISSING_VAR',
  'ROUTER_RULE_MISSING_NEXT',
  'ROUTER_MISSING_FALLBACK',
  'SET_VARIABLE_MISSING_CONFIG',
  'SET_VARIABLE_MISSING_ASSIGNMENTS',
  'SET_VARIABLE_INVALID_NAME',
  'SET_VARIABLE_EMPTY_ASSIGNMENTS',
  'SET_VARIABLE_UNDEFINED_VALUE',
];

/**
 * Códigos de erro de runtime de dados (ENGINE_* relacionados a dados)
 */
const DATA_ERROR_CODES = [
  'ENGINE_SET_VARIABLE_INVALID',
  'ENGINE_SET_VARIABLE_INVALID_NAME',
  'ENGINE_SET_VARIABLE_UNDEFINED_VALUE',
  'ENGINE_MESSAGE_EMPTY_TEXT',
  'ENGINE_MESSAGE_RENDER_ERROR',
  'ENGINE_MESSAGE_EMPTY_RENDERED',
  'ENGINE_USER_INPUT_INVALID_CONFIG',
  'ENGINE_USER_INPUT_TYPE_MISMATCH',
  'ENGINE_DELAY_INVALID_DURATION',
  'ENGINE_DELAY_DURATION_TOO_LONG',
  'DATA_VALIDATION_FAILED',
];

/**
 * Códigos de erro de runtime de fluxo (ENGINE_* relacionados a fluxo)
 */
const FLOW_ERROR_CODES_RUNTIME = [
  'ENGINE_ROUTER_NO_MATCH',
  'ENGINE_START_MISSING_NEXT',
  'ENGINE_END_HAS_OUTPUTS',
  'ENGINE_USER_INPUT_MISSING',
];

/**
 * Classifica um erro em uma categoria padronizada.
 * 
 * @param {Error|Object} error - Erro a classificar
 * @returns {string} Categoria: 'FALHA_ESTRUTURAL', 'FALHA_DE_DADOS', 'FALHA_DE_FLUXO', ou 'FALHA_DESCONHECIDA'
 */
function classifyError(error) {
  if (!error) {
    return 'FALHA_DESCONHECIDA';
  }

  const code = error.code || error.errorCode || null;
  if (!code) {
    // Tenta classificar por tipo se disponível
    if (error.type === 'flow') {
      return 'FALHA_DE_FLUXO';
    }
    if (error.type === 'data') {
      return 'FALHA_DE_DADOS';
    }
    if (error.type === 'system') {
      return 'FALHA_DESCONHECIDA';
    }
    return 'FALHA_DESCONHECIDA';
  }

  // Classifica por código
  if (FLOW_ERROR_CODES.includes(code)) {
    return 'FALHA_ESTRUTURAL';
  }

  if (DATA_ERROR_CODES.includes(code)) {
    return 'FALHA_DE_DADOS';
  }

  if (FLOW_ERROR_CODES_RUNTIME.includes(code)) {
    return 'FALHA_DE_FLUXO';
  }

  // Classifica por prefixo
  if (code.startsWith('FLOW_ERROR_') || code.startsWith('INVALID_') || code.startsWith('MISSING_') || code.startsWith('NODE_')) {
    return 'FALHA_ESTRUTURAL';
  }

  if (code.startsWith('ENGINE_SET_VARIABLE_') || code.startsWith('ENGINE_MESSAGE_') || code.startsWith('ENGINE_DELAY_')) {
    return 'FALHA_DE_DADOS';
  }

  if (code.startsWith('ENGINE_ROUTER_') || code.startsWith('ENGINE_START_') || code.startsWith('ENGINE_END_') || code.startsWith('ENGINE_USER_INPUT_MISSING')) {
    return 'FALHA_DE_FLUXO';
  }

  if (code === 'DATA_VALIDATION_FAILED') {
    return 'FALHA_DE_DADOS';
  }

  return 'FALHA_DESCONHECIDA';
}

/**
 * Cria diagnóstico estruturado de um erro.
 * 
 * @param {Error|Object} error - Erro a diagnosticar
 * @returns {Object} Diagnóstico estruturado
 */
function diagnoseError(error) {
  const category = classifyError(error);
  const code = error.code || error.errorCode || 'UNKNOWN';
  const message = error.message || String(error);
  const nodeId = error.nodeId || null;
  const nodeType = error.nodeType || null;

  return {
    category,
    code,
    message,
    nodeId,
    nodeType,
    details: error.details || error.variablesSnapshot || null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Classifica múltiplos erros e retorna resumo.
 * 
 * @param {Array<Error|Object>} errors - Lista de erros
 * @returns {Object} Resumo da classificação
 */
function classifyErrors(errors) {
  const classification = {
    FALHA_ESTRUTURAL: [],
    FALHA_DE_DADOS: [],
    FALHA_DE_FLUXO: [],
    FALHA_DESCONHECIDA: [],
  };

  for (const error of errors) {
    const category = classifyError(error);
    classification[category].push(diagnoseError(error));
  }

  return {
    classification,
    summary: {
      total: errors.length,
      estrutural: classification.FALHA_ESTRUTURAL.length,
      dados: classification.FALHA_DE_DADOS.length,
      fluxo: classification.FALHA_DE_FLUXO.length,
      desconhecida: classification.FALHA_DESCONHECIDA.length,
    },
  };
}

module.exports = {
  classifyError,
  diagnoseError,
  classifyErrors,
};

