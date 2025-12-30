/**
 * Processador de mensagens do WhatsApp integrado à engine de fluxo.
 *
 * Responsabilidades:
 * - Transformar webhooks do WhatsApp em chamadas para a engine.
 * - Manter um mapa simples de sessões em memória (sessionId -> ConversationState).
 * - Enviar respostas da engine de volta ao usuário via WhatsApp.
 */

const { executeStep } = require('../../engine/executeStep');
const { NodeRegistry } = require('../../engine/nodeRegistry');
const {
  startNodeHandler,
  messageNodeHandler,
  userInputNodeHandler,
  routerNodeHandler,
  setVariableNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
} = require('../../engine/nodes/basicNodes');
const { aiNodeHandler } = require('../../engine/nodes/aiNode');
const { aiTaskNodeHandler } = require('../../engine/nodes/aiTaskNode');
const {
  getFlowInfoNodeHandler,
  getQueueStatusNodeHandler,
  getConfigValueNodeHandler,
  listFlowsNodeHandler,
} = require('../../engine/nodes/persistenceNodes');
const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
const { sendTextMessage } = require('./whatsappService');
const { createTicket, getTicketBySession, updateLastMessage } = require('./queueService');
const config = require('../utils/config');

// Sessões em memória (para produção, ideal mover para Redis/DB)
/** @type {Map<string, import('../../engine/flowTypes').ConversationState>} */
const sessions = new Map();

/**
 * Cria um NodeRegistry completo com todos os handlers padrão.
 *
 * @returns {NodeRegistry}
 */
function createNodeRegistry() {
  const registry = new NodeRegistry();
  registry.register('start', startNodeHandler);
  registry.register('message', messageNodeHandler);
  registry.register('user_input', userInputNodeHandler);
  registry.register('router', routerNodeHandler);
  registry.register('set_variable', setVariableNodeHandler);
  registry.register('handoff', handoffNodeHandler);
  registry.register('end', endNodeHandler);
  registry.register('ai', aiNodeHandler);
  registry.register('ai_task', aiTaskNodeHandler);
  // Nós de persistência
  registry.register('get_flow_info', getFlowInfoNodeHandler);
  registry.register('get_queue_status', getQueueStatusNodeHandler);
  registry.register('get_config_value', getConfigValueNodeHandler);
  registry.register('list_flows', listFlowsNodeHandler);
  return registry;
}

/**
 * Cria estado inicial de conversa para um número do WhatsApp.
 *
 * @param {import('../../engine/flowTypes').FlowDefinition} flow
 * @param {string} sessionId
 * @param {string} from
 * @returns {import('../../engine/flowTypes').ConversationState}
 */
function createInitialState(flow, sessionId, from) {
  const compiledFlow = getOrCompileFlow(flow);
  const startNode = compiledFlow.nodes.find((n) => n.type === 'start');

  return {
    tenantId: flow.tenantId,
    sessionId,
    flowId: flow.id,
    flowVersion: flow.version,
    currentNodeId: startNode ? startNode.id : null,
    variables: {},
    history: [],
    metadata: {
      channel: 'whatsapp',
      phoneNumber: from,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Processa uma mensagem vinda do webhook do WhatsApp.
 *
 * @param {any} message - Objeto de mensagem do webhook do WhatsApp (value.messages[i])
 * @param {any} value - Objeto "value" completo do webhook (contém metadata da conversation)
 * @param {{ flows: Map<string, any>, sessionEvents: Map<string, any[]> }} deps
 */
async function processWhatsAppMessage(message, value, deps) {
  const { flows, sessionEvents } = deps;

  const from = message.from; // número do usuário (ex.: "5511999999999")
  const text = message.text && message.text.body ? String(message.text.body) : '';
  const messageId = message.id;
  const sessionId = `whatsapp_${from}`;

  let state = sessions.get(sessionId);

  // Verifica se já existe ticket ativo (handoff em andamento)
  const existingTicket = getTicketBySession(sessionId);
  if (existingTicket && existingTicket.status !== 'closed') {
    // Atualiza última mensagem do usuário no ticket
    updateLastMessage(existingTicket.id, text);
    // Não processa mensagens do bot durante atendimento humano
    // O atendente deve responder manualmente via painel
    return;
  }

  // Se não existe sessão, cria nova baseada em um fluxo padrão
  if (!state) {
    const defaultFlowId = config.get('flows.defaultFlowId');
    if (!defaultFlowId) {
      // eslint-disable-next-line no-console
      console.error('DEFAULT_FLOW_ID não configurado em config.json');
      await sendTextMessage(from, 'Serviço indisponível no momento.');
      return;
    }

    const flow = flows.get(defaultFlowId);
    if (!flow) {
      // eslint-disable-next-line no-console
      console.error(`Flow ${defaultFlowId} não encontrado`);
      await sendTextMessage(from, 'Serviço indisponível no momento.');
      return;
    }

    state = createInitialState(flow, sessionId, from);
  }

  const flow = flows.get(state.flowId);
  if (!flow) {
    // eslint-disable-next-line no-console
    console.error(`Flow ${state.flowId} não encontrado`);
    await sendTextMessage(from, 'Serviço indisponível no momento.');
    return;
  }

  const compiledFlow = getOrCompileFlow(flow);
  const registry = createNodeRegistry();

  // Executa UM passo com input do usuário
  const persistenceServices = require('../../engine/services/persistenceServices');
  const result = await executeStep(state, compiledFlow, {
    registry,
    input: {
      text,
      messageId,
      channel: 'whatsapp',
      raw: message,
    },
    deps: {
      persistence: persistenceServices,
    },
  });

  // Atualiza sessão
  sessions.set(sessionId, result.state);

  // Guarda eventos para replay
  const existingEvents = sessionEvents.get(sessionId) || [];
  sessionEvents.set(sessionId, existingEvents.concat(result.events || []));

  // Verifica se a sessão está em atendimento humano (após execução)
  const isInHumanHandoff = result.state.metadata && result.state.metadata.status === 'waiting_human';

  // Se a engine devolveu uma mensagem, envia para o WhatsApp
  if (result.output) {
    // 1) Trata handoff: cria ticket e informa o usuário
    if (result.output.type === 'handoff') {
      const queue = result.output.queue || 'default';
      const ticket = createTicket({
        sessionId,
        queue,
        lastUserMessage: text,
      });

      // Mensagem informativa para o usuário
      await sendTextMessage(
        from,
        'Vou transferir você para um atendente humano. Aguarde um momento, por favor. 📞'
      );

      // eslint-disable-next-line no-console
      console.log(`[HANDOFF] Ticket criado: ${ticket.id} na fila "${queue}" para sessão ${sessionId}`);
      return; // Não continua processando como mensagem normal
    }

    // 3) Caso contrário, processa mensagens normais (message/ai)
    let messageText = null;

    if (result.output.type === 'message' && result.output.text) {
      messageText = result.output.text;
    } else if (result.output.type === 'ai' && result.output.text) {
      messageText = result.output.text;
    }

    if (messageText) {
      await sendTextMessage(from, messageText);
    }
  }
}

module.exports = {
  processWhatsAppMessage,
};


