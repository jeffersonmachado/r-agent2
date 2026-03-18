/**
 * Serviço de geração de fluxos a partir de descrições em linguagem natural.
 * 
 * Este serviço atua como um "operador especialista do DESIGNER DE FLUXOS",
 * gerando fluxos válidos e editáveis usando APENAS os componentes existentes.
 * 
 * REFATORADO: Agora usa o wrapper oficial generateChatbotFlow() que garante:
 * - Uso do prompt oficial (chatbot.generator.prompt.md)
 * - Validação obrigatória pelo gate (validateGeneratedPlan)
 * - Telemetria automática de falhas
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { generateChatbotViaCore } = require('./aiWrappersAdapter');
const ragService = require('./ragService');
const webScrapingService = require('./webScrapingService');
const { RecordingSystem } = require('../../lib/recordingSystem');
const path = require('path');
const { validateFlow } = require('../../engine/validator');

// Defensive coercion helpers
function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim(); } catch (_) { return fallback; }
}

function safeTrimLower(value, fallback = '') {
  const str = safeTrim(value, fallback);
  try { return str.toLowerCase(); } catch (_) { return fallback; }
}

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function extractTargetsFromNext(next) {
  if (!next) return [];
  if (typeof next === 'string') return [next];
  if (Array.isArray(next)) return next.filter((x) => typeof x === 'string');
  if (isObject(next)) {
    const out = [];
    for (const v of Object.values(next)) {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) out.push(...v.filter((x) => typeof x === 'string'));
    }
    return out;
  }
  return [];
}

function replaceNextTarget(next, fromId, toId) {
  if (!next) return next;
  if (typeof next === 'string') return next === fromId ? toId : next;
  if (Array.isArray(next)) return next.map((x) => (x === fromId ? toId : x));
  if (isObject(next)) {
    const updated = {};
    for (const [k, v] of Object.entries(next)) {
      if (typeof v === 'string') updated[k] = v === fromId ? toId : v;
      else if (Array.isArray(v)) updated[k] = v.map((x) => (x === fromId ? toId : x));
      else updated[k] = v;
    }
    return updated;
  }
  return next;
}

function slugifyLabel(value) {
  const raw = safeTrimLower(value);
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Migração determinística: remove router.contains (deprecado) de fluxos gerados
 * inserindo ai_task(intent_classification) + router.equals.
 *
 * Escopo (seguro):
 * - Só atua quando o router com contains tem predecessor direto (via next) do tipo user_input.
 * - Renomeia user_input.config.variable para "user_input" quando necessário (para alimentar ai_task).
 */
function migrateDeprecatedRouterContains(flow) {
  if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) return { changed: false };

  const nodes = flow.nodes;
  const nodesById = new Map(nodes.map((n) => [n && n.id, n]).filter(([id]) => typeof id === 'string' && id));

  const ensureUniqueId = (base) => {
    if (!nodesById.has(base)) return base;
    return `${base}_${uuidv4().slice(0, 8)}`;
  };

  const routers = nodes.filter((n) => n && n.type === 'router' && Array.isArray(n.config?.rules));
  let changed = false;

  for (const router of routers) {
    const routerId = router.id;
    const rules = Array.isArray(router.config?.rules) ? router.config.rules : [];
    const containsRules = rules.filter((r) => r && r.condition && r.condition.op === 'contains');
    if (containsRules.length === 0) continue;

    // predecessor direto via next
    const predecessors = nodes.filter((n) => {
      if (!n || typeof n.id !== 'string') return false;
      const targets = extractTargetsFromNext(n.next);
      return targets.includes(routerId);
    });
    if (predecessors.length !== 1) continue;

    const prev = predecessors[0];
    if (prev.type !== 'user_input') continue;

    // Garantia: ai_task lê variables.user_input
    prev.config = isObject(prev.config) ? prev.config : {};
    prev.config.variable = 'user_input';

    const aiTaskId = ensureUniqueId(`ai_task_${routerId}`);
    const labels = [];
    const keywords = {};

    for (const r of containsRules) {
      const val = r?.condition?.value;
      const label = slugifyLabel(val) || `cat_${labels.length + 1}`;
      if (!labels.includes(label)) labels.push(label);
      keywords[label] = [safeTrim(val)].filter(Boolean);
    }

    const aiTaskNode = {
      id: aiTaskId,
      type: 'ai_task',
      config: {
        task: 'intent_classification',
        allowedOutputs: labels,
        fallback: 'outro',
        confidenceThreshold: 0.0,
        keywords,
      },
      next: routerId,
    };

    // Insere ai_task antes do router (melhor legibilidade no editor)
    const routerIdx = nodes.findIndex((n) => n && n.id === routerId);
    if (routerIdx >= 0) {
      nodes.splice(routerIdx, 0, aiTaskNode);
    } else {
      nodes.push(aiTaskNode);
    }
    nodesById.set(aiTaskId, aiTaskNode);

    // Rewire prev -> ai_task
    prev.next = replaceNextTarget(prev.next, routerId, aiTaskId);

    // Reescreve regras contains -> equals comparando ai.<ai_task_id>.value
    for (const r of containsRules) {
      const val = r?.condition?.value;
      const label = slugifyLabel(val) || '';
      r.condition = {
        op: 'equals',
        var: `ai.${aiTaskId}.value`,
        value: label || `cat_${labels.length + 1}`,
      };
    }

    changed = true;
  }

  return { changed };
}

function normalizeQuestionsList(questions) {
  if (!Array.isArray(questions)) return [];
  const out = [];
  const seen = new Set();
  for (const q of questions) {
    if (typeof q !== 'string') continue;
    const trimmed = safeTrim(q);
    if (!trimmed) continue;
    const capped = trimmed.length > 220 ? trimmed.slice(0, 220) : trimmed;
    if (seen.has(capped)) continue;
    seen.add(capped);
    out.push(capped);
    if (out.length >= 50) break;
  }
  return out;
}

function formatQuestionsBlock(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return '';
  const lines = questions.map((q) => `- ${q}`);
  return [
    '## Perguntas (FAQ) que o bot deve saber responder',
    ...lines,
    '',
    'Requisitos obrigatórios:',
    '- O fluxo deve permitir que o usuário faça qualquer uma das perguntas acima.',
    '- Use um nó do tipo "ai" para responder, e habilite RAG quando disponível.',
    '- Se a resposta não estiver clara no conhecimento, peça esclarecimentos (não invente).',
    '',
  ].join('\n');
}

