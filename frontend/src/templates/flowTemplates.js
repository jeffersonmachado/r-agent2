/**
 * Modelos de fluxo pré-definidos para facilitar a criação de novos fluxos
 * 
 * IMPORTANTE:
 * - Os templates devem seguir a estrutura do schema centralizado (nodeSchemas.js)
 * - Router rules devem usar: { op: 'equals'|'contains'|'always', var: 'variable_name', value: 'value' }
 * - Use condition: { op: 'always' } para fallback em routers
 * - Todos os nós devem ter IDs únicos dentro do template
 */

export const flowTemplates = [
  {
    id: 'simple-greeting',
    name: 'Saudação Simples',
    description: 'Fluxo básico com uma mensagem de boas-vindas',
    icon: '👋',
    flow: {
      tenantId: 'tenant-demo',
      id: 'simple-greeting',
      name: 'Saudação Simples',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'greeting',
        },
        {
          id: 'greeting',
          type: 'message',
          config: {
            text: 'Olá! Bem-vindo ao nosso chatbot. Como posso ajudá-lo hoje?',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {},
    },
  },
  {
    id: 'user-input',
    name: 'Coleta de Dados',
    description: 'Fluxo que coleta informações do usuário',
    icon: '📝',
    flow: {
      tenantId: 'tenant-demo',
      id: 'user-input',
      name: 'Coleta de Dados',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'welcome',
        },
        {
          id: 'welcome',
          type: 'message',
          config: {
            text: 'Olá! Vamos começar coletando algumas informações.',
          },
          next: 'collect-name',
        },
        {
          id: 'collect-name',
          type: 'user_input',
          config: {
            variable: 'user_name',
          },
          next: 'confirm',
        },
        {
          id: 'confirm',
          type: 'message',
          config: {
            text: 'Obrigado! Seu nome foi registrado.',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {},
    },
  },
  {
    id: 'router-basic',
    name: 'Router Básico',
    description: 'Fluxo com roteamento baseado em condições',
    icon: '🔀',
    flow: {
      tenantId: 'tenant-demo',
      id: 'router-basic',
      name: 'Router Básico',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'ask-option',
        },
        {
          id: 'ask-option',
          type: 'message',
          config: {
            text: 'Escolha uma opção:\n1. Opção A\n2. Opção B',
          },
          next: 'collect-option',
        },
        {
          id: 'collect-option',
          type: 'user_input',
          config: {
            variable: 'user_option',
          },
          next: 'route',
        },
        {
          id: 'route',
          type: 'router',
          config: {
            rules: [
              {
                condition: { op: 'equals', var: 'user_option', value: '1' },
                next: 'option-a',
              },
              {
                condition: { op: 'equals', var: 'user_option', value: '2' },
                next: 'option-b',
              },
              {
                condition: { op: 'always' },
                next: 'default-response',
              },
            ],
          },
          next: null,
        },
        {
          id: 'option-a',
          type: 'message',
          config: {
            text: 'Você escolheu a Opção A!',
          },
          next: 'end',
        },
        {
          id: 'option-b',
          type: 'message',
          config: {
            text: 'Você escolheu a Opção B!',
          },
          next: 'end',
        },
        {
          id: 'default-response',
          type: 'message',
          config: {
            text: 'Opção não reconhecida. Tente novamente.',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {},
    },
  },
  {
    id: 'ai-assistant',
    name: 'Assistente com AI',
    description: 'Fluxo que usa AI para responder ao usuário',
    icon: '🤖',
    flow: {
      tenantId: 'tenant-demo',
      id: 'ai-assistant',
      name: 'Assistente com AI',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'welcome',
        },
        {
          id: 'welcome',
          type: 'message',
          config: {
            text: 'Olá! Sou um assistente virtual. Como posso ajudá-lo?',
          },
          next: 'collect-question',
        },
        {
          id: 'collect-question',
          type: 'user_input',
          config: {
            variable: 'user_question',
          },
          next: 'ai-process',
        },
        {
          id: 'ai-process',
          type: 'ai',
          config: {
            promptTemplate: 'O usuário perguntou: {{user_question}}. Responda de forma útil e amigável.',
            outputVariable: 'ai_response',
          },
          next: 'show-response',
        },
        {
          id: 'show-response',
          type: 'message',
          config: {
            text: '{{ai_response}}',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {},
    },
  },
  {
    id: 'handoff-support',
    name: 'Transferência para Suporte',
    description: 'Fluxo que transfere para atendimento humano',
    icon: '👤',
    flow: {
      tenantId: 'tenant-demo',
      id: 'handoff-support',
      name: 'Transferência para Suporte',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'greeting',
        },
        {
          id: 'greeting',
          type: 'message',
          config: {
            text: 'Olá! Estou aqui para ajudá-lo.',
          },
          next: 'ask-help',
        },
        {
          id: 'ask-help',
          type: 'message',
          config: {
            text: 'Se precisar de ajuda adicional, posso transferir você para um atendente.',
          },
          next: 'collect-transfer',
        },
        {
          id: 'collect-transfer',
          type: 'user_input',
          config: {
            variable: 'needs_transfer',
          },
          next: 'check-transfer',
        },
        {
          id: 'check-transfer',
          type: 'router',
          config: {
            rules: [
              {
                condition: { op: 'equals', var: 'needs_transfer', value: 'sim' },
                next: 'transfer',
              },
              {
                condition: { op: 'always' },
                next: 'continue-chat',
              },
            ],
          },
          next: null,
        },
        {
          id: 'transfer',
          type: 'handoff',
          config: {
            queue: 'suporte_n1',
          },
          next: 'end',
        },
        {
          id: 'continue-chat',
          type: 'message',
          config: {
            text: 'Continuando o atendimento...',
          },
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {},
    },
  },
  {
    id: 'empty',
    name: 'Fluxo Vazio',
    description: 'Comece do zero com um fluxo em branco',
    icon: '📄',
    flow: {
      tenantId: 'tenant-demo',
      id: 'new-flow',
      name: 'Novo Fluxo',
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {},
          next: 'end',
        },
        {
          id: 'end',
          type: 'end',
          config: {},
          next: null,
        },
      ],
      metadata: {},
    },
  },
];

/**
 * Gera um ID único para um novo fluxo baseado em template
 */
export function generateFlowId(templateId, baseName) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `${templateId}-${timestamp}-${random}`;
}

/**
 * Cria um novo fluxo a partir de um template
 */
export function createFlowFromTemplate(template, customId = null, customName = null) {
  const flowId = customId || generateFlowId(template.id, template.name);
  const flowName = customName || `${template.name} (cópia)`;

  return {
    ...template.flow,
    id: flowId,
    name: flowName,
    metadata: {
      ...template.flow.metadata,
      createdFromTemplate: template.id,
      createdAt: new Date().toISOString(),
    },
  };
}

