/**
 * Tipos básicos da engine de fluxo de chatbot.
 *
 * Observação importante:
 * - Usamos JSDoc para tipos em vez de TypeScript para evitar
 *   dependências e build desnecessários.
 * - A engine é totalmente stateless: nenhuma função mantém
 *   estado interno entre chamadas. Todo estado vem de fora.
 */

/**
 * @typedef {Object} FlowNode
 * @property {string} id            - Identificador único do nó dentro do fluxo
 * @property {string} type          - Tipo do nó (ex: "message", "user_input", "router", "handoff", "ai", "end")
 * @property {Object<string, any>} [config] - Configuração específica do nó (schema varia conforme o type)
 * @property {string|string[]|Object<string, (string|string[]|null)>|null} [next]
 *   - Próximo nó:
 *   - string: conexão única (compat)
 *   - array: múltiplas conexões (compat)
 *   - object: roteamento por porta (ex.: { out: "n2", error: "n3", timeout: "n4" })
 */

/**
 * @typedef {Object} FlowDefinition
 * @property {string} tenantId
 * @property {string} id
 * @property {string} name
 * @property {number} version
 * @property {FlowNode[]} nodes
 * @property {Object<string, any>} [metadata]
 */

/**
 * Representação compilada de um fluxo.
 *
 * Decisões de contrato:
 * - Estrutura de dados ainda é um objeto plano serializável em JSON.
 * - O objeto é profundamente imutável (Object.freeze em toda árvore).
 * - Não há referências compartilhadas com o FlowDefinition original.
 * - Inclui um hash estável do conteúdo da versão, útil para
 *   cache, auditoria e rollback controlado.
 *
 * @typedef {Object} CompiledFlow
 * @property {string} tenantId
 * @property {string} id
 * @property {string} name
 * @property {number} version
 * @property {string} versionHash   - Hash estável do conteúdo da versão (gerado em compileFlow)
 * @property {FlowNode[]} nodes
 * @property {Object<string, any>} [metadata]
 */

/**
 * Estado externo da conversa (sessão de chatbot).
 *
 * Decisão importante:
 * - Este modelo é SEPARADO do fluxo (FlowDefinition/CompiledFlow).
 * - Totalmente serializável em JSON (apenas primitivos, arrays e objetos
 *   planos), facilitando persistência em banco ou cache.
 * - Suporta replay passo a passo via:
 *   - currentNodeId (posição atual no fluxo)
 *   - variables (contexto acumulado)
 *   - history (linha do tempo compacta de interações)
 *
 * @typedef {Object} ConversationState
 * @property {string} tenantId            - Identificador do tenant ao qual esta sessão pertence
 * @property {string} sessionId           - Identificador único da sessão/conversa
 * @property {string} flowId              - Referência ao fluxo em execução (id do fluxo)
 * @property {number} flowVersion         - Versão específica do fluxo usada nesta sessão (fixa durante toda a conversa)
 * @property {string|null} currentNodeId  - Nó atual no fluxo, ou null se a conversa terminou
 * @property {Object<string, any>} variables - Variáveis de contexto da conversa (slots, flags, etc.)
 * @property {Array<ChatHistoryItem>} history - Histórico compacto de mensagens/ações em ordem cronológica
 * @property {Object<string, any>} [metadata] - Metadados adicionais (canal, usuário, etc.)
 */

/**
 * Item de histórico de chat, pensado para:
 * - Visualização rápida (transcript)
 * - Replay passo a passo (reconstrução da linha do tempo)
 *
 * Observação:
 * - Este modelo é propositalmente simples e redundante em relação
 *   a EngineEvent; ele é um "resumo" amigável para consumo de UI.
 *
 * @typedef {Object} ChatHistoryItem
 * @property {string} id             - ID único do item no histórico
 * @property {"user"|"bot"|"system"} role - Origem da mensagem/ação
 * @property {string} type           - Tipo lógico (ex.: "message", "handoff", "info")
 * @property {string} text           - Texto principal exibido (se aplicável)
 * @property {string} timestamp      - ISO string do momento do evento
 * @property {string|null} nodeId    - Nó do fluxo associado, se houver
 * @property {Object<string, any>} [payload] - Dados extras (ex.: fila de handoff, variáveis relevantes)
 */

