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

    default: {
      // Fallback genérico para futuros códigos de erro.
      return {
        code: err.code || 'UNKNOWN',
        message: 'Foi encontrado um problema na definição do fluxo. Revise a configuração dos nós destacados.',
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