function applyFaqQuestionsToFlow(flow, questions, options = {}) {
  if (!flow || !Array.isArray(flow.nodes) || questions.length === 0) return flow;

  flow.metadata = {
    ...(flow.metadata || {}),
    faqQuestions: questions,
  };

  // Se já existe nó de IA, apenas reforça o prompt (best-effort).
  const firstAi = flow.nodes.find((n) => n && n.type === 'ai' && n.config && typeof n.config.promptTemplate === 'string');
  if (firstAi) {
    const appendix = [
      '',
      'Perguntas (FAQ) importantes que você deve conseguir responder:',
      ...questions.map((q) => `- ${q}`),
      '',
    ].join('\n');
    // Evita duplicar caso reprocessado
    if (!firstAi.config.promptTemplate.includes('Perguntas (FAQ) importantes')) {
      firstAi.config.promptTemplate = safeTrim(`${safeTrim(firstAi.config.promptTemplate)}\n${appendix}`);
    }
    return flow;
  }

  // Caso não haja nenhum nó de IA, injeta um bloco mínimo Q&A sem quebrar schema.
  const startNode = flow.nodes.find((n) => n && n.type === 'start') || null;
  const endNode = flow.nodes.find((n) => n && n.type === 'end') || null;

  const ensureId = (base) => {
    if (!flow.nodes.some((n) => n && n.id === base)) return base;
    return `${base}_${uuidv4().slice(0, 8)}`;
  };

  const userInputId = ensureId('user_input_faq');
  const aiId = ensureId('ai_faq');

  const entryId = startNode && typeof startNode.next === 'string' ? startNode.next : null;
  const entryNode = entryId ? flow.nodes.find((n) => n && n.id === entryId) : null;
  const endId = endNode ? endNode.id : null;
  const originalNextAfterEntry =
    entryNode && typeof entryNode.next === 'string' ? entryNode.next : endId;

  const promptTemplate = [
    'Você é o assistente do sistema.',
    '',
    'O usuário perguntou:',
    '{{user_message}}',
    '',
    'Responda de forma direta e útil. Use o conhecimento do RAG quando possível (não invente).',
    '',
    'Perguntas (FAQ) que você deve saber responder:',
    ...questions.map((q) => `- ${q}`),
    '',
  ].join('\n');

  const userInputNode = {
    id: userInputId,
    type: 'user_input',
    config: { variable: 'user_message' },
    next: aiId,
  };
  const aiNode = {
    id: aiId,
    type: 'ai',
    config: {
      promptTemplate,
      outputVariable: 'ai_output',
      // RAG é default true no handler; mantemos explícito para clareza.
      useRag: true,
    },
    next: (() => {
      const candidate = originalNextAfterEntry || endId;
      if (!candidate) return null;
      const candidateNode = flow.nodes.find((n) => n && n.id === candidate);
      // Se o próximo nó era um fallback (comum em fluxos mínimos), terminamos após responder.
      if (candidateNode && candidateNode.type === 'fallback' && endId) return endId;
      return candidate;
    })(),
  };

  // Se temos nó de entrada com next, injeta após ele. Caso contrário, conecta start diretamente.
  if (entryNode && entryNode.type === 'message') {
    entryNode.next = userInputId;
  } else if (startNode) {
    startNode.next = userInputId;
  } else {
    // Fallback extremo: cria um start
    const newStartId = ensureId('start');
    flow.nodes.unshift({ id: newStartId, type: 'start', next: userInputId });
  }

  // Garante end
  if (!endNode) {
    const newEndId = ensureId('end');
    flow.nodes.push({ id: newEndId, type: 'end' });
    aiNode.next = newEndId;
  }

  // Insere nós após o entry (ou ao final, se não achar)
  flow.nodes.push(userInputNode, aiNode);

  // Remove nós órfãos (best-effort) para não quebrar validações de conectividade.
  try {
    const byId = new Map(flow.nodes.map((n) => [n && n.id, n]).filter(([id]) => !!id));
    const reachable = new Set();
    const queue = [];

    const pushNext = (next) => {
      if (!next) return;
      if (typeof next === 'string') {
        if (!reachable.has(next)) queue.push(next);
        return;
      }
      if (Array.isArray(next)) {
        next.forEach(pushNext);
        return;
      }
      if (typeof next === 'object') {
        Object.values(next).forEach(pushNext);
      }
    };

    const start = byId.get(startNode?.id) || flow.nodes.find((n) => n && n.type === 'start');
    if (start && start.id) {
      reachable.add(start.id);
      pushNext(start.next);
    }

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      const node = byId.get(id);
      if (node) pushNext(node.next);
    }

    flow.nodes = flow.nodes.filter((n) => n && n.id && reachable.has(n.id));
  } catch {
    // best-effort
  }

  return flow;
}

/**
 * Constrói o prompt para a IA gerar o fluxo.
 * 
 * @param {string} description - Descrição do usuário
 * @returns {string} - Prompt estruturado para a IA
 */
function buildFlowGenerationPrompt(description) {
  return `Você é um operador especialista do DESIGNER DE FLUXOS. Sua tarefa é gerar um fluxo COMPLETO e VÁLIDO a partir de uma descrição em linguagem natural.

REGRAS ABSOLUTAS:
1. Use APENAS os tipos de nós existentes: start, message, user_input, router, semantic_router, business_entry, rag_answer, ai_task, set_variable, handoff, ai, fallback, end
2. Todo fluxo DEVE ter exatamente 1 nó "start" e pelo menos 1 nó "end"
3. Todos os nós devem estar conectados (sem nós órfãos)
4. NÃO invente propriedades - use apenas as propriedades válidas de cada tipo de nó
5. Retorne APENAS um JSON válido, sem explicações, sem markdown, sem comentários

TIPOS DE NÓS DISPONÍVEIS E SUAS PROPRIEDADES:

1. start:
   - type: "start"
   - next: "id_do_proximo_no" (obrigatório)

2. message:
   - type: "message"
   - config: { text: "texto da mensagem" }
   - next: "id_do_proximo_no"

3. user_input:
   - type: "user_input"
   - config: { variable: "nome_da_variavel" }
   - next: "id_do_proximo_no"

4. router:
   - type: "router"
   - config: {
       rules: [
         {
           condition: { op: "equals|contains|always", var: "nome_variavel", value: "valor" },
           next: "id_do_proximo_no"
         }
       ]
     }
   - next: "id_do_proximo_no" (opcional, usado como fallback)

5. semantic_router:
   - type: "semantic_router"
   - config: {
       confidenceThreshold: 0.6,
       examples: ["exemplo 1", "exemplo 2"]
     }
   - next: { main: "id_do_proximo_no", fallback: "id_fallback" }

6. business_entry:
   - type: "business_entry"
   - config: {}
   - next: { selected: "id_do_proximo_no", skip: "id_skip" }

7. rag_answer:
   - type: "rag_answer"
   - config: {
       topK: 5,
       promptTemplate: "template com {{variavel}}",
       temperature: 0.2
     }
   - next: "id_do_proximo_no"

8. ai_task:
   - type: "ai_task"
   - config: {
       task: "intent_classification",
       allowedOutputs: ["intenção1", "intenção2"],
       fallback: "outro",
       confidenceThreshold: 0.75
     }
   - next: "id_do_proximo_no"

9. set_variable:
   - type: "set_variable"
   - config: {
       assignments: {
         "nome_variavel": "valor"
       }
     }
   - next: "id_do_proximo_no"

10. handoff:
   - type: "handoff"
   - config: { queue: "nome_da_fila" }
   - next: "id_do_proximo_no"

11. ai:
   - type: "ai"
   - config: {
       promptTemplate: "template com {{variavel}}",
       outputVariable: "nome_variavel"
     }
   - next: "id_do_proximo_no"

12. fallback:
   - type: "fallback"
   - config: {
       maxAttempts: 3,
       confidenceThreshold: 0.75,
       escalationMode: "ticket|human",
       queue: "nome_fila" (se escalationMode = "ticket")
     }

13. end:
    - type: "end"
    - (sem next, sem config)

FORMATO DE RESPOSTA (JSON):
{
  "action": "create_flow",
  "metadata": {
    "name": "Nome do fluxo",
    "description": "Descrição curta"
  },
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "next": "msg1"
    },
    {
      "id": "msg1",
      "type": "message",
      "config": {
        "text": "Olá! Como posso ajudar?"
      },
      "next": "end"
    },
    {
      "id": "end",
      "type": "end"
    }
  ],
  "edges": []
}

NOTA: O campo "edges" não é necessário - as conexões são definidas pelo campo "next" de cada nó.

DESCRIÇÃO DO USUÁRIO:
${description}

Gere o fluxo JSON agora (APENAS JSON, sem explicações):`;
}