/**
 * Evento emitido pela engine para permitir:
 * - Logs estruturados
 * - Replay completo da conversa
 *
 * A ideia é que o "mundo externo" persista esses eventos
 * (por ex. em uma tabela de logs) e possa reconstruir a
 * conversa apenas a partir deles.
 *
 * @typedef {Object} EngineEvent
 * @property {string} id              - ID único do evento (pode ser um UUID gerado externamente)
 * @property {string} timestamp       - ISO string (new Date().toISOString())
 * @property {string} sessionId
 * @property {string} flowId
 * @property {string|null} nodeId     - Nó associado ao evento, se houver
 * @property {string} type            - Tipo do evento (ex: "NODE_ENTER", "NODE_EXIT", "MESSAGE_OUT", "MESSAGE_IN", "HANDOFF", "ERROR")
 * @property {Object<string, any>} [payload] - Dados adicionais relevantes ao evento
 */

/**
 * Saída de um passo de execução da engine.
 *
 * @typedef {Object} EngineStepOutput
 * @property {ConversationState} nextState   - Novo estado da conversa após a execução
 * @property {EngineEvent[]} events          - Eventos gerados neste passo (para log e replay)
 * @property {Object<string, any>} [output]  - Dados de alto nível para o chamador (ex: próxima mensagem a ser enviada)
 */

/**
 * Dependências disponíveis para handlers de nós.
 * 
 * Permite que nós acessem serviços externos (persistência, APIs, etc.)
 * sem acoplar a engine diretamente a implementações específicas.
 * 
 * @typedef {Object} NodeDependencies
 * @property {Object} persistence - Serviços de persistência
 * @property {Function} persistence.getFlows - Obtém todos os fluxos (() => Promise<Array>)
 * @property {Function} persistence.getFlow - Obtém um fluxo por ID ((flowId: string) => Promise<Object|null>)
 * @property {Function} persistence.findFlows - Busca fluxos por critério ((criteria: Object) => Promise<Array>)
 * @property {Function} persistence.getQueuesData - Obtém dados de filas (() => Promise<Object>)
 * @property {Function} persistence.getQueueTickets - Obtém tickets de uma fila ((queueName: string, options?: Object) => Promise<Array>)
 * @property {Function} persistence.getQueueInfo - Obtém informações de uma fila ((queueName: string) => Promise<Object>)
 * @property {Function} persistence.listQueues - Lista todas as filas (() => Promise<Array<string>>)
 * @property {Function} persistence.getConfig - Obtém configuração do sistema (() => Promise<Object>)
 * @property {Function} persistence.getConfigValue - Obtém valor específico da config ((path: string, defaultValue?: any) => Promise<any>)
 * @property {import('./nodeRegistry').NodeRegistry} [registry] - Registro de handlers de nós (opcional, para subfluxos)
 */

/**
 * Representa um handler de nó.
 * Importante: handlers devem ser puros em termos de estado da conversa;
 * side-effects externos (chamadas a IA, integrações) podem existir,
 * mas o resultado final deve ser completamente descrito por:
 * - estado de entrada
 * - nó atual
 * - input opcional
 * - dependências opcionais
 *
 * @callback NodeHandler
 * @param {FlowNode} node
 * @param {ConversationState} state
 * @param {Object<string, any>|undefined} input - Input opcional (ex: mensagem do usuário)
 * @param {NodeDependencies|undefined} [deps] - Dependências opcionais (serviços de persistência, etc.)
 * @returns {Promise<EngineStepOutput>} Próximo estado + eventos
 */

module.exports = {
  // Apenas exportamos um objeto vazio para permitir require deste módulo.
  // Os tipos são puramente JSDoc e não existem em runtime.
};


