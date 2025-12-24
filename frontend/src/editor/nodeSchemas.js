/**
 * Schema centralizado de todos os tipos de nós.
 * 
 * Este arquivo é a FONTE ÚNICA DA VERDADE para:
 * - Metadados visuais (ícone, label, cor, descrição)
 * - Schema de propriedades (campos de config)
 * - Regras de validação
 * - Informações sobre inputs/outputs e sockets
 * 
 * Uso:
 * - UI: NodePalette, SidebarProperties
 * - Validação: engine/validator.js
 * - Criação de nós: nodeFactory.js, engineMapper.js
 * - Documentação: docs-criar-fluxo.md
 */

/**
 * @typedef {Object} SocketDefinition
 * @property {string} key - Chave do socket (ex: 'in', 'out')
 * @property {string} label - Label exibido na UI
 * @property {string} socketName - Nome do socket (usado para compatibilidade de tipos)
 */

/**
 * @typedef {Object} NodeProperty
 * @property {string} key - Chave da propriedade no config
 * @property {'text'|'textarea'|'json'|'number'|'boolean'} type - Tipo do campo
 * @property {string} label - Label do campo
 * @property {string} description - Descrição do campo
 * @property {boolean} required - Se o campo é obrigatório
 * @property {any} defaultValue - Valor padrão
 * @property {Function} validate - Função de validação (opcional)
 * @property {string} placeholder - Placeholder do campo
 * @property {number} rows - Número de linhas (para textarea/json)
 * @property {'object'|'array'} expectedType - Tipo esperado para campos JSON
 */

/**
 * @typedef {Object} NodeSchema
 * @property {string} type - Tipo do nó (ex: 'message', 'router')
 * @property {string} label - Label exibido na UI
 * @property {string} icon - Ícone emoji
 * @property {string} color - Cor hexadecimal
 * @property {string} description - Descrição do nó
 * @property {SocketDefinition[]} inputs - Definição dos inputs (sockets)
 * @property {SocketDefinition[]} outputs - Definição dos outputs (sockets)
 * @property {NodeProperty[]} properties - Propriedades do nó (campos de config)
 * @property {Function} validate - Função de validação do nó
 */

/**
 * Nome padrão do socket usado para todos os nós
 */
export const DEFAULT_SOCKET_NAME = 'socket';

/**
 * Validação de variável (nome deve seguir regex)
 */
function validateVariableName(name, nodeId) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return {
      code: 'INVALID_VARIABLE',
      message: `Nome de variável inválido (deve ser string não vazia).`,
    };
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return {
      code: 'INVALID_VARIABLE_NAME',
      message: `Nome de variável inválido (deve começar com letra ou _ e conter apenas letras, números e _).`,
      details: { variable: name },
    };
  }
  return null;
}

/**
 * Schema completo de todos os tipos de nós
 */