/**
 * Parseia a resposta da IA e extrai o JSON do fluxo.
 * 
 * @param {string} aiResponse - Resposta da IA
 * @returns {Object|null} - Fluxo parseado ou null se inválido
 */
function parseAiResponse(aiResponse) {
  try {
    // Tenta extrair JSON da resposta (pode vir com markdown ou texto adicional)
    let jsonStr = safeTrim(aiResponse);
    
    // Remove markdown code blocks se existirem
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    
    // Tenta encontrar o JSON entre chaves
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Valida estrutura básica
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
      logger.warn('Resposta da IA não contém array de nodes válido');
      return null;
    }
    
    return parsed;
  } catch (err) {
    logger.error('Erro ao parsear resposta da IA', {
      error: safeErrorMessage(err),
      response: safeToString(aiResponse).slice(0, 200),
    });
    return null;
  }
}

/**
 * Converte o formato do wrapper (com action/metadata) para FlowDefinition
 * 
 * @param {Object} wrapperResult - Resultado do generateChatbotFlow
 * @param {string} flowId - ID do fluxo
 * @param {string} tenantId - ID do tenant
 * @param {string} flowName - Nome do fluxo
 * @param {string} description - Descrição original
 * @returns {Object} - FlowDefinition formatado
 */
function convertWrapperResultToFlowDefinition(wrapperResult, flowId, tenantId, flowName, description) {
  const generatedFlow = wrapperResult.flow;
  
  // O wrapper retorna formato: { action, metadata, nodes, edges }
  // Precisamos converter para FlowDefinition: { id, tenantId, name, version, nodes, metadata }
  const flow = {
    id: flowId,
    tenantId,
    name: generatedFlow.metadata?.name || flowName,
    version: 1,
    nodes: generatedFlow.nodes || [],
    metadata: {
      generated: true,
      generatedBy: 'ai',
      description: safeToString(description),
      generatedAt: new Date().toISOString(),
      promptVersion: wrapperResult.promptVersion,
      validation: wrapperResult.validation,
    },
  };
  
  // Garante que há nó start e end (validação adicional)
  const hasStart = flow.nodes.some(n => n.type === 'start');
  const hasEnd = flow.nodes.some(n => n.type === 'end');
  
  if (!hasStart) {
    flow.nodes.unshift({
      id: 'start',
      type: 'start',
      next: flow.nodes[0]?.id || 'end',
    });
  }
  
  if (!hasEnd) {
    flow.nodes.push({
      id: 'end',
      type: 'end',
    });
  }
  
  // Garante que todos os caminhos terminem em end (suporta next: string | string[] | object)
  const endNodeId = flow.nodes.find(n => n.type === 'end')?.id || 'end';
  const nodeIdsSet = new Set((flow.nodes || []).map((n) => safeToString(n?.id || '')));
  flow.nodes.forEach((node) => {
    if (!node || !node.next) return;

    // next como string
    if (typeof node.next === 'string') {
      if (!nodeIdsSet.has(safeToString(node.next))) {
        node.next = endNodeId;
      }
      return;
    }

    // next como array
    if (Array.isArray(node.next)) {
      node.next = node.next.map((nextId) => (nodeIdsSet.has(safeToString(nextId)) ? nextId : endNodeId));
      return;
    }

    // next como objeto (ex.: { out: 'n2', error: 'n3', end: 'end' })
    if (typeof node.next === 'object') {
      const updated = {};
      for (const [key, rawValue] of Object.entries(node.next)) {
        if (rawValue == null) {
          updated[key] = rawValue;
          continue;
        }
        if (typeof rawValue === 'string') {
          updated[key] = nodeIdsSet.has(safeToString(rawValue)) ? rawValue : endNodeId;
          continue;
        }
        if (Array.isArray(rawValue)) {
          updated[key] = rawValue.map((nextId) => (nodeIdsSet.has(safeToString(nextId)) ? nextId : endNodeId));
          continue;
        }
        // valor inesperado: converte para end
        updated[key] = endNodeId;
      }
      node.next = updated;
    }
  });

  // Garante que existe pelo menos 1 nó fallback (validação semântica exige fallback global)
  const hasFallback = flow.nodes.some((n) => n && n.type === 'fallback');
  if (!hasFallback) {
    const ensureUniqueId = (base) => {
      if (!flow.nodes.some((n) => n && n.id === base)) return base;
      return `${base}_${uuidv4().slice(0, 8)}`;
    };
    const fallbackNodeId = ensureUniqueId('fallback_1');
    flow.nodes.push({
      id: fallbackNodeId,
      type: 'fallback',
      config: {
        maxAttempts: 3,
        confidenceThreshold: 0.75,
        escalationMode: 'ticket',
      },
      // fallback.next deve ser mapa (retry/options/human/end). Aqui garantimos pelo menos end.
      next: { end: endNodeId },
    });

    // Best-effort: evita nós soltos sem next (encaminha para fallback)
    flow.nodes.forEach((node) => {
      if (!node) return;
      if (node.type === 'start' || node.type === 'end' || node.type === 'fallback') return;
      if (node.next === null || node.next === undefined || node.next === '') {
        node.next = fallbackNodeId;
      }
    });
  }
  
  return flow;
}

