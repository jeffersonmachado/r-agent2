/**
 * Serviço para gerar fluxos a partir de descrições em linguagem natural.
 * 
 * Este serviço atua como um operador especialista do DESIGNER DE FLUXOS.
 * Ele NÃO cria lógica livre, NÃO inventa nós e NÃO ignora regras.
 * Ele atua exatamente como um usuário avançado utilizando o editor visual.
 */

const { generateAiResponse } = require('./aiProviderService');
const { validateFlow } = require('../../engine/validator');
const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

// Fonte da verdade (backend) para tipos/configs permitidos
const CHATBOT_NODE_TYPES_PATH = path.join(__dirname, '..', 'data', 'rag', 'chatbot', 'nodes', 'node.types.json');

let _cachedNodeTypes = null;
function loadChatbotNodeTypes() {
  if (_cachedNodeTypes) return _cachedNodeTypes;
  try {
    const raw = fs.readFileSync(CHATBOT_NODE_TYPES_PATH, 'utf8');
    _cachedNodeTypes = JSON.parse(raw);
    return _cachedNodeTypes;
  } catch (err) {
    logger.error('[flowGenerator] Falha ao carregar node.types.json (fallback mínimo)', {
      error: safeErrorMessage(err),
      path: CHATBOT_NODE_TYPES_PATH,
    });
    _cachedNodeTypes = { nodeTypes: { core: {}, system: {} } };
    return _cachedNodeTypes;
  }
}

/**
 * Gera um prompt estruturado para a IA gerar um fluxo válido
 */
function buildGenerationPrompt(userDescription, tenantId) {
  const nodeTypesJson = loadChatbotNodeTypes();
  const core = nodeTypesJson?.nodeTypes?.core || {};
  const system = nodeTypesJson?.nodeTypes?.system || {};

  // Lista de tipos de nós disponíveis (fonte backend; evita dependência do frontend)
  const availableNodeTypes = Array.from(new Set([
    ...Object.keys(core),
    ...Object.keys(system),
  ])).filter((type) => type !== 'fallback'); // Fallback é opcional

  // Extrai informações sobre config de cada nó (suficiente para instruir a IA)
  const nodeInfo = availableNodeTypes.map((type) => {
    const def = core[type] || system[type] || {};
    const config = def.config || {};
    return {
      type,
      description: def.description || '',
      configSchema: config,
      constraints: {
        required: def.required === true,
        maxPerFlow: Object.prototype.hasOwnProperty.call(def, 'maxPerFlow') ? def.maxPerFlow : null,
        minPerFlow: Object.prototype.hasOwnProperty.call(def, 'minPerFlow') ? def.minPerFlow : null,
        hasInputs: Object.prototype.hasOwnProperty.call(def, 'hasInputs') ? def.hasInputs : null,
        hasOutputs: Object.prototype.hasOwnProperty.call(def, 'hasOutputs') ? def.hasOutputs : null,
      },
    };
  });

  const prompt = `Você é um operador especialista do DESIGNER DE FLUXOS da plataforma.
Você NÃO cria lógica livre, NÃO inventa nós e NÃO ignora regras.
Você atua exatamente como um usuário avançado utilizando o editor visual.

Fonte da Verdade
O DESIGNER é a única fonte da verdade.
Você só pode utilizar:

* Tipos de nós existentes: ${availableNodeTypes.join(', ')}
* Propriedades existentes de cada nó
* Regras de conexão definidas
* Regras de validação do fluxo

Nunca extrapole o que o designer permite.

---

Objetivo
A partir da descrição em linguagem natural fornecida pelo usuário, gerar um fluxo COMPLETO, VÁLIDO e EDITÁVEL, exclusivamente usando os componentes do designer.

---

Informações dos Nós Disponíveis (backend source-of-truth):

${JSON.stringify(nodeInfo, null, 2)}

---

Regras Absolutas (NUNCA VIOLAR)

1. NÃO crie tipos de nós inexistentes
2. NÃO crie propriedades que não estejam no schema
3. NÃO conecte nós de forma inválida
4. NÃO deixe nós desconectados, exceto quando permitido
5. NÃO gere fluxos sem um nó inicial (start)
6. NÃO gere fluxos sem caminho de finalização quando aplicável
7. NÃO utilize lógica implícita — tudo deve estar explícito no fluxo
8. NÃO utilize placeholders genéricos como "TODO"
9. NÃO invente integrações, APIs ou variáveis inexistentes

---

Formato da Resposta (OBRIGATÓRIO)

Você DEVE retornar APENAS um JSON válido, sem explicações, sem comentários, sem texto adicional.

O JSON deve conter:

{
  "action": "create_flow",
  "metadata": {
    "name": "Nome do fluxo",
    "description": "Descrição curta do fluxo"
  },
  "nodes": [
    {
      "id": "string",
      "type": "tipo_existente_no_designer",
      "config": {
        "campo": "valor"
      },
      "next": "node_id_destino"
    }
  ],
  "edges": [
    {
      "from": "node_id_origem",
      "to": "node_id_destino"
    }
  ]
}

---

Descrição do Usuário:

${userDescription}

---

Gere APENAS o JSON válido, sem explicações adicionais.`;

  return prompt;
}

