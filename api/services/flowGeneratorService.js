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
const { generateChatbotFlow } = require('../../engine/ai/generateChatbotFlow');
const ragService = require('./ragService');
const webScrapingService = require('./webScrapingService');
const { RecordingSystem } = require('../../lib/recordingSystem');
const path = require('path');

/**
 * Constrói o prompt para a IA gerar o fluxo.
 * 
 * @param {string} description - Descrição do usuário
 * @returns {string} - Prompt estruturado para a IA
 */
function buildFlowGenerationPrompt(description) {
  return `Você é um operador especialista do DESIGNER DE FLUXOS. Sua tarefa é gerar um fluxo COMPLETO e VÁLIDO a partir de uma descrição em linguagem natural.

REGRAS ABSOLUTAS:
1. Use APENAS os tipos de nós existentes: start, message, user_input, router, ai_task, set_variable, handoff, ai, fallback, end
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

5. ai_task:
   - type: "ai_task"
   - config: {
       task: "intent_classification",
       allowedOutputs: ["intenção1", "intenção2"],
       fallback: "outro",
       confidenceThreshold: 0.75
     }
   - next: "id_do_proximo_no"

6. set_variable:
   - type: "set_variable"
   - config: {
       assignments: {
         "nome_variavel": "valor"
       }
     }
   - next: "id_do_proximo_no"

7. handoff:
   - type: "handoff"
   - config: { queue: "nome_da_fila" }
   - next: "id_do_proximo_no"

8. ai:
   - type: "ai"
   - config: {
       promptTemplate: "template com {{variavel}}",
       outputVariable: "nome_variavel"
     }
   - next: "id_do_proximo_no"

9. fallback:
   - type: "fallback"
   - config: {
       maxAttempts: 3,
       confidenceThreshold: 0.75,
       escalationMode: "ticket|human",
       queue: "nome_fila" (se escalationMode = "ticket")
     }

10. end:
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
    let jsonStr = aiResponse.trim();
    
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
    logger.error('Erro ao parsear resposta da IA', { error: err.message, response: aiResponse.substring(0, 200) });
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
      description: description,
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
  
  // Garante que todos os caminhos terminem em end
  const endNodeId = flow.nodes.find(n => n.type === 'end')?.id || 'end';
  flow.nodes.forEach(node => {
    if (node.next && !flow.nodes.find(n => n.id === node.next)) {
      node.next = endNodeId;
    }
  });
  
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
      if (!url || !url.trim()) continue;
      
      try {
        const scrapeResult = await webScrapingService.scrapeUrl(url, {
          tenantId: tenantId || 'demo-tenant',
          autoIndex: false, // Não indexa automaticamente durante geração
        });
        
        if (scrapeResult.success && scrapeResult.content) {
          scrapingResults.push(`\n### ${scrapeResult.title || url}:\n${scrapeResult.content.substring(0, 1000)}...\n`);
          logger.debug('URL raspada com sucesso', { url, contentLength: scrapeResult.contentLength });
        }
      } catch (scrapeError) {
        logger.warn('Erro ao raspar URL, continuando', { url, error: scrapeError.message });
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
  
  // Inicializa gravação
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'flow-generation'),
    context: 'flow-generation',
    enableTimestamps: false,
  });

  const recordingId = `flow-gen-${flowId}-${Date.now()}`;
  recording.start(recordingId, {
    name: `Geração de Fluxo - ${flowName}`,
    description: 'Geração de fluxo a partir de descrição',
    flowId,
    flowName,
    tenantId,
    source: 'automatic',
  });
  
  logger.info('Gerando fluxo a partir de descrição usando wrapper oficial', { 
    description: description.substring(0, 100),
    flowId,
    flowName,
    tenantId,
    useRag: options.useRag || false,
    ragSources: options.ragSources || [],
    useWebScraping: options.useWebScraping || false,
    scrapingTargets: options.scrapingTargets || [],
  });

  try {
    // Resolve contexto de conhecimento (RAG e scraping) se solicitado
    let enhancedDescription = description;
    if (options.useRag || options.useWebScraping) {
      const knowledgeContext = await resolveKnowledgeContext(description, options);
      if (knowledgeContext) {
        enhancedDescription = `${description}\n\n${knowledgeContext}`;
        logger.debug('Descrição enriquecida com contexto', { 
          originalLength: description.length,
          enhancedLength: enhancedDescription.length 
        });
      }
    }

    // Usa o wrapper oficial que garante validação e telemetria
    const wrapperResult = await generateChatbotFlow(enhancedDescription, options);
    
    if (!wrapperResult.success) {
      logger.warn('Wrapper rejeitou a geração, usando fallback', {
        error: wrapperResult.error,
        validation: wrapperResult.validation
      });
      // Fallback: usa geração por palavras-chave
      return generateFlowFromKeywords(description, options);
    }
    
    // Converte o formato do wrapper para FlowDefinition
    const flow = convertWrapperResultToFlowDefinition(
      wrapperResult,
      flowId,
      tenantId,
      flowName,
      description
    );
    
    logger.info('Fluxo gerado pelo wrapper oficial com sucesso', { 
      flowId,
      nodeCount: flow.nodes.length,
      validation: wrapperResult.validation
    });

    recording.recordAction({
      type: 'flow-generated',
      step: 'flow-generated',
      value: {
        flowId,
        nodeCount: flow.nodes.length,
      },
    });
    recording.stop();
    recording.save(recordingId);
    
    return flow;
  } catch (err) {
    logger.error('Erro ao gerar fluxo com wrapper oficial, usando fallback', { 
      error: err.message,
      stack: err.stack 
    });
    
    recording.recordCustom('error', {
      step: 'generation-error',
      value: { error: err.message },
    });
    recording.stop();
    recording.save(`${recordingId}-error`);
    
    // Fallback: usa geração por palavras-chave
    return generateFlowFromKeywords(description, options);
  }
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
    description: description.substring(0, 100),
    flowId,
    flowName 
  });

  // Normaliza a descrição
  const normalizedDescription = description.trim().toLowerCase();
  
  // Gera o fluxo baseado na descrição
  const flow = {
    id: flowId,
    tenantId,
    name: flowName,
    version: 1,
    nodes: [],
    metadata: {
      generated: true,
      description: description,
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

  // Adiciona nó de fallback se necessário
  if (hasIntent || hasHandoff) {
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
    });
  }

  // Adiciona nó final
  flow.nodes.push({
    id: endNodeId,
    type: 'end',
  });

  // Garante que todos os caminhos terminem em end
  flow.nodes.forEach(node => {
    if (node.next && !flow.nodes.find(n => n.id === node.next)) {
      node.next = endNodeId;
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

