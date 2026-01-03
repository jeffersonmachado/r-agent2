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
  scheduleRouterNodeHandler,
  setVariableNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
  optionsNodeHandler,
} = require('../../engine/nodes/basicNodes');
const { aiNodeHandler } = require('../../engine/nodes/aiNode');
const { aiTaskNodeHandler } = require('../../engine/nodes/aiTaskNode');
const {
  getFlowInfoNodeHandler,
  getQueueStatusNodeHandler,
  getConfigValueNodeHandler,
  listFlowsNodeHandler,
} = require('../../engine/nodes/persistenceNodes');
const {
  getCurrentTimeNodeHandler,
  generateUuidNodeHandler,
  delayNodeHandler,
  formatDateNodeHandler,
  randomNumberNodeHandler,
  getUserInfoNodeHandler,
} = require('../../engine/nodes/systemNodes');
const { apiNodeHandler } = require('../../engine/nodes/apiNode');
const { fallbackNodeHandler } = require('../../engine/nodes/fallbackNode');
const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
const { sendTextMessage } = require('./whatsappService');
const logger = require('../utils/logger');
const { createTicket, getTicketBySession, updateLastMessage } = require('./queueService');
const { 
  createHumanSession, 
  isInHumanSession, 
  getHumanSession 
} = require('../../engine/services/humanLiveAdapter');
const { ESCALATION_MODES } = require('../../engine/fallbackController');
const config = require('../utils/config');
const { getAiProviderForTenant } = require('../../engine/aiProviderManager');

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
  registry.register('options', optionsNodeHandler);
  registry.register('router', routerNodeHandler);
  registry.register('schedule_router', scheduleRouterNodeHandler);
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
  // Nós de sistema
  registry.register('get_current_time', getCurrentTimeNodeHandler);
  registry.register('generate_uuid', generateUuidNodeHandler);
  registry.register('delay', delayNodeHandler);
  registry.register('format_date', formatDateNodeHandler);
  registry.register('random_number', randomNumberNodeHandler);
  registry.register('get_user_info', getUserInfoNodeHandler);
  // Nó de API
  registry.register('api', apiNodeHandler);
  // Nó de fallback
  registry.register('fallback', fallbackNodeHandler);
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
    // Atualiza última mensagem do usuário no ticket e adiciona ao histórico
    updateLastMessage(existingTicket.id, text);
    // Não processa mensagens do bot durante atendimento humano assíncrono
    // O atendente deve responder manualmente via painel
    // A mensagem já foi adicionada ao histórico e será exibida na interface
    return;
  }
  
  // Verifica se está em atendimento humano síncrono
  if (isInHumanSession(sessionId)) {
    // Durante atendimento humano síncrono, mensagens são roteadas para o humano
    // A implementação real de WebSocket/API deve ser feita na camada de API
    // Por enquanto, apenas logamos
    logger.debug(`[MessageProcessor] Mensagem recebida durante atendimento humano síncrono: ${sessionId}`);
    // TODO: Roteamento para humano via WebSocket/API
    return;
  }

  // Se não existe sessão, cria nova baseada em um fluxo padrão
  if (!state) {
    const defaultFlowId = config.get('flows.defaultFlowId');
    
    // Valida se defaultFlowId não é um placeholder
    if (!defaultFlowId || defaultFlowId === 'ID_DO_FLUXO_PADRAO' || defaultFlowId.includes('SEU_') || defaultFlowId.includes('YOUR_')) {
        logger.error('[ERROR] defaultFlowId não configurado ou é placeholder. Configure flows.defaultFlowId em config.json');
      try {
        await sendTextMessage(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
      }
      return;
    }

    const flow = flows.get(defaultFlowId);
    if (!flow) {
      logger.error(`[ERROR] Flow "${defaultFlowId}" não encontrado. Verifique se o fluxo existe e se flows.defaultFlowId está correto em config.json`);
      try {
        await sendTextMessage(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
      }
      return;
    }

    state = createInitialState(flow, sessionId, from);
  }

  const flow = flows.get(state.flowId);
  if (!flow) {
    logger.error(`[ERROR] Flow "${state.flowId}" não encontrado. Verifique se o fluxo existe.`);
    try {
      await sendTextMessage(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
    } catch (err) {
      logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
    }
    return;
  }

  const compiledFlow = getOrCompileFlow(flow);
  const registry = createNodeRegistry();

  // Executa UM passo com input do usuário
  const persistenceServices = require('../../engine/services/persistenceServices');
  
  // Obtém provider de IA para o tenant (para nós AI)
  const tenantId = state.tenantId || config.get('api.defaultTenantId', 'tenant-demo');
  const aiProvider = getAiProviderForTenant(tenantId);
  
  const result = await executeStep(state, compiledFlow, {
    registry,
    input: {
      text,
      messageId,
      channel: 'whatsapp',
      raw: message,
      aiProvider, // Injeta provider de IA
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
    // 1) Trata handoff (modo ticket): cria ticket e informa o usuário
    if (result.output.type === 'handoff' || 
        (result.output.type === 'fallback_human' && result.output.escalationMode === ESCALATION_MODES.TICKET)) {
      const queue = result.output.queue || 'default';
      
      // Preserva contexto completo do bot para o atendente
      const escalationContext = result.state.metadata?.humanEscalation || {};
      const botHistory = result.state.history || [];
      
      // Converte histórico do bot para formato de mensagens (apenas mensagens do bot)
      const botMessages = botHistory
        .filter(h => h.role === 'bot' && h.text)
        .map(h => ({
          id: h.id || `bot-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          text: h.text,
          sender: 'bot',
          timestamp: h.timestamp || new Date().toISOString(),
        }));
      
      const ticket = createTicket({
        tenantId: result.state.tenantId, // Usa tenantId do estado da conversa
        sessionId,
        queue,
        lastUserMessage: text,
        context: {
          flowId: result.state.flowId,
          escalationReason: result.output.fallbackType || escalationContext.reason || 'unknown',
          escalationAttempt: result.output.attempt || escalationContext.attempt || 1,
          botHistory: botMessages,
          variables: result.state.variables || {},
          allowReturnToBot: result.output.allowReturnToBot !== false,
          safeReturnNode: escalationContext.safeReturnNode || null,
          metadata: {
            flowVersion: result.state.flowVersion,
            currentNodeId: result.state.currentNodeId,
            channel: result.state.metadata?.channel || 'whatsapp',
          },
        },
      });

      // Mensagem informativa para o usuário
      const message = result.output.message || 
        'Vou transferir você para um atendente humano. Aguarde um momento, por favor. 📞';
      try {
        await sendTextMessage(from, message);
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de handoff:', err);
        // Continua mesmo se falhar o envio, pois o ticket já foi criado
      }

      logger.info(`[HANDOFF] Ticket criado: ${ticket.id} na fila "${queue}" para sessão ${sessionId} com contexto preservado`);
      return; // Não continua processando como mensagem normal
    }
    
    // 2) Trata atendimento humano síncrono
    if (result.output.type === 'fallback_human_live' || 
        (result.output.type === 'fallback_human' && result.output.escalationMode === ESCALATION_MODES.HUMAN)) {
      // Cria sessão de atendimento humano síncrono
      const humanSession = createHumanSession({
        sessionId,
        state: result.state,
        returnNodeId: result.state.metadata?.humanEscalation?.safeReturnNode || null,
      });

      // Mensagem informativa para o usuário
      const message = result.output.message || 
        'Conectando você com um atendente humano em tempo real...';
      try {
        await sendTextMessage(from, message);
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de atendimento humano:', err);
        // Continua mesmo se falhar o envio
      }

      logger.info(`[HUMAN_LIVE] Sessão humana criada: ${humanSession.humanSessionId} para sessão ${sessionId}`);
      
      // Suspende processamento do bot - humano assume
      // TODO: Implementar roteamento de mensagens para humano via WebSocket/API
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
      try {
        await sendTextMessage(from, messageText);
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem do bot:', err);
        // Não interrompe o fluxo, apenas loga o erro
      }
    }
  }
}

module.exports = {
  processWhatsAppMessage,
};


