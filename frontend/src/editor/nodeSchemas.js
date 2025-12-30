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

import { SUPPORTED_TASKS } from '@shared/aiTaskExecutor';

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
    description: 'Envia uma mensagem ao usuário. Suporta interpolação de variáveis usando {{variavel}}.',
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
        description: 'Mensagem que será enviada ao usuário. Use {{nome_variavel}} para interpolar variáveis. Ex.: "Olá {{nome}}! Como posso ajudar?"',
        required: true,
        placeholder: 'Ex.: Olá {{nome}}! Como posso ajudá-lo hoje?',
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

  ai_task: {
    type: 'ai_task',
    label: 'Intenção',
    icon: '🤖',
    color: '#16A085',
    description: 'Identifica a intenção do usuário baseado nas palavras que ele digita. Por exemplo: se o usuário quer comprar algo, pedir ajuda ou resolver algo financeiro.',
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
        key: 'task',
        type: 'select',
        label: 'O que este nó deve fazer?',
        description: 'Selecione o tipo de tarefa que este nó deve executar. Para reconhecer a intenção do usuário, escolha "Intenção".',
        required: true,
        placeholder: 'Selecione uma opção...',
        options: [
          { value: 'intent_classification', label: 'Intenção' },
          { value: 'entity_extraction', label: 'Extrair Entidades' },
          { value: 'text_normalization', label: 'Normalizar Texto' },
          { value: 'assisted_response', label: 'Resposta Assistida' },
        ],
      },
      {
        key: 'allowedOutputs',
        type: 'intent_list',
        label: 'Quais intenções você quer reconhecer?',
        description: 'Adicione as intenções que o bot deve identificar. Clique em "Adicionar" para cada intenção. Exemplos: comprar, suporte, financeiro.',
        required: false,
      },
      {
        key: 'fallback',
        type: 'text',
        label: 'O que fazer quando não entender?',
        description: 'Quando o bot não conseguir identificar nenhuma intenção, ele vai usar este valor. Exemplo: "desconhecido" ou "outro"',
        required: false,
        placeholder: 'desconhecido',
      },
      {
        key: 'confidenceThreshold',
        type: 'number',
        label: 'Nível de certeza necessário (opcional)',
        description: 'Quão certo o bot precisa estar para aceitar uma intenção? Use um número entre 0 e 1. 0.75 significa 75% de certeza. Deixe vazio para usar o padrão (75%).',
        required: false,
        placeholder: '0.75',
      },
      {
        key: 'keywords',
        type: 'keywords',
        label: 'Palavras que indicam cada intenção (opcional)',
        description: 'Configure quais palavras o bot deve procurar para identificar cada intenção. Selecione uma intenção e adicione palavras-chave. Se você não configurar, o bot usa palavras padrão. Dica: adicione variações e sinônimos para melhorar o reconhecimento.',
        required: false,
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'AI_TASK_MISSING_CONFIG',
          message: `O nó "Reconhecer Intenção" precisa ter configurações definidas.`,
          messageUi: `O nó "Reconhecer Intenção" precisa ter configurações definidas.`,
          nodeIds: [nodeId],
        });
        return errors;
      }

      const config = node.config;

      // Validação: task deve estar definida
      if (!config.task || typeof config.task !== 'string') {
        errors.push({
          code: 'AI_TASK_MISSING_TASK',
          message: `O campo "O que este nó deve fazer?" precisa ser preenchido.`,
          messageUi: `Preencha o campo "O que este nó deve fazer?" com: intent_classification`,
          nodeIds: [nodeId],
        });
      } else {
        // Validação: task deve ser uma das tarefas suportadas
        const supportedTasks = Object.values(SUPPORTED_TASKS);
        if (!supportedTasks.includes(config.task)) {
          errors.push({
            code: 'AI_TASK_UNSUPPORTED_TASK',
            message: `Tipo de tarefa não reconhecido. Use: intent_classification`,
            messageUi: `Tipo de tarefa não reconhecido. Digite exatamente: intent_classification`,
            nodeIds: [nodeId],
            details: {
              task: config.task,
              supportedTasks,
            },
          });
        }
      }

      // Validação específica para intent_classification
      if (config.task === 'intent_classification') {
        // allowedOutputs deve ser um array não vazio
        if (!Array.isArray(config.allowedOutputs) || config.allowedOutputs.length === 0) {
          errors.push({
            code: 'AI_TASK_MISSING_ALLOWED_OUTPUTS',
            message: `Você precisa definir quais intenções o bot deve reconhecer.`,
            messageUi: `Preencha o campo "Quais intenções você quer reconhecer?" com uma lista, por exemplo: ["comprar", "suporte", "financeiro"]`,
            nodeIds: [nodeId],
          });
        }

        // fallback deve estar definido
        if (config.fallback === undefined || config.fallback === null || config.fallback === '') {
          errors.push({
            code: 'AI_TASK_MISSING_FALLBACK',
            message: `Você precisa definir o que fazer quando o bot não entender a intenção.`,
            messageUi: `Preencha o campo "O que fazer quando não entender?" com um valor, por exemplo: "desconhecido"`,
            nodeIds: [nodeId],
          });
        }

        // confidenceThreshold deve ser um número válido entre 0 e 1
        if (config.confidenceThreshold !== undefined) {
          if (typeof config.confidenceThreshold !== 'number') {
            errors.push({
              code: 'AI_TASK_INVALID_CONFIDENCE_THRESHOLD',
              message: `O nível de certeza deve ser um número.`,
              messageUi: `O campo "Nível de certeza necessário" deve ser um número entre 0 e 1, por exemplo: 0.75`,
              nodeIds: [nodeId],
            });
          } else if (config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
            errors.push({
              code: 'AI_TASK_INVALID_CONFIDENCE_RANGE',
              message: `O nível de certeza deve estar entre 0 e 1.`,
              messageUi: `O nível de certeza deve ser um número entre 0 e 1. Use valores como: 0.5 (50%), 0.75 (75%) ou 0.9 (90%)`,
              nodeIds: [nodeId],
            });
          }
        }
      }

      // Validação: o nó deve ter um "next" definido (caminho de fallback)
      if (!node.next) {
        errors.push({
          code: 'AI_TASK_NO_FALLBACK_PATH',
          message: `Este nó precisa estar conectado a outro nó.`,
          messageUi: `Conecte este nó a outro nó do fluxo arrastando uma linha de conexão.`,
          nodeIds: [nodeId],
        });
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

  get_flow_info: {
    type: 'get_flow_info',
    label: 'Info do Fluxo',
    icon: '📋',
    color: '#3498DB',
    description: 'Obtém informações de outro fluxo e salva em uma variável.',
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
        key: 'flowId',
        type: 'text',
        label: 'ID do Fluxo',
        description: 'ID do fluxo a ser buscado',
        required: true,
        placeholder: 'Ex.: flow-123',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Variável de Saída',
        description: 'Nome da variável onde o resultado será salvo',
        required: false,
        defaultValue: 'flow_info',
        placeholder: 'flow_info',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'GET_FLOW_INFO_MISSING_CONFIG',
          message: `Nó de info do fluxo "${nodeId}" deve ter um campo "config" com "flowId".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.flowId || typeof node.config.flowId !== 'string') {
        errors.push({
          code: 'GET_FLOW_INFO_MISSING_FLOW_ID',
          message: `Nó de info do fluxo "${nodeId}" deve ter "config.flowId" (string não vazia).`,
          nodeIds: [nodeId],
        });
      }
      
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'GET_FLOW_INFO_INVALID_OUTPUT_VARIABLE',
            message: `Nó de info do fluxo "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  get_queue_status: {
    type: 'get_queue_status',
    label: 'Status da Fila',
    icon: '📊',
    color: '#E67E22',
    description: 'Obtém status de uma fila de atendimento.',
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
        key: 'queueName',
        type: 'text',
        label: 'Nome da Fila',
        description: 'Nome da fila de atendimento',
        required: true,
        placeholder: 'Ex.: suporte',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Variável de Saída',
        description: 'Nome da variável onde o resultado será salvo',
        required: false,
        defaultValue: 'queue_status',
        placeholder: 'queue_status',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'GET_QUEUE_STATUS_MISSING_CONFIG',
          message: `Nó de status da fila "${nodeId}" deve ter um campo "config" com "queueName".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.queueName || typeof node.config.queueName !== 'string') {
        errors.push({
          code: 'GET_QUEUE_STATUS_MISSING_QUEUE_NAME',
          message: `Nó de status da fila "${nodeId}" deve ter "config.queueName" (string não vazia).`,
          nodeIds: [nodeId],
        });
      }
      
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'GET_QUEUE_STATUS_INVALID_OUTPUT_VARIABLE',
            message: `Nó de status da fila "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  get_config_value: {
    type: 'get_config_value',
    label: 'Valor da Config',
    icon: '⚙️',
    color: '#8E44AD',
    description: 'Obtém um valor da configuração do sistema.',
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
        key: 'configPath',
        type: 'text',
        label: 'Caminho da Config',
        description: 'Caminho do valor na config (ex: api.port)',
        required: true,
        placeholder: 'Ex.: api.port',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Variável de Saída',
        description: 'Nome da variável onde o resultado será salvo',
        required: false,
        defaultValue: 'config_value',
        placeholder: 'config_value',
      },
      {
        key: 'defaultValue',
        type: 'text',
        label: 'Valor Padrão',
        description: 'Valor padrão caso o caminho não exista',
        required: false,
        placeholder: 'Ex.: 3000',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'GET_CONFIG_VALUE_MISSING_CONFIG',
          message: `Nó de valor da config "${nodeId}" deve ter um campo "config" com "configPath".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.configPath || typeof node.config.configPath !== 'string') {
        errors.push({
          code: 'GET_CONFIG_VALUE_MISSING_CONFIG_PATH',
          message: `Nó de valor da config "${nodeId}" deve ter "config.configPath" (string não vazia).`,
          nodeIds: [nodeId],
        });
      }
      
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'GET_CONFIG_VALUE_INVALID_OUTPUT_VARIABLE',
            message: `Nó de valor da config "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  list_flows: {
    type: 'list_flows',
    label: 'Listar Fluxos',
    icon: '📑',
    color: '#1ABC9C',
    description: 'Lista fluxos disponíveis com filtros opcionais.',
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
        key: 'tenantId',
        type: 'text',
        label: 'Tenant ID (Opcional)',
        description: 'Filtrar fluxos por tenant',
        required: false,
        placeholder: 'Ex.: tenant-demo',
      },
      {
        key: 'nameFilter',
        type: 'text',
        label: 'Filtro de Nome (Opcional)',
        description: 'Filtrar fluxos por nome',
        required: false,
        placeholder: 'Ex.: suporte',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Variável de Saída',
        description: 'Nome da variável onde a lista será salva',
        required: false,
        defaultValue: 'flows_list',
        placeholder: 'flows_list',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'LIST_FLOWS_INVALID_OUTPUT_VARIABLE',
            message: `Nó de listar fluxos "${nodeId}" tem "config.outputVariable" inválido.`,
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

