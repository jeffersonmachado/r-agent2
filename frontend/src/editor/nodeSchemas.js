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
 * @property {'text'|'textarea'|'json'|'number'|'boolean'|'select'} type - Tipo do campo
 * @property {string} label - Label do campo
 * @property {string} description - Descrição do campo
 * @property {boolean} required - Se o campo é obrigatório
 * @property {any} defaultValue - Valor padrão
 * @property {Function} validate - Função de validação (opcional)
 * @property {string} placeholder - Placeholder do campo
 * @property {number} rows - Número de linhas (para textarea/json)
 * @property {'object'|'array'} expectedType - Tipo esperado para campos JSON
 * @property {Array<{value:string,label:string}>} options - Opções para campos select
 * @property {(node: {id:string,type:string,config:object}) => boolean} showWhen - Condição para exibir campo (opcional)
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
 * @property {boolean} [errorPorts] - Se o nó suporta portas de erro (opcional)
 * @property {boolean} [supportsTimeout] - Se o nó suporta timeout (opcional)
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
        label: 'O que você quer dizer ao usuário?',
        description: 'Digite a mensagem que o bot vai enviar. Você pode usar variáveis como {{nome}} para personalizar. Exemplo: "Olá {{nome}}! Como posso ajudar?"',
        required: true,
        placeholder: 'Olá! Como posso ajudá-lo hoje?',
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
          messageUi: `Você precisa preencher o campo "O que você quer dizer ao usuário?" com uma mensagem.`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.text || typeof node.config.text !== 'string') {
        errors.push({
          code: 'MESSAGE_MISSING_TEXT',
          message: `Nó de mensagem "${nodeId}" deve ter "config.text" (string não vazia).`,
          messageUi: `Preencha o campo "O que você quer dizer ao usuário?" com uma mensagem.`,
          nodeIds: [nodeId],
        });
      } else if (node.config.text.trim().length === 0) {
        errors.push({
          code: 'MESSAGE_EMPTY_TEXT',
          message: `Nó de mensagem "${nodeId}" não pode ter texto vazio.`,
          messageUi: `A mensagem não pode estar vazia. Digite algo para o usuário.`,
          nodeIds: [nodeId],
        });
      } else if (node.config.text.length > 10000) {
        errors.push({
          code: 'MESSAGE_TEXT_TOO_LONG',
          message: `Nó de mensagem "${nodeId}" excede o limite de 10000 caracteres.`,
          messageUi: `A mensagem é muito longa (${node.config.text.length} caracteres). Use no máximo 10000 caracteres.`,
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
    errorPorts: true, // Suporta portas de erro para fallback (no_match)
    supportsTimeout: false,
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    // Nota: inputs de erro (error, no_match) são adicionados dinamicamente via getNodeInputs
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
        label: 'Onde guardar a resposta do usuário?',
        description: 'Digite um nome para a variável que vai guardar o que o usuário digitar. Use apenas letras, números e underscore. Exemplo: resposta_usuario ou mensagem',
        required: false,
        defaultValue: 'user_input',
        placeholder: 'resposta_usuario',
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
    description: 'Roteia o fluxo baseado em igualdade simples (===). O Roteador NÃO calcula: apenas decide por comparação categórica. Normalize dados antes do Roteador (números → faixas, datas → períodos).',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    // Outputs são gerados dinamicamente baseados em config.rules
    outputs: [
      {
        key: 'default',
        label: 'Padrão',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    /**
     * Gera outputs dinâmicos baseados nas regras configuradas
     * @param {Object} node - Nó completo
     * @returns {Array} Array de outputs
     */
    getOutputs(node) {
      const outputs = [];
      
      // Adiciona uma saída para cada regra
      if (node.config && Array.isArray(node.config.rules)) {
        node.config.rules.forEach((rule, index) => {
          // Gera uma label descritiva baseada na condição
          let label = `Regra ${index + 1}`;
          if (rule.condition) {
            if (rule.condition.op === 'always') {
              label = 'Sempre';
            } else if (rule.condition.op === 'equals') {
              label = `Igual a "${rule.condition.value}"`;
            } else if (rule.condition.var) {
              label = `${rule.condition.var} ${rule.condition.op}`;
            }
          }
          
          outputs.push({
            key: `rule_${index}`,
            label: label,
            socketName: DEFAULT_SOCKET_NAME,
          });
        });
      }
      
      // Sempre adiciona saída padrão
      outputs.push({
        key: 'default',
        label: 'Padrão',
        socketName: DEFAULT_SOCKET_NAME,
      });
      
      return outputs;
    },
    properties: [
      {
        key: 'rules',
        type: 'router',
        label: 'Quais são as regras para decidir o caminho?',
        description: 'Configure as regras que determinam para onde o fluxo vai. O Roteador usa apenas igualdade simples (===) contra valores categóricos. Normalize dados antes: números → faixas ("baixo", "medio", "alto"), datas → períodos ("hoje", "passado", "futuro"), objetos → propriedades achatadas. Use "always" na última regra para fallback.',
        required: true,
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
        // Valida que há pelo menos uma regra com "always" (fallback) ou conexão padrão
        const hasAlwaysRule = node.config.rules.some(rule => 
          rule && rule.condition && rule.condition.op === 'always'
        );
        const hasDefaultConnection = node.next && (
          (typeof node.next === 'string' && node.next.trim() !== '') ||
          (Array.isArray(node.next) && node.next.some(n => n && typeof n === 'string' && n.trim() !== ''))
        );
        if (!hasAlwaysRule && !hasDefaultConnection) {
          errors.push({
            code: 'ROUTER_MISSING_FALLBACK',
            message: `Nó roteador "${nodeId}" deve ter uma regra com operador "always" (fallback) ou uma conexão padrão.`,
            messageUi: `Adicione uma regra com operador "Sempre (fallback)" ou conecte a saída "Padrão" a outro nó.`,
            nodeIds: [nodeId],
          });
        }
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
            const validOps = ['always', 'equals'];
            const deprecatedOps = ['contains']; // Operadores deprecados (compatibilidade retroativa)
            const prohibitedOps = ['>', '<', '>=', '<=', 'gt', 'lt', 'gte', 'lte', 'greater', 'less', 'greaterThan', 'lessThan'];
            
            // BLOQUEAR: Operadores proibidos (matemáticos, comparações complexas)
            if (prohibitedOps.includes(op) || op?.includes('>') || op?.includes('<')) {
              errors.push({
                code: 'ROUTER_PROHIBITED_OPERATOR',
                message: `Regra ${i + 1} do roteador "${nodeId}" usa operador proibido "${op}". O Roteador NÃO calcula: use apenas igualdade simples (===).`,
                messageUi: `Operador "${op}" não permitido. O Roteador só aceita igualdade simples. Normalize dados antes (ex: números → faixas como "alto", "baixo").`,
                nodeIds: [nodeId],
                severity: 'error',
                details: {
                  ruleIndex: i,
                  operator: op,
                  validOperators: validOps,
                },
              });
            }
            
            // AVISAR: Operadores deprecados (compatibilidade retroativa)
            if (deprecatedOps.includes(op)) {
              errors.push({
                code: 'ROUTER_DEPRECATED_OPERATOR',
                message: `Regra ${i + 1} do roteador "${nodeId}" usa operador deprecado "${op}". Migre para "equals" com normalização prévia.`,
                messageUi: `⚠️ Operador "${op}" está deprecado. Use "Igual a" (equals) e normalize dados antes do Roteador (ex: classifique texto em categorias).`,
                nodeIds: [nodeId],
                severity: 'warning',
                details: {
                  ruleIndex: i,
                  operator: op,
                  validOperators: validOps,
                },
              });
            }
            
            // BLOQUEAR: Operadores inválidos (não está na lista permitida ou deprecada)
            if (!op || (!validOps.includes(op) && !deprecatedOps.includes(op))) {
              errors.push({
                code: 'ROUTER_INVALID_OPERATOR',
                message: `Regra ${i + 1} do roteador "${nodeId}" tem operador inválido "${op}". Use apenas: ${validOps.join(', ')}.`,
                messageUi: `Operador inválido. Use apenas "Igual a" (equals) ou "Sempre" (always para fallback).`,
                nodeIds: [nodeId],
                severity: 'error',
                details: {
                  ruleIndex: i,
                  operator: op,
                  validOperators: validOps,
                },
              });
            }
            
            // AVISAR: Comparações que podem precisar de normalização
            if (op === 'equals' && rule.condition.value) {
              const value = rule.condition.value;
              // Detecta números brutos
              if (!isNaN(Number(value)) && value.trim() !== '' && !isNaN(parseFloat(value))) {
                errors.push({
                  code: 'ROUTER_WARN_NUMBER_COMPARISON',
                  message: `Regra ${i + 1} do roteador "${nodeId}" compara com número "${value}". Considere normalizar para categoria (ex: "alto", "medio", "baixo") antes do Roteador.`,
                  messageUi: `⚠️ Comparando com número "${value}". Normalize antes: crie variável categórica (ex: faixa_valor = "alto") e compare com ela.`,
                  nodeIds: [nodeId],
                  severity: 'warning',
                  details: {
                    ruleIndex: i,
                    value: value,
                  },
                });
              }
              
              // Detecta datas (formato ISO ou comum)
              if (typeof value === 'string' && (
                /^\d{4}-\d{2}-\d{2}/.test(value) || 
                /^\d{2}\/\d{2}\/\d{4}/.test(value) ||
                /^\d{2}-\d{2}-\d{4}/.test(value)
              )) {
                errors.push({
                  code: 'ROUTER_WARN_DATE_COMPARISON',
                  message: `Regra ${i + 1} do roteador "${nodeId}" compara com data "${value}". Considere normalizar para período (ex: "hoje", "passado", "futuro") antes do Roteador.`,
                  messageUi: `⚠️ Comparando com data "${value}". Normalize antes: crie variável categórica (ex: periodo = "hoje") e compare com ela.`,
                  nodeIds: [nodeId],
                  severity: 'warning',
                  details: {
                    ruleIndex: i,
                    value: value,
                  },
                });
              }
              
              // Detecta acesso a propriedades profundas (ex: user.role)
              if (rule.condition.var && rule.condition.var.includes('.')) {
                errors.push({
                  code: 'ROUTER_WARN_DEEP_ACCESS',
                  message: `Regra ${i + 1} do roteador "${nodeId}" acessa propriedade profunda "${rule.condition.var}". Considere achatá-la antes (ex: user_role em vez de user.role).`,
                  messageUi: `⚠️ Acesso profundo "${rule.condition.var}". Aplaine antes: crie variável achatada (ex: user_role) e compare com ela.`,
                  nodeIds: [nodeId],
                  severity: 'warning',
                  details: {
                    ruleIndex: i,
                    variable: rule.condition.var,
                  },
                });
              }
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
    // Outputs são gerados dinamicamente baseados em config.allowedOutputs (intent_list)
    outputs: [
      {
        key: 'fallback',
        label: 'Fallback',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    /**
     * Gera outputs dinâmicos baseados nas intenções configuradas
     * @param {Object} node - Nó completo
     * @returns {Array} Array de outputs
     */
    getOutputs(node) {
      const outputs = [];
      
      // Adiciona uma saída para cada intenção permitida (apenas para intent_classification)
      if (node.config && node.config.task === 'intent_classification' && Array.isArray(node.config.allowedOutputs)) {
        node.config.allowedOutputs.forEach((intent) => {
          outputs.push({
            key: `intent_${intent}`,
            label: intent,
            socketName: DEFAULT_SOCKET_NAME,
          });
        });
      }
      
      // Sempre adiciona saída de fallback
      outputs.push({
        key: 'fallback',
        label: 'Fallback',
        socketName: DEFAULT_SOCKET_NAME,
      });
      
      return outputs;
    },
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

        // Valida que há conexão de fallback
        const hasFallbackConnection = node.next && (
          (typeof node.next === 'string' && node.next.trim() !== '') ||
          (Array.isArray(node.next) && node.next.some(n => n && typeof n === 'string' && n.trim() !== ''))
        );
        if (!hasFallbackConnection) {
          errors.push({
            code: 'AI_TASK_MISSING_FALLBACK_CONNECTION',
            message: `Nó de intenção "${nodeId}" deve ter uma conexão de fallback.`,
            messageUi: `Conecte a saída "Fallback" a outro nó para quando nenhuma intenção for reconhecida.`,
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
    description: 'Define ou atualiza o valor de variáveis do fluxo. Apenas atribuição simples: NÃO calcula, NÃO faz lógica condicional. Use para normalizar dados categóricos antes do Roteador.',
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
        label: 'Quais variáveis você quer criar ou atualizar?',
        description: 'Digite um objeto JSON onde cada nome é uma variável e o valor é o que você quer guardar nela. Apenas atribuição simples: valores literais, strings, números ou objetos. NÃO use cálculos (+, -, *, /) ou lógica condicional (?, if/else). Use para normalizar dados categóricos antes do Roteador.',
        required: true,
        placeholder: `{
  "nome_usuario": "João",
  "tipo_texto": "email",
  "faixa_valor": "alto",
  "periodo": "hoje",
  "status": "ativo"
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
          messageUi: `Preencha o campo "Quais variáveis você quer criar ou atualizar?" com um objeto JSON.`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.assignments || typeof node.config.assignments !== 'object') {
        errors.push({
          code: 'SET_VARIABLE_MISSING_ASSIGNMENTS',
          message: `Nó de variável "${nodeId}" deve ter "config.assignments" (objeto com pares chave-valor).`,
          messageUi: `O campo precisa ser um objeto JSON válido. Exemplo: {"nome": "valor"}`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida nomes de variáveis e detecta cálculos/lógica
        for (const varName of Object.keys(node.config.assignments)) {
          const validationError = validateVariableName(varName, nodeId);
          if (validationError) {
            errors.push({
              ...validationError,
              code: 'SET_VARIABLE_INVALID_NAME',
              message: `Nó de variável "${nodeId}" tem nome de variável inválido: "${varName}".`,
              messageUi: `O nome da variável "${varName}" é inválido. Use apenas letras, números e underscore. Exemplo: "nome_usuario" ou "contador1"`,
              nodeIds: [nodeId],
              details: { variable: varName },
            });
          }
          
          // Valida o valor atribuído
          const value = node.config.assignments[varName];
          const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
          
          // BLOQUEAR: Detecta cálculos matemáticos
          const mathOperators = ['+', '-', '*', '/', '%', '**', 'Math.', 'parseInt', 'parseFloat'];
          const hasMath = mathOperators.some(op => valueStr.includes(op));
          if (hasMath) {
            errors.push({
              code: 'SET_VARIABLE_PROHIBITED_CALCULATION',
              message: `Nó de variável "${nodeId}" tenta fazer cálculo na variável "${varName}". O nó Variável NÃO calcula: apenas atribui valores simples.`,
              messageUi: `❌ Cálculo detectado em "${varName}". O nó Variável não faz cálculos. Normalize dados antes (ex: números → faixas como "alto", "baixo") e atribua a categoria.`,
              nodeIds: [nodeId],
              severity: 'error',
              details: { variable: varName, value: valueStr },
            });
          }
          
          // BLOQUEAR: Detecta lógica condicional (ternário, if/else)
          const conditionalPatterns = [
            /\?.*:/,  // Ternário: condition ? a : b
            /if\s*\(/i,  // if(
            /else\s*{/i,  // else {
            /switch\s*\(/i,  // switch(
            /case\s+.*:/i,  // case:
          ];
          const hasConditional = conditionalPatterns.some(pattern => pattern.test(valueStr));
          if (hasConditional) {
            errors.push({
              code: 'SET_VARIABLE_PROHIBITED_LOGIC',
              message: `Nó de variável "${nodeId}" tenta usar lógica condicional na variável "${varName}". O nó Variável NÃO faz lógica: apenas atribui valores simples.`,
              messageUi: `❌ Lógica condicional detectada em "${varName}". O nó Variável não faz lógica. Use o Roteador para decisões baseadas em igualdade simples.`,
              nodeIds: [nodeId],
              severity: 'error',
              details: { variable: varName, value: valueStr },
            });
          }
          
          // AVISAR: Detecta comparações (pode indicar tentativa de cálculo)
          const comparisonOperators = ['>', '<', '>=', '<=', '==', '!='];
          const hasComparison = comparisonOperators.some(op => {
            // Evita falsos positivos em strings que contêm esses símbolos
            if (typeof value === 'string' && !value.includes('{{')) {
              return valueStr.includes(op);
            }
            return false;
          });
          if (hasComparison) {
            errors.push({
              code: 'SET_VARIABLE_WARN_COMPARISON',
              message: `Nó de variável "${nodeId}" parece usar comparação na variável "${varName}". Considere normalizar antes e usar o Roteador para decisões.`,
              messageUi: `⚠️ Comparação detectada em "${varName}". Normalize antes: crie variável categórica (ex: faixa_valor = "alto") e use o Roteador para decidir.`,
              nodeIds: [nodeId],
              severity: 'warning',
              details: { variable: varName, value: valueStr },
            });
          }
          
          // AVISAR: Detecta números brutos que podem precisar normalização
          if (typeof value === 'number' && valueStr.length > 0) {
            // Se o nome da variável sugere que será usado no Roteador
            const routerRelatedNames = ['valor', 'preco', 'quantidade', 'total', 'numero', 'count', 'score', 'rating'];
            const mightNeedNormalization = routerRelatedNames.some(name => 
              varName.toLowerCase().includes(name)
            );
            if (mightNeedNormalization) {
              errors.push({
                code: 'SET_VARIABLE_WARN_NUMBER_FOR_ROUTER',
                message: `Nó de variável "${nodeId}" define número "${value}" na variável "${varName}". Se for usar no Roteador, normalize para categoria primeiro (ex: "alto", "medio", "baixo").`,
                messageUi: `⚠️ Número "${value}" em "${varName}". Se usar no Roteador, normalize antes: crie variável categórica (ex: faixa_${varName} = "alto") e compare com ela.`,
                nodeIds: [nodeId],
                severity: 'warning',
                details: { variable: varName, value: value },
              });
            }
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
    errorPorts: true, // Suporta portas de erro para fallback
    supportsTimeout: true, // Suporta timeout
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
        placeholder: 'Ex.: tenant-abc123',
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

  api: {
    type: 'api',
    label: 'API',
    icon: '🌐',
    color: '#E74C3C',
    description: 'Faz chamadas HTTP para APIs externas. Suporta GET, POST, PUT, DELETE e PATCH.',
    errorPorts: true, // Suporta portas de erro
    supportsTimeout: true, // Suporta timeout
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
        key: 'url',
        type: 'text',
        label: 'Qual é o endereço da API?',
        description: 'Digite a URL completa da API que você quer chamar. Você pode usar variáveis como {{user_id}} para personalizar. Exemplo: https://api.exemplo.com/users/{{user_id}}',
        required: true,
        placeholder: 'https://api.exemplo.com/data',
      },
      {
        key: 'method',
        type: 'select',
        label: 'Qual método você quer usar?',
        description: 'Escolha o tipo de requisição. GET para buscar dados, POST para criar, PUT para atualizar, DELETE para deletar e PATCH para atualizar parcialmente.',
        required: false,
        defaultValue: 'GET',
        options: [
          { value: 'GET', label: 'GET - Buscar dados' },
          { value: 'POST', label: 'POST - Criar novo' },
          { value: 'PUT', label: 'PUT - Atualizar completo' },
          { value: 'DELETE', label: 'DELETE - Deletar' },
          { value: 'PATCH', label: 'PATCH - Atualizar parcial' },
        ],
      },
      {
        key: 'headers',
        type: 'json',
        label: 'Headers adicionais (opcional)',
        description: 'Se a API precisar de autenticação ou headers especiais, adicione aqui. Use {{variavel}} para usar valores dinâmicos. Exemplo: {"Authorization": "Bearer {{token}}"}',
        required: false,
        placeholder: `{
  "Authorization": "Bearer {{token}}",
  "Content-Type": "application/json"
}`,
        rows: 6,
        expectedType: 'object',
      },
      {
        key: 'body',
        type: 'json',
        label: 'Dados para enviar (body) (opcional)',
        description: 'Aparece apenas para POST/PUT/PATCH. Use {{variavel}} para valores dinâmicos. Exemplo: {"nome": "{{user_name}}", "email": "{{user_email}}"}',
        required: false,
        placeholder: `{
  "nome": "{{user_name}}",
  "email": "{{user_email}}"
}`,
        rows: 8,
        expectedType: 'object',
        showWhen: (node) => {
          const method = (node?.config?.method || 'GET').toUpperCase();
          return ['POST', 'PUT', 'PATCH'].includes(method);
        },
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Onde guardar a resposta?',
        description: 'Digite o nome da variável onde a resposta da API será guardada. A resposta terá: success (se funcionou), status (código HTTP), data (dados retornados) e headers.',
        required: false,
        defaultValue: 'api_response',
        placeholder: 'resposta_api',
      },
      {
        key: 'timeout',
        type: 'number',
        label: 'Quanto tempo esperar? (opcional)',
        description: 'Tempo máximo em milissegundos que o bot vai esperar pela resposta. 10000 = 10 segundos. Máximo: 300000 (5 minutos).',
        required: false,
        defaultValue: 10000,
        placeholder: '10000',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'API_MISSING_CONFIG',
          message: `Nó de API "${nodeId}" deve ter um campo "config" com "url".`,
          messageUi: `Preencha o campo "Qual é o endereço da API?" com uma URL (http/https).`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.url || typeof node.config.url !== 'string') {
        errors.push({
          code: 'API_MISSING_URL',
          message: `Nó de API "${nodeId}" deve ter "config.url" (string não vazia).`,
          messageUi: `Preencha o campo "Qual é o endereço da API?" com uma URL (http/https).`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida se a URL parece válida
        try {
          new URL(node.config.url);
        } catch (err) {
          // Se falhar, pode ser porque tem variáveis {{variavel}}
          // Nesse caso, valida se tem pelo menos http:// ou https://, ou se começa com {{...}}
          const urlStr = String(node.config.url || '').trim();
          const hasProtocol = urlStr.includes('http://') || urlStr.includes('https://');
          const startsWithTemplate = urlStr.startsWith('{{') || urlStr.startsWith('${');
          if (!hasProtocol && !startsWithTemplate) {
            errors.push({
              code: 'API_INVALID_URL',
              message: `Nó de API "${nodeId}" tem URL inválida. Deve começar com http:// ou https://`,
              messageUi: `A URL parece inválida. Comece com "https://" (ou use uma variável como "{{BASE_URL}}/rota").`,
              nodeIds: [nodeId],
            });
          }
        }
      }

      // Valida método HTTP
      if (node.config && node.config.method) {
        const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
        if (!validMethods.includes(node.config.method.toUpperCase())) {
          errors.push({
            code: 'API_INVALID_METHOD',
            message: `Nó de API "${nodeId}" tem método HTTP inválido. Use: ${validMethods.join(', ')}`,
            messageUi: `Método inválido. Escolha um método na lista (GET/POST/PUT/DELETE/PATCH).`,
            nodeIds: [nodeId],
          });
        }
      }

      // Valida headers
      if (node.config && node.config.headers !== undefined && node.config.headers !== null) {
        const isObj = typeof node.config.headers === 'object' && !Array.isArray(node.config.headers);
        if (!isObj) {
          errors.push({
            code: 'API_INVALID_HEADERS',
            message: `Nó de API "${nodeId}" tem "config.headers" inválido (deve ser objeto JSON).`,
            messageUi: `Headers inválidos. Use um objeto JSON (ex.: {"Authorization": "Bearer {{token}}"}).`,
            nodeIds: [nodeId],
          });
        }
      }

      // Valida body: só faz sentido para POST/PUT/PATCH
      if (node.config && node.config.body !== undefined && node.config.body !== null) {
        const method = (node.config.method || 'GET').toUpperCase();
        const isAllowed = ['POST', 'PUT', 'PATCH'].includes(method);
        const isObjOrString = (typeof node.config.body === 'object' && !Array.isArray(node.config.body)) || typeof node.config.body === 'string';
        if (!isAllowed) {
          errors.push({
            code: 'API_BODY_NOT_ALLOWED',
            message: `Nó de API "${nodeId}" tem "config.body" mas o método é ${method}.`,
            messageUi: `Você definiu um body, mas o método é ${method}. Troque o método para POST/PUT/PATCH ou remova o body.`,
            nodeIds: [nodeId],
          });
        } else if (!isObjOrString) {
          errors.push({
            code: 'API_INVALID_BODY',
            message: `Nó de API "${nodeId}" tem "config.body" inválido (deve ser objeto JSON ou string).`,
            messageUi: `Body inválido. Use um objeto JSON (recomendado) ou uma string.`,
            nodeIds: [nodeId],
          });
        }
      }

      // Valida timeout
      if (node.config && node.config.timeout !== undefined) {
        const timeout = Number(node.config.timeout);
        if (isNaN(timeout) || timeout < 0 || timeout > 300000) {
          errors.push({
            code: 'API_INVALID_TIMEOUT',
            message: `Nó de API "${nodeId}" tem timeout inválido (deve ser entre 0 e 300000ms).`,
            messageUi: `Timeout inválido. Use um número entre 0 e 300000 (ms).`,
            nodeIds: [nodeId],
          });
        }
      }

      // Valida outputVariable
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'API_INVALID_OUTPUT_VARIABLE',
            message: `Nó de API "${nodeId}" tem "config.outputVariable" inválido.`,
            messageUi: `Nome de variável inválido. Use apenas letras, números e "_" e comece com letra ou "_".`,
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

  subflow: {
    type: 'subflow',
    label: 'Chamar Subfluxo',
    icon: '📦',
    color: '#3498DB',
    description: 'Chama outro fluxo como subfluxo. O subfluxo é executado completamente e retorna ao fluxo principal. Dados são compartilhados via contexto flat. Sem recursão, sem paralelismo.',
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
        label: 'ID do Subfluxo',
        description: 'ID do fluxo que será chamado como subfluxo. O subfluxo deve ter nó Início e nó Fim. Dados retornam via contexto compartilhado.',
        required: true,
        placeholder: 'Ex.: flow-123',
      },
      {
        key: 'timeout',
        type: 'number',
        label: 'Timeout (opcional)',
        description: 'Tempo máximo em milissegundos para execução do subfluxo. Se não preencher, usa o padrão do sistema.',
        required: false,
        placeholder: '30000',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'SUBFLOW_MISSING_CONFIG',
          message: `Nó de subfluxo "${nodeId}" deve ter um campo "config" com "flowId".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.flowId || typeof node.config.flowId !== 'string' || node.config.flowId.trim() === '') {
        errors.push({
          code: 'SUBFLOW_MISSING_FLOW_ID',
          message: `Nó de subfluxo "${nodeId}" deve ter "config.flowId" (string não vazia).`,
          messageUi: `Preencha o campo "ID do Subfluxo" com o ID do fluxo a ser chamado.`,
          nodeIds: [nodeId],
        });
      }
      
      // Valida timeout se fornecido
      if (node.config && node.config.timeout !== undefined) {
        const timeout = Number(node.config.timeout);
        if (isNaN(timeout) || timeout < 0 || timeout > 300000) {
          errors.push({
            code: 'SUBFLOW_INVALID_TIMEOUT',
            message: `Nó de subfluxo "${nodeId}" tem timeout inválido (deve ser entre 0 e 300000ms).`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  schedule_router: {
    type: 'schedule_router',
    label: 'Roteador por Horário',
    icon: '🕐',
    color: '#F5A623',
    description: 'Roteia o fluxo baseado no dia da semana e horário atual. Útil para horários comerciais, atendimento diferenciado por período, etc.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    // Outputs são gerados dinamicamente baseados em config.schedules
    outputs: [
      {
        key: 'default',
        label: 'Padrão',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    /**
     * Gera outputs dinâmicos baseados nos horários configurados
     * @param {Object} node - Nó completo
     * @returns {Array} Array de outputs
     */
    getOutputs(node) {
      const outputs = [];
      
      // Adiciona uma saída para cada horário configurado
      if (node.config && Array.isArray(node.config.schedules)) {
        node.config.schedules.forEach((schedule, index) => {
          // Gera uma label descritiva baseada no horário
          let label = `Horário ${index + 1}`;
          if (schedule.days && schedule.startTime && schedule.endTime) {
            const daysStr = Array.isArray(schedule.days) 
              ? schedule.days.join(', ') 
              : schedule.days;
            label = `${daysStr} ${schedule.startTime}-${schedule.endTime}`;
          }
          
          outputs.push({
            key: `schedule_${index}`,
            label: label,
            socketName: DEFAULT_SOCKET_NAME,
          });
        });
      }
      
      // Sempre adiciona saída padrão
      outputs.push({
        key: 'default',
        label: 'Padrão',
        socketName: DEFAULT_SOCKET_NAME,
      });
      
      return outputs;
    },
    properties: [
      {
        key: 'schedules',
        type: 'schedule_router',
        label: 'Quais horários você quer configurar?',
        description: 'Configure os horários e para onde o fluxo deve ir em cada um. Cada horário precisa ter: dias da semana, horário de início, horário de fim e o nó de destino.',
        required: true,
      },
      {
        key: 'defaultNext',
        type: 'text',
        label: 'Para onde ir quando estiver fora do horário? (opcional)',
        description: 'Digite o ID do nó que será usado quando nenhum horário configurado corresponder. Se não preencher, usa a saída "Padrão"',
        required: false,
        placeholder: 'node-fora-horario',
      },
      {
        key: 'timezone',
        type: 'text',
        label: 'Qual fuso horário usar? (opcional)',
        description: 'Se você quer usar um fuso horário específico, digite aqui. Exemplo: "America/Sao_Paulo" para horário de Brasília. Se não preencher, usa UTC.',
        required: false,
        placeholder: 'America/Sao_Paulo',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'SCHEDULE_ROUTER_MISSING_CONFIG',
          message: `Nó de roteador por horário "${nodeId}" deve ter um campo "config" com "schedules".`,
          nodeIds: [nodeId],
        });
      } else if (!Array.isArray(node.config.schedules)) {
        errors.push({
          code: 'SCHEDULE_ROUTER_MISSING_SCHEDULES',
          message: `Nó de roteador por horário "${nodeId}" deve ter "config.schedules" (array de horários).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.schedules.length === 0) {
        errors.push({
          code: 'SCHEDULE_ROUTER_EMPTY_SCHEDULES',
          message: `Nó de roteador por horário "${nodeId}" deve ter pelo menos um horário em "config.schedules".`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida cada horário
        const validDays = [0, 1, 2, 3, 4, 5, 6]; // 0 = domingo, 6 = sábado
        const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/; // HH:MM formato
        
        for (let i = 0; i < node.config.schedules.length; i += 1) {
          const schedule = node.config.schedules[i];
          if (!schedule || typeof schedule !== 'object') {
            errors.push({
              code: 'SCHEDULE_ROUTER_INVALID_SCHEDULE',
              message: `Horário ${i + 1} do roteador por horário "${nodeId}" não é um objeto válido.`,
              nodeIds: [nodeId],
              details: { scheduleIndex: i },
            });
            continue;
          }

          // Valida dias
          if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
            errors.push({
              code: 'SCHEDULE_ROUTER_INVALID_DAYS',
              message: `Horário ${i + 1} do roteador por horário "${nodeId}" deve ter "days" como array não vazio.`,
              nodeIds: [nodeId],
              details: { scheduleIndex: i },
            });
          } else {
            const invalidDays = schedule.days.filter(d => !validDays.includes(d));
            if (invalidDays.length > 0) {
              errors.push({
                code: 'SCHEDULE_ROUTER_INVALID_DAY_VALUES',
                message: `Horário ${i + 1} do roteador por horário "${nodeId}" tem dias inválidos. Use valores de 0 (domingo) a 6 (sábado).`,
                nodeIds: [nodeId],
                details: { scheduleIndex: i, invalidDays },
              });
            }
          }

          // Valida horários
          if (!schedule.startTime || typeof schedule.startTime !== 'string' || !timeRegex.test(schedule.startTime)) {
            errors.push({
              code: 'SCHEDULE_ROUTER_INVALID_START_TIME',
              message: `Horário ${i + 1} do roteador por horário "${nodeId}" deve ter "startTime" no formato HH:MM (ex: "09:00").`,
              nodeIds: [nodeId],
              details: { scheduleIndex: i },
            });
          }

          if (!schedule.endTime || typeof schedule.endTime !== 'string' || !timeRegex.test(schedule.endTime)) {
            errors.push({
              code: 'SCHEDULE_ROUTER_INVALID_END_TIME',
              message: `Horário ${i + 1} do roteador por horário "${nodeId}" deve ter "endTime" no formato HH:MM (ex: "18:00").`,
              nodeIds: [nodeId],
              details: { scheduleIndex: i },
            });
          }

          // Valida que startTime < endTime
          if (schedule.startTime && schedule.endTime && timeRegex.test(schedule.startTime) && timeRegex.test(schedule.endTime)) {
            const [startH, startM] = schedule.startTime.split(':').map(Number);
            const [endH, endM] = schedule.endTime.split(':').map(Number);
            const startMinutes = startH * 60 + startM;
            const endMinutes = endH * 60 + endM;
            
            if (startMinutes >= endMinutes) {
              errors.push({
                code: 'SCHEDULE_ROUTER_INVALID_TIME_RANGE',
                message: `Horário ${i + 1} do roteador por horário "${nodeId}" deve ter "startTime" anterior a "endTime".`,
                nodeIds: [nodeId],
                details: { scheduleIndex: i },
              });
            }
          }

          // Valida próximo nó
          if (!schedule.next || typeof schedule.next !== 'string' || schedule.next.trim() === '') {
            errors.push({
              code: 'SCHEDULE_ROUTER_MISSING_NEXT',
              message: `Horário ${i + 1} do roteador por horário "${nodeId}" deve ter um campo "next" (id do próximo nó).`,
              nodeIds: [nodeId],
              details: { scheduleIndex: i },
            });
          }
        }
      }
      
      return errors;
    },
  },

  fallback: {
    type: 'fallback',
    label: 'Fallback',
    icon: '🔄',
    color: '#E74C3C',
    description: 'Nó de fallback centralizado. Gerencia erros, tentativas e escalada para humano.',
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
      {
        key: 'error',
        label: 'Erro',
        socketName: DEFAULT_SOCKET_NAME,
      },
      {
        key: 'timeout',
        label: 'Timeout',
        socketName: DEFAULT_SOCKET_NAME,
      },
      {
        key: 'no_match',
        label: 'Sem Correspondência',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    outputs: [
      {
        key: 'retry',
        label: 'Tentar Novamente',
        socketName: DEFAULT_SOCKET_NAME,
      },
      {
        key: 'options',
        label: 'Opções',
        socketName: DEFAULT_SOCKET_NAME,
      },
      {
        key: 'human',
        label: 'Atendimento Humano',
        socketName: DEFAULT_SOCKET_NAME,
      },
      {
        key: 'end',
        label: 'Encerrar',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    properties: [
      {
        key: 'maxAttempts',
        type: 'number',
        label: 'Máximo de Tentativas',
        description: 'Número máximo de tentativas antes de escalar para humano (padrão: 3)',
        required: false,
        defaultValue: 3,
        placeholder: '3',
      },
      {
        key: 'confidenceThreshold',
        type: 'number',
        label: 'Threshold de Confiança',
        description: 'Nível mínimo de confiança para considerar resposta válida (0.0 a 1.0, padrão: 0.75)',
        required: false,
        defaultValue: 0.75,
        placeholder: '0.75',
      },
      {
        key: 'enableEmotionCheck',
        type: 'boolean',
        label: 'Detectar Frustração',
        description: 'Habilitar detecção automática de frustração do usuário',
        required: false,
        defaultValue: true,
      },
      {
        key: 'safeReturnNode',
        type: 'text',
        label: 'Nó de Retorno Seguro',
        description: 'ID do nó para retornar após escalada humana (opcional)',
        required: false,
        placeholder: 'Ex.: node_123',
      },
      {
        key: 'escalationMode',
        type: 'select',
        label: 'Modo de Escalada',
        description: 'Como escalar para atendimento humano: ticket (assíncrono) ou human (síncrono)',
        required: false,
        defaultValue: 'ticket',
        options: [
          { value: 'ticket', label: 'Ticket (Assíncrono)' },
          { value: 'human', label: 'Humano em Tempo Real (Síncrono)' },
        ],
      },
      {
        key: 'allowReturnToBot',
        type: 'boolean',
        label: 'Permitir Retorno ao Bot',
        description: 'Permitir que o atendente retorne a conversa ao bot após atendimento',
        required: false,
        defaultValue: true,
      },
      {
        key: 'queue',
        type: 'text',
        label: 'Fila de Atendimento',
        description: 'Nome da fila para escalada via ticket (apenas para modo ticket)',
        required: false,
        placeholder: 'default',
        showWhen: (node) => {
          // Mostra apenas quando escalationMode é 'ticket'
          return node.config?.escalationMode === 'ticket' || !node.config?.escalationMode;
        },
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (node.config) {
        // Valida maxAttempts
        if (node.config.maxAttempts !== undefined) {
          const maxAttempts = Number(node.config.maxAttempts);
          if (isNaN(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
            errors.push({
              code: 'FALLBACK_INVALID_MAX_ATTEMPTS',
              message: `Nó de fallback "${nodeId}" tem "maxAttempts" inválido (deve ser entre 1 e 10).`,
              nodeIds: [nodeId],
            });
          }
        }
        
        // Valida confidenceThreshold
        if (node.config.confidenceThreshold !== undefined) {
          const threshold = Number(node.config.confidenceThreshold);
          if (isNaN(threshold) || threshold < 0 || threshold > 1) {
            errors.push({
              code: 'FALLBACK_INVALID_THRESHOLD',
              message: `Nó de fallback "${nodeId}" tem "confidenceThreshold" inválido (deve ser entre 0.0 e 1.0).`,
              nodeIds: [nodeId],
            });
          }
        }
        
        // Valida escalationMode
        if (node.config.escalationMode !== undefined) {
          const validModes = ['ticket', 'human'];
          if (!validModes.includes(node.config.escalationMode)) {
            errors.push({
              code: 'FALLBACK_INVALID_ESCALATION_MODE',
              message: `Nó de fallback "${nodeId}" tem "escalationMode" inválido (deve ser "ticket" ou "human").`,
              nodeIds: [nodeId],
            });
          }
        }
      }
      
      return errors;
    },
  },

  get_current_time: {
    type: 'get_current_time',
    label: 'Data/Hora Atual',
    icon: '🕐',
    color: '#8E44AD',
    description: 'Obtém a data e hora atual do sistema em diferentes formatos.',
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
        key: 'format',
        type: 'text',
        label: 'Em que formato você quer a data/hora?',
        description: 'Digite o formato desejado. Use "ISO" para formato padrão, "timestamp" para número, ou um formato customizado como "YYYY-MM-DD HH:mm:ss"',
        required: false,
        defaultValue: 'ISO',
        placeholder: 'ISO',
      },
      {
        key: 'timezone',
        type: 'text',
        label: 'Qual fuso horário? (opcional)',
        description: 'Se você quer um fuso horário específico, digite aqui. Exemplo: "America/Sao_Paulo" para horário de Brasília. Deixe vazio para usar UTC.',
        required: false,
        placeholder: 'America/Sao_Paulo',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Onde guardar a data/hora?',
        description: 'Digite o nome da variável onde a data/hora será guardada. Se não preencher, usa "current_time"',
        required: false,
        defaultValue: 'current_time',
        placeholder: 'data_hora',
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
            code: 'GET_CURRENT_TIME_INVALID_OUTPUT_VARIABLE',
            message: `Nó de data/hora atual "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  generate_uuid: {
    type: 'generate_uuid',
    label: 'Gerar UUID',
    icon: '🆔',
    color: '#8E44AD',
    description: 'Gera um identificador único universal (UUID).',
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
        key: 'outputVariable',
        type: 'text',
        label: 'Onde guardar o ID único?',
        description: 'Digite o nome da variável onde o ID único será guardado. Se não preencher, usa "uuid"',
        required: false,
        defaultValue: 'uuid',
        placeholder: 'id_unico',
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
            code: 'GENERATE_UUID_INVALID_OUTPUT_VARIABLE',
            message: `Nó de gerar UUID "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  delay: {
    type: 'delay',
    label: 'Aguardar',
    icon: '⏱️',
    color: '#8E44AD',
    description: 'Aguarda um tempo específico antes de continuar o fluxo.',
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
        key: 'duration',
        type: 'number',
        label: 'Quanto tempo aguardar?',
        description: 'Digite o tempo de espera em milissegundos. 1000 = 1 segundo, 5000 = 5 segundos. Máximo: 60000 (60 segundos)',
        required: true,
        defaultValue: 1000,
        placeholder: '1000',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'DELAY_MISSING_CONFIG',
          message: `Nó de aguardar "${nodeId}" deve ter um campo "config" com "duration".`,
          nodeIds: [nodeId],
        });
      } else {
        const duration = Number(node.config.duration);
        if (isNaN(duration) || duration < 0) {
          errors.push({
            code: 'DELAY_INVALID_DURATION',
            message: `Nó de aguardar "${nodeId}" deve ter "config.duration" como número positivo.`,
            nodeIds: [nodeId],
          });
        }
        if (duration > 60000) {
          errors.push({
            code: 'DELAY_DURATION_TOO_LONG',
            message: `Nó de aguardar "${nodeId}" não pode ter duração maior que 60000ms (60 segundos).`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  format_date: {
    type: 'format_date',
    label: 'Formatar Data',
    icon: '📅',
    color: '#8E44AD',
    description: 'Formata uma data/hora em um formato específico.',
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
        key: 'inputVariable',
        type: 'text',
        label: 'Qual variável tem a data?',
        description: 'Digite o nome da variável que contém a data que você quer formatar',
        required: true,
        placeholder: 'data_entrada',
      },
      {
        key: 'format',
        type: 'text',
        label: 'Como você quer formatar?',
        description: 'Digite o formato desejado. Exemplo: "YYYY-MM-DD" para 2024-01-15, "DD/MM/YYYY" para 15/01/2024, "HH:mm:ss" para 14:30:00',
        required: true,
        placeholder: 'YYYY-MM-DD HH:mm:ss',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Onde guardar a data formatada?',
        description: 'Digite o nome da variável onde a data formatada será guardada. Se não preencher, usa "formatted_date"',
        required: false,
        defaultValue: 'formatted_date',
        placeholder: 'data_formatada',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'FORMAT_DATE_MISSING_CONFIG',
          message: `Nó de formatar data "${nodeId}" deve ter um campo "config" com "inputVariable" e "format".`,
          nodeIds: [nodeId],
        });
      } else {
        if (!node.config.inputVariable || typeof node.config.inputVariable !== 'string') {
          errors.push({
            code: 'FORMAT_DATE_MISSING_INPUT_VARIABLE',
            message: `Nó de formatar data "${nodeId}" deve ter "config.inputVariable" (string não vazia).`,
            nodeIds: [nodeId],
          });
        }
        if (!node.config.format || typeof node.config.format !== 'string') {
          errors.push({
            code: 'FORMAT_DATE_MISSING_FORMAT',
            message: `Nó de formatar data "${nodeId}" deve ter "config.format" (string não vazia).`,
            nodeIds: [nodeId],
          });
        }
      }
      
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'FORMAT_DATE_INVALID_OUTPUT_VARIABLE',
            message: `Nó de formatar data "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  random_number: {
    type: 'random_number',
    label: 'Número Aleatório',
    icon: '🎲',
    color: '#8E44AD',
    description: 'Gera um número aleatório dentro de um intervalo especificado.',
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
        key: 'min',
        type: 'number',
        label: 'Número mínimo (opcional)',
        description: 'Digite o menor número que pode ser gerado. Se não preencher, começa do 0',
        required: false,
        defaultValue: 0,
        placeholder: '0',
      },
      {
        key: 'max',
        type: 'number',
        label: 'Número máximo',
        description: 'Digite o maior número que pode ser gerado. O número gerado será entre o mínimo e este valor',
        required: true,
        defaultValue: 100,
        placeholder: '100',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Onde guardar o número?',
        description: 'Digite o nome da variável onde o número aleatório será guardado. Se não preencher, usa "random_number"',
        required: false,
        defaultValue: 'random_number',
        placeholder: 'numero_aleatorio',
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'RANDOM_NUMBER_MISSING_CONFIG',
          message: `Nó de número aleatório "${nodeId}" deve ter um campo "config" com "max".`,
          nodeIds: [nodeId],
        });
      } else {
        const min = node.config.min !== undefined ? Number(node.config.min) : 0;
        const max = Number(node.config.max);
        
        if (isNaN(max)) {
          errors.push({
            code: 'RANDOM_NUMBER_INVALID_MAX',
            message: `Nó de número aleatório "${nodeId}" deve ter "config.max" como número válido.`,
            nodeIds: [nodeId],
          });
        }
        if (!isNaN(min) && !isNaN(max) && min >= max) {
          errors.push({
            code: 'RANDOM_NUMBER_INVALID_RANGE',
            message: `Nó de número aleatório "${nodeId}" deve ter "config.min" menor que "config.max".`,
            nodeIds: [nodeId],
          });
        }
      }
      
      if (node.config && node.config.outputVariable) {
        const validationError = validateVariableName(node.config.outputVariable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'RANDOM_NUMBER_INVALID_OUTPUT_VARIABLE',
            message: `Nó de número aleatório "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  get_user_info: {
    type: 'get_user_info',
    label: 'Info do Usuário',
    icon: '👤',
    color: '#8E44AD',
    description: 'Obtém informações do usuário atual da conversa.',
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
        key: 'fields',
        type: 'text',
        label: 'Quais informações você quer? (opcional)',
        description: 'Digite os campos que você quer obter, separados por vírgula. Exemplo: "name,phone,email". Se deixar vazio, pega todas as informações disponíveis.',
        required: false,
        placeholder: 'name,phone,email',
      },
      {
        key: 'outputVariable',
        type: 'text',
        label: 'Onde guardar as informações?',
        description: 'Digite o nome da variável onde as informações do usuário serão guardadas. Se não preencher, usa "user_info"',
        required: false,
        defaultValue: 'user_info',
        placeholder: 'info_usuario',
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
            code: 'GET_USER_INFO_INVALID_OUTPUT_VARIABLE',
            message: `Nó de info do usuário "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
      return errors;
    },
  },

  options: {
    type: 'options',
    label: 'Opções',
    icon: '🔘',
    color: '#9B59B6',
    description: 'Exibe opções interativas para o usuário (botões, checkboxes, etc.) e captura a resposta.',
    errorPorts: true, // Suporta portas de erro para fallback (no_match)
    supportsTimeout: false,
    inputs: [
      {
        key: 'in',
        label: 'Anterior',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    // Outputs são gerados dinamicamente baseados em config.options
    outputs: [
      {
        key: 'fallback',
        label: 'Fallback',
        socketName: DEFAULT_SOCKET_NAME,
      },
    ],
    /**
     * Gera outputs dinâmicos baseados nas opções configuradas
     * @param {Object} node - Nó completo
     * @returns {Array} Array de outputs
     */
    getOutputs(node) {
      const outputs = [];
      
      // Adiciona uma saída para cada opção
      if (node.config && Array.isArray(node.config.options)) {
        node.config.options.forEach((option, index) => {
          const label = option.label || option.id || `Opção ${index + 1}`;
          outputs.push({
            key: `option_${option.id || index}`,
            label: label,
            socketName: DEFAULT_SOCKET_NAME,
          });
        });
      }
      
      // Sempre adiciona saída de fallback
      outputs.push({
        key: 'fallback',
        label: 'Fallback',
        socketName: DEFAULT_SOCKET_NAME,
      });
      
      return outputs;
    },
    properties: [
      {
        key: 'message',
        type: 'textarea',
        label: 'Mensagem para o usuário',
        description: 'Digite a mensagem que será exibida antes das opções. Você pode usar variáveis como {{nome}} para personalizar.',
        required: false,
        placeholder: 'Escolha uma opção:',
        rows: 3,
      },
      {
        key: 'optionsType',
        type: 'select',
        label: 'Tipo de opções',
        description: 'Escolha o tipo de interação que você quer exibir para o usuário.',
        required: true,
        defaultValue: 'button',
        options: [
          { value: 'button', label: 'Botões' },
          { value: 'checkbox', label: 'Checkboxes (múltipla escolha)' },
          { value: 'radio', label: 'Radio (escolha única)' },
          { value: 'list', label: 'Lista de seleção' },
        ],
      },
      {
        key: 'options',
        type: 'options',
        label: 'Lista de opções',
        description: 'Configure as opções que o usuário pode escolher. Cada opção precisa ter um ID único e um texto para exibir. Você pode opcionalmente definir um valor diferente do ID para ser armazenado na variável.',
        required: true,
      },
      {
        key: 'variable',
        type: 'text',
        label: 'Onde guardar a resposta?',
        description: 'Digite o nome da variável onde a escolha do usuário será guardada. Para checkboxes, será um array com os valores selecionados.',
        required: false,
        defaultValue: 'user_option',
        placeholder: 'resposta_opcao',
        validate: (value) => {
          if (!value) return null; // Opcional
          return validateVariableName(value);
        },
      },
      {
        key: 'allowMultiple',
        type: 'boolean',
        label: 'Permitir múltipla seleção',
        description: 'Permite que o usuário selecione múltiplas opções (apenas para checkboxes e listas)',
        required: false,
        defaultValue: false,
      },
    ],
    validate(node) {
      const errors = [];
      const nodeId = node.id || 'unknown';
      
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'OPTIONS_MISSING_CONFIG',
          message: `Nó de opções "${nodeId}" deve ter um campo "config".`,
          messageUi: `Configure as opções que o usuário pode escolher.`,
          nodeIds: [nodeId],
        });
        return errors;
      }

      const config = node.config;

      // Valida optionsType
      if (!config.optionsType || typeof config.optionsType !== 'string') {
        errors.push({
          code: 'OPTIONS_MISSING_TYPE',
          message: `Nó de opções "${nodeId}" deve ter "config.optionsType" definido.`,
          messageUi: `Selecione o tipo de opções (botões, checkboxes, etc.).`,
          nodeIds: [nodeId],
        });
      } else {
        const validTypes = ['button', 'checkbox', 'radio', 'list'];
        if (!validTypes.includes(config.optionsType)) {
          errors.push({
            code: 'OPTIONS_INVALID_TYPE',
            message: `Nó de opções "${nodeId}" tem tipo inválido. Use: ${validTypes.join(', ')}.`,
            messageUi: `Tipo de opções inválido. Escolha entre: ${validTypes.join(', ')}.`,
            nodeIds: [nodeId],
          });
        }
      }

      // Valida options
      if (!Array.isArray(config.options) || config.options.length === 0) {
        errors.push({
          code: 'OPTIONS_MISSING_OPTIONS',
          message: `Nó de opções "${nodeId}" deve ter "config.options" como array não vazio.`,
          messageUi: `Adicione pelo menos uma opção para o usuário escolher.`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida que há conexão de fallback
        const hasFallbackConnection = node.next && (
          (typeof node.next === 'string' && node.next.trim() !== '') ||
          (Array.isArray(node.next) && node.next.some(n => n && typeof n === 'string' && n.trim() !== ''))
        );
        if (!hasFallbackConnection) {
          errors.push({
            code: 'OPTIONS_MISSING_FALLBACK',
            message: `Nó de opções "${nodeId}" deve ter uma conexão de fallback.`,
            messageUi: `Conecte a saída "Fallback" a outro nó para quando nenhuma opção corresponder.`,
            nodeIds: [nodeId],
          });
        }
        // Valida cada opção
        for (let i = 0; i < config.options.length; i += 1) {
          const option = config.options[i];
          if (!option || typeof option !== 'object') {
            errors.push({
              code: 'OPTIONS_INVALID_OPTION',
              message: `Opção ${i + 1} do nó de opções "${nodeId}" não é um objeto válido.`,
              messageUi: `A opção ${i + 1} está inválida. Cada opção deve ser um objeto com "id" e "label".`,
              nodeIds: [nodeId],
              details: { optionIndex: i },
            });
            continue;
          }

          if (!option.id || typeof option.id !== 'string' || option.id.trim() === '') {
            errors.push({
              code: 'OPTIONS_OPTION_MISSING_ID',
              message: `Opção ${i + 1} do nó de opções "${nodeId}" deve ter "id" (string não vazia).`,
              messageUi: `A opção ${i + 1} precisa ter um ID único.`,
              nodeIds: [nodeId],
              details: { optionIndex: i },
            });
          }

          if (!option.label || typeof option.label !== 'string' || option.label.trim() === '') {
            errors.push({
              code: 'OPTIONS_OPTION_MISSING_LABEL',
              message: `Opção ${i + 1} do nó de opções "${nodeId}" deve ter "label" (string não vazia).`,
              messageUi: `A opção ${i + 1} precisa ter um texto (label) para exibir.`,
              nodeIds: [nodeId],
              details: { optionIndex: i },
            });
          }
        }

        // Valida IDs únicos
        const ids = config.options.map(opt => opt && opt.id ? opt.id : '').filter(id => id !== '');
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) {
          errors.push({
            code: 'OPTIONS_DUPLICATE_IDS',
            message: `Nó de opções "${nodeId}" tem IDs duplicados. Cada opção deve ter um ID único.`,
            messageUi: `Todas as opções devem ter IDs diferentes. Verifique se não há IDs duplicados.`,
            nodeIds: [nodeId],
          });
        }
      }

      // Valida variable
      if (config.variable) {
        const validationError = validateVariableName(config.variable, nodeId);
        if (validationError) {
          errors.push({
            ...validationError,
            code: 'OPTIONS_INVALID_VARIABLE',
            message: `Nó de opções "${nodeId}" tem "config.variable" inválido.`,
            nodeIds: [nodeId],
          });
        }
      }
      
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
 * @param {string} type - Tipo do nó
 * @param {Object} node - Nó completo (opcional, para inputs dinâmicos)
 * @returns {Array} Array de inputs
 */
export function getNodeInputs(type, node = null) {
  const schema = getNodeSchema(type);
  if (!schema) return [];
  
  // Se o schema tem uma função getInputs, usa ela
  if (typeof schema.getInputs === 'function' && node) {
    return schema.getInputs(node);
  }
  
  return schema.inputs || [];
}

/**
 * Helper para obter outputs de um tipo de nó
 * @param {string} type - Tipo do nó
 * @param {Object} node - Nó completo (opcional, para outputs dinâmicos)
 * @returns {Array} Array de outputs
 */
export function getNodeOutputs(type, node = null) {
  const schema = getNodeSchema(type);
  if (!schema) return [];
  
  // Se o schema tem uma função getOutputs, usa ela
  const baseOutputs = (typeof schema.getOutputs === 'function' && node)
    ? schema.getOutputs(node)
    : (schema.outputs || []);

  // Se o nó suporta portas de erro/timeout, adiciona como SAÍDAS (outputs).
  // Isso permite roteamento por socket no editor.
  if (schema.errorPorts) {
    // Alguns nós (ex.: API) não fazem sentido ter "no_match".
    const includeNoMatch = type !== 'api';
    const extraOutputs = [
      { key: 'error', label: 'Erro', socketName: DEFAULT_SOCKET_NAME },
      ...(includeNoMatch ? [{ key: 'no_match', label: 'Sem Correspondência', socketName: DEFAULT_SOCKET_NAME }] : []),
    ];

    if (schema.supportsTimeout) {
      extraOutputs.splice(1, 0, { key: 'timeout', label: 'Timeout', socketName: DEFAULT_SOCKET_NAME });
    }

    const existingKeys = new Set(baseOutputs.map((o) => o.key));
    for (const o of extraOutputs) {
      if (!existingKeys.has(o.key)) {
        baseOutputs.push(o);
      }
    }
  }

  return baseOutputs;
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