/**
 * Resolve contexto de conhecimento a partir de RAG e scraping.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Se options.ragContext está disponível (vindo do pipeline), USA ELE (obrigatório)
 * - Se useRag=true mas não há ragContext, FALHA (não faz consulta nova)
 * - Nunca faz fallback silencioso quando RAG é obrigatório
 * 
 * @param {string} description - Descrição do fluxo
 * @param {Object} options - Opções (useRag, ragContext, ragSources, useWebScraping, scrapingTargets, tenantId)
 * @returns {Promise<string>} - Contexto adicional para o prompt
 */
async function resolveKnowledgeContext(description, options = {}) {
  const { useRag, ragContext, ragSources, useWebScraping, scrapingTargets, tenantId } = options;
  const contextParts = [];

  // RAG: conhecimento interno
  if (useRag) {
    // Se contexto RAG foi fornecido pelo pipeline, USA ELE (obrigatório)
    if (ragContext && ragContext.enabled && ragContext.chunks && ragContext.chunks.length > 0) {
      logger.info('[flowGeneratorService] Usando contexto RAG do pipeline', {
        executionId: ragContext.executionId,
        chunksCount: ragContext.chunks.length,
        sourcesCount: ragContext.sources.length,
      });
      
      // Constrói contexto a partir dos chunks do pipeline
      const ragContextParts = [];
      ragContextParts.push(`\n## Conhecimento Interno (RAG) - Execution ID: ${ragContext.executionId || 'N/A'}:\n`);
      
      ragContext.chunks.forEach((chunk, index) => {
        ragContextParts.push(`\n### Fonte ${index + 1} (${chunk.sourceFile || 'unknown'}):\n${chunk.content}\n`);
      });
      
      ragContextParts.push(`\n### Fontes utilizadas:\n${ragContext.sources.map(s => `- ${s.documentId || s} (${s.chunksCount || 0} chunks)`).join('\n')}\n`);
      
      contextParts.push(ragContextParts.join('\n'));
      
      logger.debug('[flowGeneratorService] Contexto RAG do pipeline aplicado', {
        chunksCount: ragContext.chunks.length,
        sourcesCount: ragContext.sources.length,
      });
    } else {
      // Se useRag=true mas não há contexto RAG, isso é um erro
      const errorMsg = 'useRag=true mas contexto RAG não foi fornecido pelo pipeline. Etapa ragContextBuilt deve ser concluída antes.';
      logger.error('[flowGeneratorService] Contexto RAG obrigatório ausente', {
        useRag,
        hasRagContext: !!ragContext,
        ragContextEnabled: ragContext?.enabled,
      });
      throw new Error(errorMsg);
    }
  }

  // Web Scraping: fontes externas
  if (useWebScraping && scrapingTargets && scrapingTargets.length > 0) {
    logger.info('Resolvendo contexto de scraping', { urlsCount: scrapingTargets.length });
    const scrapingResults = [];
    
    for (const url of scrapingTargets) {
      const cleanUrl = safeTrim(url);
      if (!cleanUrl) continue;
      
      try {
        const scrapeResult = await webScrapingService.scrapeUrl(cleanUrl, {
          tenantId: tenantId || 'demo-tenant',
          autoIndex: false, // Não indexa automaticamente durante geração
        });
        
        if (scrapeResult.success && scrapeResult.content) {
          scrapingResults.push(`\n### ${scrapeResult.title || cleanUrl}:\n${scrapeResult.content.substring(0, 1000)}...\n`);
          logger.debug('URL raspada com sucesso', { url: cleanUrl, contentLength: scrapeResult.contentLength });
        }
      } catch (scrapeError) {
        logger.warn('Erro ao raspar URL, continuando', { url: cleanUrl, error: safeErrorMessage(scrapeError) });
      }
    }
    
    if (scrapingResults.length > 0) {
      contextParts.push(`\n## Fontes Externas (Scraping):\n${scrapingResults.join('\n')}\n`);
    }
  }

  return contextParts.join('\n');
}

/**
 * Gera um fluxo a partir de uma descrição em linguagem natural usando IA.
 * 
 * REFATORADO: Agora usa o wrapper oficial generateChatbotFlow() que garante:
 * - Uso do prompt oficial (chatbot.generator.prompt.md)
 * - Validação obrigatória pelo gate (validateGeneratedPlan)
 * - Telemetria automática de falhas
 * - Controle explícito de RAG e scraping (nunca decide automaticamente)
 * 
 * @param {string} description - Descrição do fluxo em linguagem natural
 * @param {Object} options - Opções adicionais (tenantId, flowId, flowName, useRag, ragSources, useWebScraping, scrapingTargets)
 * @returns {Promise<Object>} - Fluxo gerado no formato FlowDefinition
 */