export const NODE_SCHEMAS = {
  start: {
    type: 'start',
    label: 'Início',
    icon: '▶',
    color: '#4A90E2',
    description: 'Nó inicial do fluxo. Define o ponto de entrada da conversa.',
    inputs: [], // Nó start não tem input
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [],
    validate(node) {
      const errors = [];
      return errors;
    },
  },

  message: {
    type: 'message',
    label: 'Mensagem',
    icon: '💬',
    color: '#52C9A2',
    description: 'Envia uma mensagem ao usuário. Pode conter texto formatado.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'text',
        type: 'textarea',
        label: 'Texto da mensagem',
        description: 'Mensagem que será enviada ao usuário. Pode conter texto simples ou formatado.',
        required: true,
        placeholder: 'Ex.: Olá! Como posso ajudá-lo hoje?',
        rows: 4,
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'MESSAGE_MISSING_CONFIG',
          message: `Nó de mensagem "${nodeId}" deve ter um campo "config" com o texto da mensagem.`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.text || typeof node.config.text !== 'string') {
        errors.push({
          code: 'MESSAGE_MISSING_TEXT',
          message: `Nó de mensagem "${nodeId}" deve ter "config.text" (string não vazia).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.text.trim().length === 0) {
        errors.push({
          code: 'MESSAGE_EMPTY_TEXT',
          message: `Nó de mensagem "${nodeId}" não pode ter texto vazio.`,
          nodeIds: [nodeId],
        });
      } else if (node.config.text.length > 10000) {
        errors.push({
          code: 'MESSAGE_TEXT_TOO_LONG',
          message: `Nó de mensagem "${nodeId}" excede o limite de 10000 caracteres.`,
          nodeIds: [nodeId],
          details: {
            length: node.config.text.length,
            maxLength: 10000,
          },
        });
      }
      
      return errors;
    },
  },

  user_input: {
    type: 'user_input',
    label: 'Entrada',
    icon: '⌨️',
    color: '#52C9A2',
    description: 'Captura entrada do usuário e armazena em uma variável.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'variable',
        type: 'text',
        label: 'Variável de destino',
        description: 'Nome da variável onde o input do usuário será armazenado. Use apenas letras, números e underscore.',
        required: false,
        defaultValue: 'user_input',
        placeholder: 'Ex.: user_message',
        validate: (value) => {
          if (!value) return null; // Opcional
          return validateVariableName(value);
        },
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (node.config && node.config.variable) {
        const validationError = validateVariableName(node.config.variable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  router: {
    type: 'router',
    label: 'Roteador',
    icon: '🔀',
    color: '#F5A623',
    description: 'Roteia o fluxo baseado em condições e regras definidas.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'rules',
        type: 'json',
        label: 'Regras de Roteamento',
        description: 'Array de regras que determinam o próximo nó. Cada regra tem uma condição e um next. As regras são avaliadas em ordem da primeira para a última.',
        required: true,
        placeholder: `[
  {
    "condition": {
      "op": "contains",
      "var": "user_message",
      "value": "suporte"
    },
    "next": "node-suporte"
  },
  {
    "condition": {
      "op": "always"
    },
    "next": "node-default"
  }
]`,
        rows: 10,
        expectedType: 'array',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'ROUTER_MISSING_CONFIG',
          message: `Nó roteador "${nodeId}" deve ter um campo "config" com regras de roteamento.`,
          nodeIds: [nodeId],
        });
      } else if (!Array.isArray(node.config.rules)) {
        errors.push({
          code: 'ROUTER_MISSING_RULES',
          message: `Nó roteador "${nodeId}" deve ter "config.rules" (array de regras).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.rules.length === 0) {
        errors.push({
          code: 'ROUTER_EMPTY_RULES',
          message: `Nó roteador "${nodeId}" deve ter pelo menos uma regra em "config.rules".`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida cada regra
        for (let i = 0; i < node.config.rules.length; i += 1) {
          const rule = node.config.rules[i];
          if (!rule || typeof rule !== 'object') {
            errors.push({
              code: 'ROUTER_INVALID_RULE',
              message: `Regra ${i + 1} do roteador "${nodeId}" não é um objeto válido.`,
              nodeIds: [nodeId],
              details: { ruleIndex: i },
            });
            continue;
          }

          if (!rule.condition || typeof rule.condition !== 'object') {
            errors.push({
              code: 'ROUTER_RULE_MISSING_CONDITION',
              message: `Regra ${i + 1} do roteador "${nodeId}" deve ter um campo "condition".`,
              nodeIds: [nodeId],
              details: { ruleIndex: i },
            });
          } else {
            const op = rule.condition.op;
            const validOps = ['always', 'equals', 'contains'];
            if (!op || !validOps.includes(op)) {
              errors.push({
                code: 'ROUTER_INVALID_OPERATOR',
                message: `Regra ${i + 1} do roteador "${nodeId}" tem operador inválido. Use: ${validOps.join(', ')}.`,
                nodeIds: [nodeId],
                details: {
                  ruleIndex: i,
                  operator: op,
                  validOperators: validOps,
                },
              });
            }

            if (op !== 'always' && (!rule.condition.var || typeof rule.condition.var !== 'string')) {
              errors.push({
                code: 'ROUTER_RULE_MISSING_VAR',
                message: `Regra ${i + 1} do roteador "${nodeId}" deve ter "condition.var" quando o operador não é "always".`,
                nodeIds: [nodeId],
                details: { ruleIndex: i },
              });
            }
          }

          if (!rule.next || typeof rule.next !== 'string' || rule.next.trim() === '') {
            errors.push({
              code: 'ROUTER_RULE_MISSING_NEXT',
              message: `Regra ${i + 1} do roteador "${nodeId}" deve ter um campo "next" (id do próximo nó).`,
              nodeIds: [nodeId],
              details: { ruleIndex: i },
            });
          }
        }
      }
      
      return errors;
    },
  },

  set_variable: {
    type: 'set_variable',
    label: 'Variável',
    icon: '📝',
    color: '#7B68EE',
    description: 'Define ou atualiza o valor de variáveis do fluxo.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'assignments',
        type: 'json',
        label: 'Atribuições de Variáveis',
        description: 'Objeto JSON onde cada chave é o nome de uma variável e o valor será atribuído a ela. Valores podem ser strings, números, booleanos ou objetos.',
        required: true,
        placeholder: `{
  "intent": "greeting",
  "user_name": "João",
  "count": 0
}`,
        rows: 8,
        expectedType: 'object',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'SET_VARIABLE_MISSING_CONFIG',
          message: `Nó de variável "${nodeId}" deve ter um campo "config" com "assignments".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.assignments || typeof node.config.assignments !== 'object') {
        errors.push({
          code: 'SET_VARIABLE_MISSING_ASSIGNMENTS',
          message: `Nó de variável "${nodeId}" deve ter "config.assignments" (objeto com pares chave-valor).`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida nomes de variáveis
        for (const varName of Object.keys(node.config.assignments)) {
          const validationError = validateVariableName(varName, nodeId);
          if (validationError) {
            errors.push({
              ...validationError,
              code: 'SET_VARIABLE_INVALID_NAME',
              message: `Nó de variável "${nodeId}" tem nome de variável inválido: "${varName}".`,
              nodeIds: [nodeId],
              details: { variable: varName },
            });
          }
        }
      }
      
      return errors;
    },
  },

  handoff: {
    type: 'handoff',
    label: 'Transferência',
    icon: '👤',
    color: '#9B59B6',
    description: 'Transfere a conversa para um agente humano ou fila de atendimento.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'queue',
        type: 'text',
        label: 'Fila de atendimento',
        description: 'Identificador da fila ou equipe de atendimento humano que receberá a conversa.',
        required: true,
        placeholder: 'Ex.: suporte_n1',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (node.config && node.config.queue) {
        if (typeof node.config.queue !== 'string' || node.config.queue.trim() === '') {
          errors.push({
            code: 'HANDOFF_INVALID_QUEUE',
            message: `Nó de handoff "${nodeId}" deve ter "config.queue" como string não vazia.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  ai: {
    type: 'ai',
    label: 'IA',
    icon: '🤖',
    color: '#16A085',
    description: 'Processa a entrada usando IA e gera uma resposta contextual.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'out',
        label: 'Próximo',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'promptTemplate',
        type: 'textarea',
        label: 'Template do Prompt',
        description: 'Template do prompt para a IA. Use {{variavel}} para substituir valores das variáveis do fluxo. Exemplo: {{user_message}} será substituído pelo valor da variável user_message.',
        required: true,
        placeholder: 'Ex.: Você é um assistente útil. O usuário disse: {{user_message}}. Responda de forma amigável.',
        rows: 6,
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Variável de Saída',
        description: 'Nome da variável onde a resposta da IA será armazenada. Esta variável pode ser usada em outros nós do fluxo.',
        required: false,
        defaultValue: 'ai_output',
        placeholder: 'Ex.: ai_answer',
      },
      {
        key: 'outputSchema',
        type: 'json',
        label: 'Schema de Saída (Opcional)',
        description: 'Schema JSON Schema para validar e estruturar a resposta da IA. Se definido, a resposta da IA será validada contra este schema. Deixe vazio para resposta em texto livre.',
        required: false,
        placeholder: `{
  "type": "object",
  "properties": {
    "answer": {
      "type": "string",
      "description": "Resposta da IA"
    }
  },
  "required": ["answer"]
}`,
        rows: 8,
        expectedType: 'object',
      },
      {
        key: 'fallbackText',
        type: 'text',
        label: 'Texto de Fallback',
        description: 'Mensagem exibida caso a IA falhe, não esteja disponível ou a validação do schema falhe. Esta mensagem será enviada ao usuário como resposta.',
        required: false,
        placeholder: 'Ex.: Desculpe, não consegui processar sua solicitação no momento.',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'AI_MISSING_CONFIG',
          message: `Nó de IA "${nodeId}" deve ter um campo "config" com "promptTemplate".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.promptTemplate || typeof node.config.promptTemplate !== 'string') {
        errors.push({
          code: 'AI_MISSING_PROMPT_TEMPLATE',
          message: `Nó de IA "${nodeId}" deve ter "config.promptTemplate" (string não vazia).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.promptTemplate.trim().length === 0) {
        errors.push({
          code: 'AI_EMPTY_PROMPT_TEMPLATE',
          message: `Nó de IA "${nodeId}" não pode ter promptTemplate vazio.`,
          nodeIds: [nodeId],
        });
      }
      
      if (node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'AI_INVALID_OUTPUT_VARIABLE',
            message: `Nó de IA "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      if (node.config.outputSchema) {
        try {
          if (typeof node.config.outputSchema !== 'object') {
            errors.push({
              code: 'AI_INVALID_OUTPUT_SCHEMA',
              message: `Nó de IA "${nodeId}" tem "config.outputSchema" inválido (deve ser objeto).`,
              nodeIds: [nodeId],
            });
          }
        } catch (err) {
          errors.push({
            code: 'AI_INVALID_OUTPUT_SCHEMA',
            message: `Nó de IA "${nodeId}" tem "config.outputSchema" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  end: {
    type: 'end',
    label: 'Fim',
    icon: '⏹',
    color: '#95A5A6',
    description: 'Nó final do fluxo. Encerra a conversa.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [], // Nó end não tem output
    properties: [],
    validate(node) {
      const errors = [];
      return errors;
    },
  },
};

/**
 * Lista de tipos de nós para a paleta (ordem de exibição)
 */
export const NODE_TYPES = Object.values(NODE_SCHEMAS).map(schema => ({
  type: schema.type,
  label: schema.label,
  icon: schema.icon,
  color: schema.color,
}));

/**
 * Helper para obter schema de um tipo de nó
 */
export function getNodeSchema(type) {
  return NODE_SCHEMAS[type] || null;
}

/**
 * Helper para obter todas as propriedades de um tipo de nó
 */
export function getNodeProperties(type) {
  const schema = getNodeSchema(type);
  return schema ? schema.properties : [];
}

/**
 * Helper para obter inputs de um tipo de nó
 */
export function getNodeInputs(type) {
  const schema = getNodeSchema(type);
  return schema ? schema.inputs : [];
}

/**
 * Helper para obter outputs de um tipo de nó
 */
export function getNodeOutputs(type) {
  const schema = getNodeSchema(type);
  return schema ? schema.outputs : [];
}

/**
 * Helper para validar um nó usando seu schema
 */
export function validateNode(node) {
  const schema = getNodeSchema(node.type);
  if (!schema) {
    return [{
      code: 'UNKNOWN_NODE_TYPE',
      message: `Tipo de nó desconhecido: "${node.type}".`,
      nodeIds: [node.id || 'unknown'],
    }];
  }
  return schema.validate(node);
}

