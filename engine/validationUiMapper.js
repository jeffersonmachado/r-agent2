/**
 * Mapeamento de erros de validação de fluxo (FlowValidationError)
 * para erros exibíveis no editor visual.
 *
 * Objetivos:
 * - Traduzir códigos e detalhes internos em mensagens amigáveis.
 * - Apontar claramente os nós envolvidos em cada problema.
 * - NÃO expor detalhes internos de implementação (stack traces,
 *   mensagens técnicas, etc.).
 */

/**
 * @typedef {import('./validator').FlowValidationError} FlowValidationError
 */

/**
 * Representa um erro pronto para ser exibido no editor visual.
 *
 * Decisões de contrato:
 * - nodeIds: lista de ids de nós que o editor pode destacar.
 * - message: texto amigável, em linguagem de produto, não técnica.
 * - severity: nível de severidade (ex.: "error", "warning", "info").
 * - code: código estável para possíveis localizações/traduções.
 *
 * @typedef {Object} UiValidationError
 * @property {string} code
 * @property {string} message
 * @property {("error"|"warning"|"info")} severity
 * @property {string[]} nodeIds
 */

/**
 * Mapeia um único FlowValidationError em um UiValidationError.
 *
 * Importante:
 * - Nunca usamos "details" diretamente na mensagem, apenas para
 *   enriquecer a formatação, se fizer sentido.
 * - Mensagens são estáveis e amigáveis, adequadas para UI.
 *
 * @param {FlowValidationError} err
 * @returns {UiValidationError}
 */
function mapFlowErrorToUiError(err) {
  const nodeIds = Array.isArray(err.nodeIds) ? err.nodeIds : [];

  switch (err.code) {
    case 'NODE_DISCONNECTED': {
      const count = nodeIds.length;
      const message =
        count === 1
          ? 'Existe um nó que nunca será alcançado a partir do início do fluxo. Verifique as conexões.'
          : 'Existem nós que nunca serão alcançados a partir do início do fluxo. Verifique as conexões.';

      return {
        code: err.code,
        message,
        severity: 'error',
        nodeIds,
      };
    }

    case 'INVALID_LOOP': {
      const message =
        'Foi detectado um loop no fluxo que pode causar execuções infinitas. Ajuste as conexões para evitar ciclos.';

      return {
        code: err.code,
        message,
        severity: 'error',
        nodeIds,
      };
    }

    case 'TYPE_INCOMPATIBLE': {
      const message =
        'Uma conexão entre nós é incompatível com as regras do fluxo. Revise o tipo dos nós conectados.';

      return {
        code: err.code,
        message,
        severity: 'error',
        nodeIds,
      };
    }

    case 'NODE_TARGET_MISSING': {
      const message =
        'Uma conexão aponta para um nó que não existe. Verifique se todos os nós referenciados estão presentes no fluxo.';

      return {
        code: err.code,
        message,
        severity: 'error',
        nodeIds,
      };
    }

    case 'DUPLICATE_NODE_ID': {
      const count = nodeIds.length;
      const message =
        count === 1
          ? 'Existe um nó com ID duplicado. Cada nó deve ter um ID único.'
          : 'Existem nós com IDs duplicados. Cada nó deve ter um ID único.';

      return {
        code: err.code,
        message,
        severity: 'error',
        nodeIds,
      };
    }

    case 'MISSING_START_NODE': {
      return {
        code: err.code,
        message: 'O fluxo deve ter pelo menos um nó do tipo "start" para definir o ponto de entrada.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'MISSING_END_NODE': {
      return {
        code: err.code,
        message: 'O fluxo deve ter pelo menos um nó do tipo "end" para definir o ponto de saída.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'INVALID_FLOW_STRUCTURE':
    case 'INVALID_NODES_ARRAY':
    case 'EMPTY_FLOW':
    case 'FLOW_TOO_LARGE': {
      return {
        code: err.code,
        message: err.message || 'A estrutura do fluxo é inválida.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'INVALID_FLOW_ID':
    case 'INVALID_TENANT_ID':
    case 'INVALID_VERSION': {
      return {
        code: err.code,
        message: err.message || 'Os metadados do fluxo são inválidos.',
        severity: 'error',
        nodeIds: [],
      };
    }

    case 'INVALID_NODE_STRUCTURE':
    case 'INVALID_NODE_ID':
    case 'INVALID_NODE_TYPE':
    case 'UNKNOWN_NODE_TYPE': {
      return {
        code: err.code,
        message: err.message || 'Um ou mais nós têm estrutura inválida.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'MESSAGE_MISSING_CONFIG':
    case 'MESSAGE_MISSING_TEXT':
    case 'MESSAGE_EMPTY_TEXT':
    case 'MESSAGE_TEXT_TOO_LONG': {
      return {
        code: err.code,
        message: err.message || 'O nó de mensagem está configurado incorretamente.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'USER_INPUT_INVALID_VARIABLE':
    case 'USER_INPUT_INVALID_VARIABLE_NAME': {
      return {
        code: err.code,
        message: err.message || 'O nó de entrada do usuário tem configuração inválida.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'ROUTER_MISSING_CONFIG':
    case 'ROUTER_MISSING_RULES':
    case 'ROUTER_EMPTY_RULES':
    case 'ROUTER_INVALID_RULE':
    case 'ROUTER_RULE_MISSING_CONDITION':
    case 'ROUTER_INVALID_OPERATOR':
    case 'ROUTER_RULE_MISSING_VAR':
    case 'ROUTER_RULE_MISSING_NEXT': {
      return {
        code: err.code,
        message: err.message || 'O nó roteador está configurado incorretamente.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'SET_VARIABLE_MISSING_CONFIG':
    case 'SET_VARIABLE_MISSING_ASSIGNMENTS':
    case 'SET_VARIABLE_INVALID_NAME': {
      return {
        code: err.code,
        message: err.message || 'O nó de variável está configurado incorretamente.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'HANDOFF_INVALID_QUEUE': {
      return {
        code: err.code,
        message: err.message || 'O nó de handoff tem configuração inválida.',
        severity: 'error',
        nodeIds,
      };
    }

    case 'AI_MISSING_CONFIG':
    case 'AI_MISSING_PROMPT_TEMPLATE':
    case 'AI_EMPTY_PROMPT_TEMPLATE':
    case 'AI_PROMPT_TOO_LONG':
    case 'AI_INVALID_OUTPUT_VARIABLE':
    case 'AI_INVALID_OUTPUT_VARIABLE_NAME': {
      return {
        code: err.code,
        message: err.message || 'O nó de IA está configurado incorretamente.',
        severity: 'error',
        nodeIds,
      };
    }

    default: {
      // Fallback genérico para futuros códigos de erro.
      return {
        code: err.code || 'UNKNOWN',
        message: err.message || 'Foi encontrado um problema na definição do fluxo. Revise a configuração dos nós destacados.',
        severity: 'error',
        nodeIds,
      };
    }
  }
}

/**
 * Mapeia uma lista de FlowValidationError para erros exibíveis na UI.
 *
 * @param {FlowValidationError[]} errors
 * @returns {UiValidationError[]}
 */
function mapFlowValidationErrorsToUi(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => mapFlowErrorToUiError(e));
}

module.exports = {
  mapFlowValidationErrorsToUi,
  mapFlowErrorToUiError,
};