async function generateFlowFromDescription(description, options = {}) {
  const tenantId = options.tenantId || 'demo-tenant';
  const flowId = options.flowId || `flow-${uuidv4().slice(0, 8)}`;
  const flowName = options.flowName || 'Fluxo Gerado';
  const signal = options.signal || null;
  const faqQuestions = options.includeQuestions ? normalizeQuestionsList(options.questions) : [];
  const maxFixAttemptsRaw = options.maxFixAttempts;
  const MAX_FIX_ATTEMPTS = Number.isFinite(Number(maxFixAttemptsRaw))
    ? Math.max(1, Math.min(10, Number(maxFixAttemptsRaw)))
    : 3;
  
  // Inicializa gravação
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'flow-generation'),
    tenantId,
    context: 'flow-generation',
    enableTimestamps: false,
  });

  const recordingId = `${tenantId}-flow-gen-${flowId}-${Date.now()}`;
  recording.start(recordingId, {
    name: `Geração de Fluxo - ${flowName}`,
    description: 'Geração de fluxo a partir de descrição',
    flowId,
    flowName,
    tenantId,
    source: 'automatic',
  });
  
  logger.info('Gerando fluxo a partir de descrição usando wrapper oficial', { 
    description: safeToString(description).slice(0, 100),
    flowId,
    flowName,
    tenantId,
    useRag: options.useRag || false,
    ragSources: options.ragSources || [],
    useWebScraping: options.useWebScraping || false,
    scrapingTargets: options.scrapingTargets || [],
  });

  const attempts = [];
  let lastFlow = null;
  let lastErrorsForFeedback = [];
  let lastWarningsForFeedback = [];
  let usedFallback = false;

  const formatFixFeedback = (errors, warnings) => {
    const safe = (v) => (v === null || v === undefined) ? '' : safeToString(v);
    const normalizeItems = (items, max = 20) => {
      const arr = Array.isArray(items) ? items : [];
      const out = [];
      for (const it of arr) {
        if (!it) continue;
        if (typeof it === 'string') {
          const s = safeTrim(it);
          if (s) out.push(s);
        } else if (typeof it === 'object') {
          const msg = it.message || it.code || it.type || safe(it);
          const rule = it.rule ? ` (${it.rule})` : '';
          const s = safeTrim(`${safe(msg)}${rule}`);
          if (s) out.push(s);
        }
        if (out.length >= max) break;
      }
      return out;
    };

    const errLines = normalizeItems(errors, 18);
    const warnLines = normalizeItems(warnings, 10);
    const blocks = [];
    if (errLines.length > 0) {
      blocks.push('Erros detectados (corrija TODOS):', ...errLines.map((l) => `- ${l}`));
    }
    if (warnLines.length > 0) {
      blocks.push('', 'Avisos (melhore se possível):', ...warnLines.map((l) => `- ${l}`));
    }
    return safeTrim(blocks.join('\n'));
  };

  const summarizeErrorsForMetadata = (items, max = 12) => {
    const safe = (v) => (v === null || v === undefined) ? '' : safeToString(v);
    const arr = Array.isArray(items) ? items : [];
    const out = [];
    for (const it of arr) {
      if (!it) continue;
      if (typeof it === 'string') {
        const s = safeTrim(it);
        if (s) out.push(s.slice(0, 240));
      } else if (typeof it === 'object') {
        const msg = it.message || it.code || it.type || safe(it);
        const rule = it.rule ? ` (${it.rule})` : '';
        const s = safeTrim(`${safe(msg)}${rule}`);
        if (s) out.push(s.slice(0, 240));
      }
      if (out.length >= max) break;
    }
    return out;
  };

  const summarizeFallbackReasonFromAttempts = (attemptsArr) => {
    const arr = Array.isArray(attemptsArr) ? attemptsArr : [];
    const last = arr.length > 0 ? arr[arr.length - 1] : null;
    const kind = last && typeof last === 'object' ? safeToString(last.kind || '') : '';
    const msg = last && typeof last === 'object' ? safeToString(last.message || '') : '';

    // Mapeamento enxuto para UX (sem expor detalhes internos).
    if (kind === 'WRAPPER_REJECTED') return 'A IA retornou uma resposta fora do contrato esperado.';
    if (kind === 'ENGINE_VALIDATION_FAILED') return 'O fluxo gerado pela IA falhou na validação estrutural.';
    if (kind === 'GENERATION_ERROR') return 'Falha ao chamar o provider de IA durante a geração.';
    if (kind === 'UNEXPECTED_ERROR') return msg ? `Erro inesperado durante a geração: ${msg}` : 'Erro inesperado durante a geração.';
    if (kind) return `Falha na geração (tipo: ${kind}).`;
    return msg ? `Falha na geração: ${msg}` : 'Falha na geração.';
  };

  const extractProviderErrorMessageFromAttempts = (attemptsArr) => {
    const arr = Array.isArray(attemptsArr) ? attemptsArr : [];
    // Preferimos a última tentativa com erro de geração (chamada ao provider)
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (safeToString(a.kind || '') !== 'GENERATION_ERROR') continue;
      const msg = safeTrim(a.message);
      if (msg) return { failureSource: 'provider', failureMessage: msg.slice(0, 360) };
    }

    // 2) Wrapper rejected — ex.: saída fora do contrato/gate.
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (safeToString(a.kind || '') !== 'WRAPPER_REJECTED') continue;
      const msg =
        (safeTrim(a.errorMessage))
          ? safeTrim(a.errorMessage)
          : safeTrim(a.message);
      if (msg) return { failureSource: 'wrapper', failureMessage: msg.slice(0, 360) };
      const errorType = safeTrim(a.errorType);
      if (errorType) return { failureSource: 'wrapper', failureMessage: `Wrapper rejeitou a geração (${errorType}).` };
      return { failureSource: 'wrapper', failureMessage: 'Wrapper rejeitou a geração.' };
    }

    // 3) Engine validation failed — usamos firstError quando existir.
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (safeToString(a.kind || '') !== 'ENGINE_VALIDATION_FAILED') continue;
      const msg = safeTrim(a.firstError);
      if (msg) return { failureSource: 'engine', failureMessage: msg.slice(0, 360) };
      return { failureSource: 'engine', failureMessage: 'Falha na validação do fluxo gerado.' };
    }

    return { failureSource: 'unknown', failureMessage: msg ? msg.slice(0, 360) : 'Falha na geração (motivo não identificado).' };
  };

  const extractFailureInfoFromAttempts = (attemptsArr) => {
    const arr = Array.isArray(attemptsArr) ? attemptsArr : [];

    // 1) Provider failure (exception) — preferimos a última GEN_ERROR.
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (safeToString(a.kind || '') !== 'GENERATION_ERROR') continue;
      const msg = safeTrim(a.message);
      if (msg) return { failureSource: 'provider', failureMessage: msg.slice(0, 360) };
    }

    // 2) Wrapper rejected — ex.: saída fora do contrato/gate.
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (safeToString(a.kind || '') !== 'WRAPPER_REJECTED') continue;
      const msg =
        (safeTrim(a.errorMessage))
          ? safeTrim(a.errorMessage)
          : safeTrim(a.message);
      if (msg) return { failureSource: 'wrapper', failureMessage: msg.slice(0, 360) };
      const errorType = safeTrim(a.errorType);
      if (errorType) return { failureSource: 'wrapper', failureMessage: `Wrapper rejeitou a geração (${errorType}).` };
      return { failureSource: 'wrapper', failureMessage: 'Wrapper rejeitou a geração.' };
    }

    // 3) Engine validation failed — usamos firstError quando existir.
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (!a || typeof a !== 'object') continue;
      if (safeToString(a.kind || '') !== 'ENGINE_VALIDATION_FAILED') continue;
      const msg = safeTrim(a.firstError);
      if (msg) return { failureSource: 'engine', failureMessage: msg.slice(0, 360) };
      return { failureSource: 'engine', failureMessage: 'Falha na validação do fluxo gerado.' };
    }

    // 4) Unknown/unexpected
    const last = arr.length > 0 ? arr[arr.length - 1] : null;
    const msg = (last && typeof last === 'object') ? safeTrim(last.message) : '';
    return {
      failureSource: 'unknown',
      failureMessage: msg ? msg.slice(0, 360) : 'Falha na geração (motivo não identificado).',
    };
  };

  try {
    // Resolve contexto de conhecimento (RAG e scraping) se solicitado
    const safeDescription = safeToString(description);
    let enhancedDescriptionBase = safeDescription;
    if (options.useRag || options.useWebScraping) {
      const knowledgeContext = await resolveKnowledgeContext(safeDescription, options);
      if (knowledgeContext) {
        enhancedDescriptionBase = `${safeDescription}\n\n${knowledgeContext}`;
        logger.debug('Descrição enriquecida com contexto', {
          originalLength: safeDescription.length,
          enhancedLength: enhancedDescriptionBase.length,
        });
      }
    }

    // Injeta bloco de perguntas (FAQ) se habilitado
    if (faqQuestions.length > 0) {
      enhancedDescriptionBase = safeTrim(`${enhancedDescriptionBase}\n\n${formatQuestionsBlock(faqQuestions)}`);
    }

    // Retentativas: quando o wrapper rejeita (gate/contrato) ou quando validateFlow falha,
    // tentamos corrigir pelo menos 3 vezes antes de cair no fallback.
    for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      if (signal && signal.aborted) {
        const err = new Error('Operação cancelada pelo cliente');
        err.name = 'AbortError';
        throw err;
      }
      const feedback = (attempt >= 2)
        ? formatFixFeedback(lastErrorsForFeedback, lastWarningsForFeedback)
        : '';
      const attemptDescription = (attempt >= 2 && feedback)
        ? [
            enhancedDescriptionBase,
            '',
            `## Correções obrigatórias (tentativa ${attempt} de ${MAX_FIX_ATTEMPTS})`,
            feedback,
            '',
            'Regras adicionais (obrigatórias):',
            '- Garanta 1 nó start e pelo menos 1 nó end.',
            '- Garanta pelo menos 1 nó fallback global.',
            '- Garanta que nenhum next aponte para id inexistente.',
            '- Garanta que todos os nós estejam conectados (sem órfãos).',
            '',
          ].join('\n')
        : enhancedDescriptionBase;

      const attemptOptions = {
        ...options,
        tenantId,
        flowId,
        flowName,
        _aiMeta: {
          ...(options?._aiMeta || {}),
          attempt,
          maxAttempts: MAX_FIX_ATTEMPTS,
        },
      };

      let wrapperResult;
      try {
        const coreRes = await generateChatbotViaCore(attemptDescription, attemptOptions, {
          endpoint: '/flows/generate',
          aiMeta: attemptOptions?._aiMeta || {},
          signal,
        });

        // Adapter: converte o retorno do core (FlowDefinition) para o shape esperado
        // pelo conversor legado `convertWrapperResultToFlowDefinition()`:
        // wrapper.flow: { nodes, metadata: { name } }
        wrapperResult = {
          success: coreRes?.success === true,
          flow: {
            nodes: Array.isArray(coreRes?.flowDefinition?.nodes) ? coreRes.flowDefinition.nodes : [],
            metadata: {
              name: coreRes?.flowDefinition?.name || flowName,
            },
          },
          validation: coreRes?.validation || null,
          envelope: coreRes?.envelope || null,
          promptVersion: coreRes?.promptVersion || 'core',
          error: coreRes?.success === true
            ? null
            : {
              type: coreRes?.error?.type || 'VALIDATION_FAILED',
              message: coreRes?.error?.message || 'Fluxo gerado não passou na validação',
              errors: coreRes?.validation?.errors || [],
            },
        };
      } catch (err) {
        // Erros do FlowPreValidator (FLOW_*): devem abortar imediatamente.
        // (sem retries, sem safe-mode, sem normalizer remendando)
        if (err && typeof err === 'object' && typeof err.code === 'string' && err.code.startsWith('FLOW_')) {
          throw err;
        }
        if (err && (err.name === 'AbortError' || err.name === 'TimeoutError' || (signal && signal.aborted))) {
          throw err;
        }
        const msg = safeErrorMessage(err);
        attempts.push({
          attempt,
          ok: false,
          kind: 'GENERATION_ERROR',
          message: msg,
          providerStatus: (err && typeof err === 'object' && Number.isFinite(Number(err.status))) ? Number(err.status) : null,
          providerCode: (err && typeof err === 'object' && typeof err.code === 'string') ? err.code : null,
        });
        lastErrorsForFeedback = [{ type: 'GENERATION_ERROR', message: msg }];
        lastWarningsForFeedback = [];
        continue;
      }

      const wrapperValidation = wrapperResult?.validation || null;

      // Mesmo quando o wrapper rejeita, ele pode incluir um candidato no envelope.output.
      // Guardamos o último candidato para safe-mode/revisão manual.
      if (wrapperResult && wrapperResult.envelope && wrapperResult.envelope.output) {
        try {
          const pseudoWrapper = {
            flow: wrapperResult.envelope.output,
            validation: wrapperValidation || { valid: false, errors: [], warnings: [] },
            promptVersion: wrapperResult.promptVersion || null,
          };
          const candidateFlow = convertWrapperResultToFlowDefinition(
            pseudoWrapper,
            flowId,
            tenantId,
            flowName,
            description
          );
          if (faqQuestions.length > 0) applyFaqQuestionsToFlow(candidateFlow, faqQuestions, options);
          lastFlow = candidateFlow;
        } catch {
          // best-effort
        }
      }

      if (!wrapperResult || wrapperResult.success !== true) {
        const errs = wrapperValidation?.errors || wrapperResult?.error?.errors || [];
        const warns = wrapperValidation?.warnings || [];
        attempts.push({
          attempt,
          ok: false,
          kind: 'WRAPPER_REJECTED',
          errorType: wrapperResult?.error?.type || null,
          errorMessage: wrapperResult?.error?.message || null,
          errorsCount: Array.isArray(errs) ? errs.length : 0,
        });
        lastErrorsForFeedback = Array.isArray(errs) ? errs : [];
        lastWarningsForFeedback = Array.isArray(warns) ? warns : [];
        continue;
      }

      // Converte o formato do wrapper para FlowDefinition
      const flow = convertWrapperResultToFlowDefinition(
        wrapperResult,
        flowId,
        tenantId,
        flowName,
        description
      );

      // Garante que as perguntas estejam refletidas no fluxo final
      if (faqQuestions.length > 0) {
        applyFaqQuestionsToFlow(flow, faqQuestions, options);
      }

      // Migração determinística: remove router.contains (deprecado) em fluxos gerados
      try {
        migrateDeprecatedRouterContains(flow);
      } catch (e) {
        // best-effort: nunca falhar geração por migrador (fluxo ainda pode ser validado/retentado)
        logger.debug?.('[flowGeneratorService] Migração contains->equals falhou (best-effort)', {
          error: safeErrorMessage(e),
        });
      }

      // Validação extra: se falhar, tenta corrigir novamente
      const engineValidation = validateFlow(flow);
      if (!engineValidation.valid) {
        attempts.push({
          attempt,
          ok: false,
          kind: 'ENGINE_VALIDATION_FAILED',
          errorsCount: Array.isArray(engineValidation.errors) ? engineValidation.errors.length : 0,
          firstError: engineValidation.errors?.[0]?.message || engineValidation.errors?.[0]?.code || null,
        });
        lastFlow = flow;
        lastErrorsForFeedback = Array.isArray(engineValidation.errors) ? engineValidation.errors : [];
        lastWarningsForFeedback = [];
        continue;
      }

      // Sucesso
      attempts.push({
        attempt,
        ok: true,
        kind: 'OK',
      });

      logger.info('Fluxo gerado pelo wrapper oficial com sucesso', {
        flowId,
        nodeCount: flow.nodes.length,
        validation: wrapperResult.validation,
        attempts: attempts.length,
      });

      recording.recordAction({
        type: 'flow-generated',
        step: 'flow-generated',
        value: {
          flowId,
          nodeCount: flow.nodes.length,
          attempts: attempts.length,
        },
      });
      recording.stop();
      recording.save(recordingId);

      // Metadata de observabilidade (safe-mode)
      flow.metadata = {
        ...(flow.metadata || {}),
        aiGeneration: {
          attempts,
          usedFallback: false,
          maxFixAttempts: MAX_FIX_ATTEMPTS,
          lastErrors: summarizeErrorsForMetadata(lastErrorsForFeedback),
        },
      };

      return flow;
    }
  } catch (err) {
    // Cancelamento deve interromper o pipeline (sem fallback)
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError' || (signal && signal.aborted))) {
      throw err;
    }
    // Erros do FlowPreValidator: abortar imediatamente (não retornar lastFlow / fallback).
    if (err && typeof err === 'object' && typeof err.code === 'string' && err.code.startsWith('FLOW_')) {
      throw err;
    }
    logger.error('Erro ao gerar fluxo com wrapper oficial (com retries)', {
      error: safeErrorMessage(err),
      stack: err?.stack,
    });

    attempts.push({
      attempt: attempts.length + 1,
      ok: false,
      kind: 'UNEXPECTED_ERROR',
      message: safeErrorMessage(err),
    });

    recording.recordCustom('error', {
      step: 'generation-error',
      value: { error: safeErrorMessage(err) },
    });
    recording.stop();
    recording.save(`${recordingId}-error`);
  }

  // Após esgotar tentativas:
  // - Se temos um último candidato, retornamos em safe-mode com warnings/metadata.
  // - Caso contrário, caímos no fallback por palavras-chave.
  if (signal && signal.aborted) {
    const err = new Error('Operação cancelada pelo cliente');
    err.name = 'AbortError';
    throw err;
  }
  if (lastFlow) {
    lastFlow.metadata = {
      ...(lastFlow.metadata || {}),
      aiGeneration: {
        attempts,
        usedFallback: false,
        maxFixAttempts: MAX_FIX_ATTEMPTS,
        lastErrors: summarizeErrorsForMetadata(lastErrorsForFeedback),
      },
    };
    return lastFlow;
  }

  usedFallback = true;
  const fallbackFlow = generateFlowFromKeywords(description, options);
  const fallbackReason = summarizeFallbackReasonFromAttempts(attempts);
  const providerErrorMessage = extractProviderErrorMessageFromAttempts(attempts);
  const failureInfo = extractFailureInfoFromAttempts(attempts);
  fallbackFlow.metadata = {
    ...(fallbackFlow.metadata || {}),
    aiGeneration: {
      attempts,
      usedFallback,
      maxFixAttempts: MAX_FIX_ATTEMPTS,
      lastErrors: summarizeErrorsForMetadata(lastErrorsForFeedback),
      fallbackMode: 'keywords',
      fallbackReason,
      providerErrorMessage,
      ...(failureInfo || {}),
      // Mensagem curta e acionável para o usuário final (frontend pode exibir como toast/banner).
      fallbackUserMessage:
        'A geração por IA não conseguiu produzir um fluxo válido; foi criado um fluxo simplificado (fallback). ' +
        'Revise o rascunho antes de salvar.',
    },
  };
  return fallbackFlow;
}