/**
 * Extrai JSON da resposta da IA
 */
function extractJsonFromResponse(text) {
  // Tenta encontrar JSON no texto
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.warn('Erro ao fazer parse do JSON extraído', { error: safeErrorMessage(err) });
    }
  }
  
  // Se não encontrou, tenta fazer parse direto
  try {
    return JSON.parse(text);
  } catch (err) {
    logger.warn('Erro ao fazer parse direto do texto', { error: safeErrorMessage(err) });
    throw new Error('Resposta da IA não contém JSON válido');
  }
}

/**
 * Gera um ID único para o fluxo
 */
function generateFlowId(name) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  const timestamp = Date.now();
  return `flow-${base}-${timestamp}`;
}

/**
 * Garante que o fluxo tem metadados obrigatórios
 */
function ensureFlowMetadata(flowData, tenantId) {
  return {
    id: flowData.id || generateFlowId(flowData.metadata?.name || 'novo-fluxo'),
    tenantId: tenantId || 'default',
    version: 1,
    name: flowData.metadata?.name || 'Novo Fluxo',
    description: flowData.metadata?.description || '',
    nodes: flowData.nodes || [],
    ...flowData,
  };
}

/**
 * Converte edges para formato next dos nós
 */
function convertEdgesToNext(nodes, edges) {
  const nodeMap = new Map();
  nodes.forEach(node => {
    nodeMap.set(node.id, { ...node });
  });

  // Cria mapa de conexões
  const connections = new Map();
  edges.forEach(edge => {
    if (!connections.has(edge.from)) {
      connections.set(edge.from, []);
    }
    connections.get(edge.from).push(edge.to);
  });

  // Aplica conexões aos nós
  nodes.forEach(node => {
    const nodeConnections = connections.get(node.id);
    if (nodeConnections && nodeConnections.length > 0) {
      if (nodeConnections.length === 1) {
        node.next = nodeConnections[0];
      } else {
        node.next = nodeConnections;
      }
    }
  });

  return nodes;
}

/**
 * Gera um fluxo a partir de uma descrição em linguagem natural
 * 
 * @param {string} description - Descrição do fluxo em linguagem natural
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Fluxo gerado
 */
async function generateFlowFromDescription(description, tenantId = 'default') {
  try {
    logger.info('Gerando fluxo a partir de descrição', { 
      descriptionLength: description.length,
      tenantId,
    });

    // Constrói o prompt
    const prompt = buildGenerationPrompt(description, tenantId);

    // Gera resposta da IA
    logger.debug('Solicitando geração de fluxo à IA', { promptLength: prompt.length });
    const aiResult = await generateAiResponse(prompt, tenantId, {
      sessionId: 'flow-generation',
      flowId: 'generation',
      nodeId: 'generator',
    });

    // Extrai JSON da resposta
    const flowData = extractJsonFromResponse(aiResult.text);
    logger.debug('JSON extraído da resposta da IA', { 
      hasNodes: !!flowData.nodes,
      nodeCount: flowData.nodes?.length || 0,
      hasEdges: !!flowData.edges,
    });

    // Converte edges para formato next
    if (flowData.edges && flowData.edges.length > 0) {
      flowData.nodes = convertEdgesToNext(flowData.nodes || [], flowData.edges);
      delete flowData.edges; // Remove edges, pois agora está em next
    }

    // Garante metadados obrigatórios
    const flow = ensureFlowMetadata(flowData, tenantId);

    // Valida o fluxo gerado
    const validationResult = validateFlow(flow);
    if (!validationResult.valid) {
      logger.warn('Fluxo gerado tem erros de validação', {
        errorCount: validationResult.errors.length,
        errors: validationResult.errors.map(e => e.code),
      });
      // Ainda retorna o fluxo, mas com avisos
      flow.validationWarnings = {
        valid: false,
        errors: validationResult.errors,
      };
    } else {
      logger.info('Fluxo gerado e validado com sucesso', {
        flowId: flow.id,
        nodeCount: flow.nodes.length,
      });
    }

    return flow;
  } catch (error) {
    logger.error('Erro ao gerar fluxo', { error: safeErrorMessage(error) });
    throw error;
  }
}

module.exports = {
  generateFlowFromDescription,
};