/**
 * Gera um fluxo usando análise de palavras-chave (fallback quando IA não disponível).
 * 
 * @param {string} description - Descrição do fluxo
 * @param {Object} options - Opções adicionais
 * @returns {Object} - Fluxo gerado
 */
function generateFlowFromKeywords(description, options = {}) {
  const tenantId = options.tenantId || 'demo-tenant';
  const flowId = options.flowId || `flow-${uuidv4().slice(0, 8)}`;
  const flowName = options.flowName || 'Fluxo Gerado';
  
  logger.info('Gerando fluxo usando análise de palavras-chave (fallback)', { 
    description: safeToString(description).slice(0, 100),
    flowId,
    flowName 
  });

  // Normaliza a descrição
  const normalizedDescription = safeTrimLower(description);
  
  // Gera o fluxo baseado na descrição
  const flow = {
    id: flowId,
    tenantId,
    name: flowName,
    version: 1,
    nodes: [],
    metadata: {
      generated: true,
      description: safeToString(description),
      generatedAt: new Date().toISOString(),
    },
  };

  // Análise básica da descrição para identificar intenções
  const hasHandoff = normalizedDescription.includes('humano') || 
                     normalizedDescription.includes('atendente') ||
                     normalizedDescription.includes('agente') ||
                     normalizedDescription.includes('handoff');
  
  const hasIntent = normalizedDescription.includes('intenção') ||
                    normalizedDescription.includes('reconhecer') ||
                    normalizedDescription.includes('classificar');
  
  const hasRouter = normalizedDescription.includes('rota') ||
                    normalizedDescription.includes('decidir') ||
                    normalizedDescription.includes('condição') ||
                    normalizedDescription.includes('se');
  
  const hasMessage = normalizedDescription.includes('mensagem') ||
                     normalizedDescription.includes('dizer') ||
                     normalizedDescription.includes('responder');

  // Gera nós básicos
  const startNodeId = 'start';
  const endNodeId = 'end';
  
  // Nó inicial
  flow.nodes.push({
    id: startNodeId,
    type: 'start',
    next: null, // Será definido depois
  });

  let currentNodeId = startNodeId;
  let previousNodeId = null;

  // Adiciona mensagem inicial se necessário
  if (hasMessage || !hasIntent) {
    const messageNodeId = 'msg-inicial';
    flow.nodes.push({
      id: messageNodeId,
      type: 'message',
      config: {
        text: 'Olá! Como posso ajudá-lo hoje?',
      },
      next: null,
    });
    
    // Conecta start -> message
    const startNode = flow.nodes.find(n => n.id === startNodeId);
    startNode.next = messageNodeId;
    previousNodeId = messageNodeId;
    currentNodeId = messageNodeId;
  }

  // Adiciona nó de intenção se necessário
  if (hasIntent) {
    const intentNodeId = 'intent-1';
    flow.nodes.push({
      id: intentNodeId,
      type: 'ai_task',
      config: {
        task: 'intent_classification',
        allowedOutputs: ['suporte', 'vendas', 'financeiro', 'outro'],
        fallback: 'outro',
        confidenceThreshold: 0.75,
      },
      next: null,
    });
    
    if (previousNodeId) {
      const prevNode = flow.nodes.find(n => n.id === previousNodeId);
      prevNode.next = intentNodeId;
    } else {
      const startNode = flow.nodes.find(n => n.id === startNodeId);
      startNode.next = intentNodeId;
    }
    previousNodeId = intentNodeId;
    currentNodeId = intentNodeId;
  }

  // Adiciona roteador se necessário
  if (hasRouter || hasIntent) {
    const routerNodeId = 'router-1';
    const rules = [];
    
    if (hasIntent) {
      // Regras baseadas nas intenções
      rules.push({
        condition: {
          op: 'equals',
          var: 'intent',
          value: 'suporte',
        },
        next: 'msg-suporte',
      });
      rules.push({
        condition: {
          op: 'equals',
          var: 'intent',
          value: 'vendas',
        },
        next: 'msg-vendas',
      });
      rules.push({
        condition: {
          op: 'always',
        },
        next: 'msg-default',
      });
    } else {
      // Router simples com fallback
      rules.push({
        condition: {
          op: 'always',
        },
        next: 'msg-default',
      });
    }

    flow.nodes.push({
      id: routerNodeId,
      type: 'router',
      config: {
        rules,
      },
      next: null,
    });

    if (previousNodeId) {
      const prevNode = flow.nodes.find(n => n.id === previousNodeId);
      prevNode.next = routerNodeId;
    } else {
      const startNode = flow.nodes.find(n => n.id === startNodeId);
      startNode.next = routerNodeId;
    }
    previousNodeId = routerNodeId;
    currentNodeId = routerNodeId;

    // Adiciona mensagens de resposta
    if (hasIntent) {
      flow.nodes.push({
        id: 'msg-suporte',
        type: 'message',
        config: {
          text: 'Entendi que você precisa de suporte. Como posso ajudar?',
        },
        next: endNodeId,
      });
      
      flow.nodes.push({
        id: 'msg-vendas',
        type: 'message',
        config: {
          text: 'Ótimo! Vou te ajudar com vendas. O que você gostaria de saber?',
        },
        next: endNodeId,
      });
    }
    
    flow.nodes.push({
      id: 'msg-default',
      type: 'message',
      config: {
        text: 'Entendi. Como posso ajudá-lo?',
      },
      next: endNodeId,
    });
  } else {
    // Sem router: conecta diretamente ao end ou handoff
    if (hasHandoff) {
      const handoffNodeId = 'handoff-1';
      flow.nodes.push({
        id: handoffNodeId,
        type: 'handoff',
        config: {
          queue: 'atendimento',
        },
        next: endNodeId,
      });
      
      if (previousNodeId) {
        const prevNode = flow.nodes.find(n => n.id === previousNodeId);
        prevNode.next = handoffNodeId;
      } else {
        const startNode = flow.nodes.find(n => n.id === startNodeId);
        startNode.next = handoffNodeId;
      }
    } else {
      // Conecta diretamente ao end
      if (previousNodeId) {
        const prevNode = flow.nodes.find(n => n.id === previousNodeId);
        prevNode.next = endNodeId;
      } else {
        const startNode = flow.nodes.find(n => n.id === startNodeId);
        startNode.next = endNodeId;
      }
    }
  }

  // Adiciona nó de fallback SEMPRE (gate semântico exige fallback global)
  // Mantém configurações conservadoras; em modo handoff, escalona para humano.
  const fallbackNodeId = 'fallback-1';
  flow.nodes.push({
    id: fallbackNodeId,
    type: 'fallback',
    config: {
      maxAttempts: 3,
      confidenceThreshold: 0.75,
      escalationMode: hasHandoff ? 'human' : 'ticket',
      queue: hasHandoff ? 'atendimento' : undefined,
    },
    // fallback.next deve ser mapa (retry/options/human/end). Aqui garantimos pelo menos end.
    next: { end: endNodeId },
  });

  // ------------------------------------------------------------
  // HARDENING: fallback global NÃO pode ser órfão
  // ------------------------------------------------------------
  // Regra: garantimos 1 entrada no fallback conectando o caminho "default"
  // (msg-default ou último nó) para o fallback, e fallback -> end.
  try {
    const msgDefault = flow.nodes.find((n) => n && n.id === 'msg-default') || null;
    if (msgDefault && typeof msgDefault === 'object') {
      msgDefault.next = fallbackNodeId;
    } else {
      // Se não existe msg-default (fluxo sem router), usa o último nó de entrada existente.
      const prev = previousNodeId
        ? flow.nodes.find((n) => n && n.id === previousNodeId) || null
        : flow.nodes.find((n) => n && n.id === startNodeId) || null;
      if (prev && typeof prev === 'object') {
        prev.next = fallbackNodeId;
      }
    }
  } catch (_) {
    // best-effort: se algo falhar aqui, o validator ainda reportará NODE_DISCONNECTED
  }

  // Adiciona nó final
  flow.nodes.push({
    id: endNodeId,
    type: 'end',
  });

  // Garante que todos os caminhos terminem em end
  const nodeIdsSet = new Set((flow.nodes || []).map((n) => safeToString(n?.id || '')));
  flow.nodes.forEach(node => {
    if (!node || !node.next) return;

    if (typeof node.next === 'string') {
      if (!nodeIdsSet.has(safeToString(node.next))) {
        node.next = endNodeId;
      }
      return;
    }

    if (Array.isArray(node.next)) {
      node.next = node.next.map((nextId) => (nodeIdsSet.has(safeToString(nextId)) ? nextId : endNodeId));
      return;
    }

    if (typeof node.next === 'object') {
      const updated = {};
      for (const [key, rawValue] of Object.entries(node.next)) {
        if (rawValue == null) {
          updated[key] = rawValue;
          continue;
        }
        if (typeof rawValue === 'string') {
          updated[key] = nodeIdsSet.has(safeToString(rawValue)) ? rawValue : endNodeId;
          continue;
        }
        if (Array.isArray(rawValue)) {
          updated[key] = rawValue.map((nextId) => (nodeIdsSet.has(safeToString(nextId)) ? nextId : endNodeId));
          continue;
        }
        updated[key] = endNodeId;
      }
      node.next = updated;
    }
  });

  // Best-effort: se algum nó ficar sem `next` (e não for start/end/fallback),
  // encaminha para o fallback, garantindo caminho global de erro.
  flow.nodes.forEach(node => {
    if (!node) return;
    if (node.type === 'start' || node.type === 'end' || node.type === 'fallback') return;
    if (node.next === null || node.next === undefined || node.next === '') {
      node.next = fallbackNodeId;
    }
  });

  logger.info('Fluxo gerado com sucesso', { 
    flowId,
    nodeCount: flow.nodes.length 
  });

  return flow;
}

module.exports = {
  generateFlowFromDescription,
  generateFlowFromKeywords, // Exportado para testes
};

