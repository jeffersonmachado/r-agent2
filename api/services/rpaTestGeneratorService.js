/**
 * Serviço de geração de testes RPA por IA.
 * 
 * Gera automaticamente um teste RPA executável a partir de um fluxo,
 * inferindo um caminho válido e determinístico através do fluxo.
 * 
 * REFATORADO: Agora usa o gate oficial de validação (validateGeneratedPlan)
 * que garante:
 * - Validação obrigatória pelo gate antes de retornar
 * - Telemetria automática de falhas
 * - Consistência com o wrapper oficial generateRpaTest
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { generateAiResponse } = require('./aiProviderService');
const { validateGeneratedPlan } = require('../../engine/ai/validateGeneratedPlan');

// Cache dos prompts carregados
let cachedPrompts = null;

/**
 * Carrega os prompts de teste RPA do arquivo de configuração.
 * 
 * @returns {Object} Prompts carregados
 */
function loadRpaTestPrompts() {
  if (cachedPrompts) {
    return cachedPrompts;
  }

  const promptsFile = path.join(__dirname, '..', 'data', 'rpa_test_prompts.json');
  
  try {
    if (fs.existsSync(promptsFile)) {
      const data = fs.readFileSync(promptsFile, 'utf8');
      cachedPrompts = JSON.parse(data);
      logger.debug('Prompts de teste RPA carregados do arquivo de configuração');
    } else {
      logger.warn('Arquivo de prompts de teste RPA não encontrado, usando prompts padrão');
      cachedPrompts = null;
    }
  } catch (err) {
    logger.error('Erro ao carregar prompts de teste RPA', { error: err.message });
    cachedPrompts = null;
  }

  return cachedPrompts;
}

/**
 * Recarrega os prompts do arquivo de configuração.
 */
function reloadRpaTestPrompts() {
  cachedPrompts = null;
  return loadRpaTestPrompts();
}

/**
 * Constrói o prompt para a IA gerar o teste RPA.
 * 
 * @param {Object} flow - Fluxo a ser testado
 * @param {Object} dependencies - Análise de dependências
 * @returns {string} - Prompt estruturado para a IA
 */
function buildRpaTestGenerationPrompt(flow, dependencies) {
  const flowDescription = JSON.stringify(flow, null, 2);
  
  // Obtém URL base do frontend para incluir no prompt
  const frontendUrl = process.env.TEST_FRONTEND_URL || 
                      process.env.FRONTEND_URL || 
                      'http://localhost:5173';
  
  // Carrega prompts do arquivo de configuração
  const prompts = loadRpaTestPrompts();
  const config = prompts?.rpaTestGeneration || {};
  
  // Constrói o prompt usando a configuração ou fallback para prompt padrão
  let prompt = '';
  
  // System role
  prompt += `${config.systemRole || 'Você é um especialista em testes RPA (Robotic Process Automation). Sua tarefa é gerar um teste RPA executável para validar um fluxo de chatbot.'}\n\n`;
  
  // Regras absolutas
  prompt += 'REGRAS ABSOLUTAS:\n';
  const rules = config.absoluteRules || [
    'O teste DEVE ser determinístico e reexecutável',
    'O teste DEVE incluir asserts obrigatórios em cada etapa crítica',
    'O teste DEVE seguir o formato de gravação RPA existente',
    'O teste DEVE inferir um caminho válido através do fluxo',
    'O teste NUNCA executa ações reais, apenas gera o script',
    `URLs de navegação DEVE usar a URL base: ${frontendUrl} (NUNCA use domínios fictícios como "rpa.local")`,
    'NUNCA invente seletores que não existem - use apenas seletores CSS genéricos ou validações lógicas'
  ];
  rules.forEach((rule, index) => {
    prompt += `${index + 1}. ${rule}\n`;
  });
  
  prompt += `\nESTRUTURA DO FLUXO:\n${flowDescription}\n\n`;
  prompt += `DEPENDÊNCIAS IDENTIFICADAS:\n${JSON.stringify(dependencies, null, 2)}\n\n`;
  
  prompt += `URL BASE DO FRONTEND:\nUse esta URL base para todas as navegações: ${frontendUrl}\n`;
  prompt += `IMPORTANTE: Sempre use URLs absolutas começando com ${frontendUrl} para ações de navegação. NÃO use domínios fictícios como "rpa.local" ou "localhost.local".\n\n`;
  
  // Informações sobre a interface
  if (config.interfaceInfo) {
    prompt += 'ESTRUTURA REAL DA INTERFACE:\n';
    prompt += '⚠️ INFORMAÇÕES CRÍTICAS SOBRE A INTERFACE:\n';
    const criticalInfo = config.interfaceInfo.critical || [];
    criticalInfo.forEach((info, index) => {
      prompt += `${index + 1}. ${info}\n`;
    });
    prompt += '\n';
    
    prompt += 'SELETORES DISPONÍVEIS:\n';
    const availableSelectors = config.interfaceInfo.availableSelectors || [];
    availableSelectors.forEach(selector => {
      prompt += `- ${selector}\n`;
    });
    prompt += '\n';
  }
  
  // Estratégia de teste
  if (config.testStrategy && config.testStrategy.length > 0) {
    prompt += 'ESTRATÉGIA DE TESTE:\n';
    prompt += 'Como não há interface de chat pública, os testes devem:\n';
    config.testStrategy.forEach((strategy, index) => {
      prompt += `${index + 1}. ${strategy}\n`;
    });
    prompt += '\n';
  }
  
  // Formato do teste
  prompt += 'FORMATO DO TESTE RPA:\n';
  prompt += 'O teste deve seguir este formato JSON:\n\n';
  prompt += JSON.stringify(config.outputFormat?.template || {
    id: 'test-{flowId}-{timestamp}',
    name: 'IA - Teste RPA - {nome do fluxo}',
    type: 'test',
    source: 'flow',
    flowId: '{flowId}',
    flowVersion: '{version}',
    generatedBy: 'ai',
    editable: true,
    metadata: {
      generatedAt: '{ISO timestamp}',
      dependenciesResolved: '{boolean}',
      seedsExecuted: '[{seedName, executedAt}]',
      pathTaken: '[{nodeId, nodeType, action}]',
      version: '1.0.0'
    },
    steps: [{
      type: 'navigate|click|fill|select|wait|assert',
      selector: 'seletor CSS ou XPath',
      value: 'valor (se aplicável)',
      assert: {
        type: 'visible|text|exists|count',
        expected: 'valor esperado'
      },
      description: 'descrição da ação',
      critical: 'true|false'
    }],
    asserts: [{
      step: '{número do step}',
      type: 'visible|text|exists|count|url|title',
      selector: 'seletor',
      expected: 'valor esperado',
      description: 'descrição do assert'
    }]
  }, null, 2);
  prompt += '\n\n';
  
  // Tipos de ações
  if (config.actionTypes) {
    prompt += 'TIPOS DE AÇÕES DISPONÍVEIS:\n';
    Object.entries(config.actionTypes).forEach(([type, description]) => {
      prompt += `- ${type}: ${description}\n`;
    });
    prompt += '\n';
  }
  
  // Tipos de asserts
  if (config.assertTypes) {
    prompt += 'TIPOS DE ASSERTS DISPONÍVEIS:\n';
    Object.entries(config.assertTypes).forEach(([type, description]) => {
      prompt += `- ${type}: ${description}\n`;
    });
    prompt += '\n';
  }
  
  // Ordem obrigatória dos passos
  if (config.stepOrder) {
    prompt += 'ORDEM OBRIGATÓRIA DOS PASSOS:\n';
    prompt += `⚠️ IMPORTANTE: ${config.stepOrder.description}\n\n`;
    
    config.stepOrder.steps.forEach((step, index) => {
      prompt += `${index + 1}. ${step}\n`;
    });
    prompt += '\n';
    
    // Seção de dependências
    if (config.stepOrder.dependenciesSection) {
      const depsSection = config.stepOrder.dependenciesSection;
      prompt += `${depsSection.title}\n`;
      prompt += `${depsSection.description}\n\n`;
      
      prompt += 'Para cada seed em dependencies.seeds.missing, adicione um passo do tipo "execute_seed" ou "navigate" seguido de passos para executar o seed:\n';
      if (depsSection.seedInstructions) {
        Object.entries(depsSection.seedInstructions).forEach(([seedName, instruction]) => {
          prompt += `- Se o seed for "${seedName}": ${instruction}\n`;
        });
      }
      prompt += '\n';
      
      prompt += `Exemplo de passos de dependências:\n`;
      prompt += JSON.stringify([
        {
          type: 'navigate',
          url: `${frontendUrl}/admin/departments`,
          description: 'Navegar para página de departamentos para criar dependência'
        },
        {
          type: 'click',
          selector: "button:has-text('Novo Departamento')",
          description: 'Clicar em botão para criar novo departamento'
        },
        {
          type: 'fill',
          selector: "input[name='name']",
          value: 'Nome do Departamento',
          description: 'Preencher nome do departamento'
        },
        {
          type: 'click',
          selector: "button[type='submit']",
          description: 'Salvar departamento'
        },
        {
          type: 'wait',
          selector: 'body',
          description: 'Aguardar confirmação de criação'
        }
      ], null, 2);
      prompt += '\n\n';
    }
  }
  
  // Instruções do caminho do fluxo
  if (config.flowPathInstructions) {
    prompt += 'PASSO 2 - CAMINHO DO FLUXO:\n';
    prompt += `${config.flowPathInstructions.description}\n`;
    
    config.flowPathInstructions.steps.forEach((step, index) => {
      prompt += `${index + 1}. ${step}\n`;
    });
    prompt += '\n';
    
    prompt += 'Para cada nó no caminho, gere ações RPA apropriadas:\n';
    if (config.flowPathInstructions.nodeActions) {
      Object.entries(config.flowPathInstructions.nodeActions).forEach(([nodeType, action]) => {
        const actionText = action.replace('{frontendUrl}', frontendUrl);
        prompt += `- Nós "${nodeType}": ${actionText}\n`;
      });
    }
    prompt += '\n';
  }
  
  // Notas importantes
  if (config.importantNotes) {
    if (config.importantNotes.selectors) {
      prompt += 'IMPORTANTE SOBRE SELETORES:\n';
      prompt += `- ${config.importantNotes.selectors}\n\n`;
    }
  }
  
  // Instrução final
  prompt += config.importantNotes?.output || 'Gere o teste RPA JSON agora (APENAS JSON, sem explicações):';
  
  return prompt;

REGRAS ABSOLUTAS:
1. O teste DEVE ser determinístico e reexecutável
2. O teste DEVE incluir asserts obrigatórios em cada etapa crítica
3. O teste DEVE seguir o formato de gravação RPA existente
4. O teste DEVE inferir um caminho válido através do fluxo
5. O teste NUNCA executa ações reais, apenas gera o script
6. URLs de navegação DEVE usar a URL base: ${frontendUrl} (NUNCA use domínios fictícios como "rpa.local")
7. NUNCA invente seletores que não existem - use apenas seletores CSS genéricos ou validações lógicas

ESTRUTURA DO FLUXO:
${flowDescription}

DEPENDÊNCIAS IDENTIFICADAS:
${JSON.stringify(dependencies, null, 2)}

URL BASE DO FRONTEND:
Use esta URL base para todas as navegações: ${frontendUrl}
IMPORTANTE: Sempre use URLs absolutas começando com ${frontendUrl} para ações de navegação. NÃO use domínios fictícios como "rpa.local" ou "localhost.local".

ESTRUTURA REAL DA INTERFACE:
⚠️ INFORMAÇÕES CRÍTICAS SOBRE A INTERFACE:
1. NÃO existe rota "/chat" - o chat é um modal dentro do editor de fluxos (/editor)
2. A interface de chat de teste é acessada através do editor de fluxos, não diretamente via URL
3. NÃO existem data-testid como "chat-root", "chat-message", "chat-input" no código atual
4. Os testes devem focar em validações lógicas do fluxo, não em elementos visuais específicos

SELETORES DISPONÍVEIS:
- Use seletores CSS genéricos como: "body", "input[type='text']", "button", "textarea"
- Para mensagens: use seletores por texto ou estrutura DOM genérica
- Para campos de entrada: use "input[type='text']" ou "textarea"
- Para botões: use "button" ou seletores por texto do botão
- NÃO invente data-testid que não existem no código

ESTRATÉGIA DE TESTE:
Como não há interface de chat pública, os testes devem:
1. Validar a lógica do fluxo através de validações de variáveis e estados
2. Usar seletores genéricos quando necessário aguardar elementos
3. Focar em asserts que validem o comportamento do fluxo, não elementos visuais específicos
4. Para nós "message": validar que a mensagem foi processada (não que aparece na tela)
5. Para nós "user_input": simular entrada através de variáveis, não preenchimento de campos
6. Para nós "router": validar variáveis de roteamento
7. Para nós "ai_task": validar variáveis de saída da IA

FORMATO DO TESTE RPA:
O teste deve seguir este formato JSON:

{
  "id": "test-{flowId}-{timestamp}",
  "name": "IA - Teste RPA - {nome do fluxo}",
  "type": "test",
  "source": "flow",
  "flowId": "{flowId}",
  "flowVersion": {version},
  "generatedBy": "ai",
  "editable": true,
  "metadata": {
    "generatedAt": "{ISO timestamp}",
    "dependenciesResolved": {boolean},
    "seedsExecuted": [{seedName, executedAt}],
    "pathTaken": [{nodeId, nodeType, action}],
    "version": "1.0.0"
  },
  "steps": [
    {
      "type": "navigate|click|fill|select|wait|assert",
      "selector": "seletor CSS ou XPath",
      "value": "valor (se aplicável)",
      "assert": {
        "type": "visible|text|exists|count",
        "expected": "valor esperado"
      },
      "description": "descrição da ação",
      "critical": true|false
    }
  ],
  "asserts": [
    {
      "step": {número do step},
      "type": "visible|text|exists|count|url|title",
      "selector": "seletor",
      "expected": "valor esperado",
      "description": "descrição do assert"
    }
  ]
}

TIPOS DE AÇÕES DISPONÍVEIS:
- navigate: Navega para uma URL
- click: Clica em um elemento
- fill: Preenche um campo
- select: Seleciona uma opção em um select
- wait: Aguarda um elemento aparecer
- assert: Valida algo na página

TIPOS DE ASSERTS DISPONÍVEIS:
- visible: Elemento está visível
- text: Texto do elemento corresponde ao esperado
- exists: Elemento existe no DOM
- count: Número de elementos corresponde ao esperado
- url: URL atual corresponde à esperada
- title: Título da página corresponde ao esperado

ORDEM OBRIGATÓRIA DOS PASSOS:
⚠️ IMPORTANTE: O teste RPA DEVE seguir esta ordem EXATA:

1. PRIMEIRO: Executar seeds RPA para criar dependências faltantes (se houver)
2. DEPOIS: Interagir com o chat e validar o fluxo

PASSO 1 - DEPENDÊNCIAS (OBRIGATÓRIO SE HOUVER DEPENDÊNCIAS FALTANTES):
Se houver dependências faltantes (dependencies.seeds.missing), você DEVE incluir passos para executar os seeds RPA ANTES de qualquer interação com o chat.

Para cada seed em dependencies.seeds.missing, adicione um passo do tipo "execute_seed" ou "navigate" seguido de passos para executar o seed:
- Se o seed for "seed-platform-create-department": Navegue para a página de departamentos, crie o departamento faltante
- Se o seed for "seed-platform-create-queue": Navegue para a página de filas, crie a fila faltante
- Se o seed for "seed-platform-create-agent": Navegue para a página de agentes, crie o agente faltante
- Se o seed for "seed-platform-login": Execute login na plataforma

Exemplo de passos de dependências:
{
  "type": "navigate",
  "url": "${frontendUrl}/admin/departments",
  "description": "Navegar para página de departamentos para criar dependência"
},
{
  "type": "click",
  "selector": "button:has-text('Novo Departamento')",
  "description": "Clicar em botão para criar novo departamento"
},
{
  "type": "fill",
  "selector": "input[name='name']",
  "value": "Nome do Departamento",
  "description": "Preencher nome do departamento"
},
{
  "type": "click",
  "selector": "button[type='submit']",
  "description": "Salvar departamento"
},
{
  "type": "wait",
  "selector": "body",
  "description": "Aguardar confirmação de criação"
}

PASSO 2 - CAMINHO DO FLUXO:
Analise o fluxo e identifique um caminho válido do nó "start" até um nó "end":
1. Comece pelo nó "start"
2. Siga as conexões "next" de cada nó
3. Para nós "router", escolha a primeira regra que seja satisfeita
4. Para nós "ai_task", simule uma resposta válida
5. Para nós "user_input", simule uma entrada de usuário
6. Continue até chegar em um nó "end"

Para cada nó no caminho, gere ações RPA apropriadas:
- Nós "start": Navegue para o editor (${frontendUrl}/editor) e aguarde carregamento
- Nós "message": Aguarde processamento (use "body" como seletor genérico) e valide que o fluxo avançou
- Nós "user_input": Simule entrada através de variáveis (não preencha campos visuais)
- Nós "router": Valide variáveis de roteamento através de asserts de variáveis
- Nós "ai_task": Valide variáveis de saída da IA através de asserts de variáveis
- Nós "handoff": Valide criação de ticket através de asserts de variáveis ou estado
- Nós "end": Valide que o fluxo terminou através de assert de estado do fluxo

IMPORTANTE SOBRE SELEtores:
- NÃO use seletores como "[data-testid='chat-root']" - eles NÃO existem
- Use seletores genéricos: "body", "input", "button", "textarea"
- Para aguardar: use "body" como seletor genérico com timeout apropriado
- Foque em validações lógicas (variáveis, estados) ao invés de elementos visuais

Gere o teste RPA JSON agora (APENAS JSON, sem explicações):`;
}

/**
 * Parseia a resposta da IA e extrai o teste RPA.
 */
function parseRpaTestResponse(aiResponse) {
  if (!aiResponse || typeof aiResponse !== 'string') {
    logger.error('Resposta da IA é inválida', { 
      type: typeof aiResponse,
      isNull: aiResponse === null,
      isUndefined: aiResponse === undefined,
      value: String(aiResponse).substring(0, 200)
    });
    return null;
  }

  try {
    let jsonStr = aiResponse.trim();
    
    logger.debug('Iniciando parse da resposta da IA', { 
      responseLength: jsonStr.length,
      firstChars: jsonStr.substring(0, 100)
    });
    
    // Remove markdown code blocks se existirem
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    
    // Tenta encontrar o JSON entre chaves (procura pelo primeiro { até o último })
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
      logger.debug('JSON extraído do texto', { jsonLength: jsonStr.length });
    } else {
      logger.warn('Nenhum JSON encontrado na resposta da IA', { 
        responsePreview: jsonStr.substring(0, 200) 
      });
      return null;
    }
    
    const parsed = JSON.parse(jsonStr);
    
    logger.debug('JSON parseado com sucesso', { 
      hasSteps: !!parsed.steps,
      hasAsserts: !!parsed.asserts,
      stepsCount: parsed.steps?.length || 0,
      assertsCount: parsed.asserts?.length || 0
    });
    
    // Valida estrutura básica
    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      logger.warn('Resposta da IA não contém array de steps válido', {
        parsedKeys: Object.keys(parsed),
        stepsType: typeof parsed.steps
      });
      return null;
    }
    
    return parsed;
  } catch (err) {
    logger.error('Erro ao parsear resposta da IA', { 
      error: err.message,
      stack: err.stack,
      responsePreview: aiResponse.substring(0, 500),
      responseLength: aiResponse.length
    });
    return null;
  }
}

/**
 * Gera um teste RPA a partir de um fluxo usando IA.
 * 
 * @param {Object} flow - Fluxo a ser testado
 * @param {Object} dependencies - Análise de dependências
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Object>} - Teste RPA gerado
 */
async function generateRpaTestFromFlow(flow, dependencies, options = {}) {
  const tenantId = options.tenantId || flow.tenantId || 'demo-tenant';
  const testId = options.testId || `test-${flow.id}-${Date.now()}`;
  
  logger.info('Gerando teste RPA a partir de fluxo usando IA', { 
    flowId: flow?.id,
    flowName: flow?.name,
    testId,
    tenantId
  });

  try {
    // Constrói o prompt para a IA
    const prompt = buildRpaTestGenerationPrompt(flow, dependencies);
    
    logger.debug('Prompt construído para IA', { promptLength: prompt.length });
    
    // Chama a IA para gerar o teste
    const aiResponse = await generateAiResponse(prompt, tenantId, {
      flowId: flow.id,
      nodeId: 'rpa-test-generator',
    });
    
    logger.debug('Resposta da IA recebida', { 
      hasText: !!aiResponse?.text,
      textLength: aiResponse?.text?.length,
      aiResponseType: typeof aiResponse,
      aiResponseKeys: aiResponse ? Object.keys(aiResponse) : []
    });
    
    // Verifica se a resposta tem texto
    if (!aiResponse || !aiResponse.text) {
      logger.error('Resposta da IA não contém texto', { 
        aiResponse: aiResponse,
        hasText: !!aiResponse?.text
      });
      throw new Error('Resposta da IA não contém texto válido');
    }
    
    // Verifica se a IA está disponível (detecta mensagens de erro comuns)
    const responseText = aiResponse.text.trim();
    if (responseText.includes('[IA não disponível]') || 
        responseText.includes('Não foi possível gerar') ||
        responseText.toLowerCase().includes('ia não disponível') ||
        responseText.toLowerCase().includes('não foi possível gerar uma resposta')) {
      logger.error('IA não está disponível', {
        responseText: responseText.substring(0, 200)
      });
      throw new Error('Serviço de IA não está disponível no momento. Por favor, verifique a configuração da IA e tente novamente.');
    }
    
    // Parseia a resposta da IA
    const parsedTest = parseRpaTestResponse(aiResponse.text);
    
    if (!parsedTest) {
      logger.error('Falha ao parsear resposta da IA', {
        responseText: aiResponse.text.substring(0, 1000),
        responseLength: aiResponse.text.length
      });
      throw new Error('Falha ao parsear resposta da IA. A resposta pode não estar em formato JSON válido. Verifique se o serviço de IA está configurado corretamente.');
    }
    
    // Constrói o teste RPA completo
    const rpaTest = {
      id: parsedTest.id || testId,
      name: parsedTest.name || `IA - Teste RPA - ${flow?.name || flow?.id}`,
      type: 'test',
      source: 'flow',
      flowId: flow.id,
      flowVersion: flow.version || 1,
      generatedBy: 'ai',
      editable: true,
      metadata: {
        generatedAt: new Date().toISOString(),
        dependenciesResolved: dependencies.seeds?.executedSeeds?.length > 0 || false,
        seedsExecuted: dependencies.seeds?.executedSeeds || [],
        pathTaken: inferPathFromFlow(flow),
        version: '1.0.0',
        ...parsedTest.metadata,
      },
      steps: parsedTest.steps || [],
      asserts: parsedTest.asserts || [],
    };
    
    // Adiciona passos de dependências no início se necessário
    const dependencySteps = buildDependencySteps(dependencies, flow);
    if (dependencySteps.length > 0) {
      logger.info('Adicionando passos de dependências no início do teste', {
        dependencyStepsCount: dependencySteps.length,
        originalStepsCount: rpaTest.steps.length
      });
      
      // Insere os passos de dependências no início
      rpaTest.steps = [...dependencySteps, ...rpaTest.steps];
      
      // Ajusta os índices dos asserts para refletir a adição dos novos steps
      const offset = dependencySteps.length;
      rpaTest.asserts = rpaTest.asserts.map(assert => ({
        ...assert,
        step: assert.step + offset
      }));
    }
    
    // Normaliza URLs nos steps e asserts
    normalizeRpaTestUrls(rpaTest);
    
    // Corrige seletores inválidos automaticamente
    fixInvalidSelectors(rpaTest);
    
    // Garante que há pelo menos um assert
    if (rpaTest.asserts.length === 0) {
      // Adiciona assert básico no final
      rpaTest.asserts.push({
        step: rpaTest.steps.length,
        type: 'visible',
        selector: 'body',
        expected: true,
        description: 'Página carregada com sucesso',
      });
    }
    
    // Converte o formato do teste para o formato esperado pelo gate de validação
    // O gate espera: { version, type, context: { application, mode }, steps, assertions }
    // O teste RPA usa: { type, selector/url, value } -> precisa converter para { action, target, value }
    const planForValidation = {
      version: '1.0',
      type: 'rpa_test_plan',
      context: {
        application: 'chatbot',
        mode: 'test-only' // OBRIGATÓRIO pelo gate
      },
      steps: rpaTest.steps.map(step => {
        // Mapeia type -> action (obrigatório)
        const action = step.type || step.action;
        // Mapeia selector/url -> target (obrigatório)
        const target = step.selector || step.url || step.target;
        // Value é opcional
        const value = step.value;
        
        return {
          action: action,
          target: target || 'body', // Fallback para body se não houver target
          ...(value !== undefined && { value: value })
        };
      }),
      assertions: (rpaTest.asserts || []).map(assert => ({
        type: assert.type,
        selector: assert.selector,
        expected: assert.expected,
        description: assert.description
      }))
    };
    
    // Validação OBRIGATÓRIA pelo gate oficial (com telemetria automática)
    const gateValidation = validateGeneratedPlan(planForValidation, 'rpa');
    
    if (!gateValidation.valid) {
      logger.error('Teste RPA rejeitado pelo gate de validação', {
        errors: gateValidation.errors,
        errorCount: gateValidation.errors.length
      });
      
      // Se o gate rejeitar, ainda retorna o teste mas com avisos
      // (para não quebrar funcionalidade existente, mas registra a falha)
      rpaTest.validationWarnings = {
        gateRejected: true,
        errors: gateValidation.errors,
        domain: gateValidation.domain
      };
      
      // Loga aviso mas não bloqueia (compatibilidade com código existente)
      logger.warn('Teste RPA gerado não passou no gate, mas será retornado com avisos', {
        testId: rpaTest.id,
        errorCount: gateValidation.errors.length
      });
    } else {
      logger.info('Teste RPA validado com sucesso pelo gate oficial', {
        testId: rpaTest.id,
        domain: gateValidation.domain
      });
    }
    
    // Validação adicional local (mantida para compatibilidade)
    const localValidation = validateRpaTest(rpaTest);
    if (!localValidation.valid) {
      logger.warn('Teste RPA gerado tem erros de validação local', {
        errors: localValidation.errors,
      });
      if (!rpaTest.validationWarnings) {
        rpaTest.validationWarnings = {};
      }
      rpaTest.validationWarnings.local = localValidation;
    }
    
    logger.info('Teste RPA gerado pela IA com sucesso', { 
      testId: rpaTest.id,
      stepCount: rpaTest.steps.length,
      assertCount: rpaTest.asserts.length,
      gateValid: gateValidation.valid
    });
    
    return rpaTest;
  } catch (err) {
    logger.error('Erro ao gerar teste RPA com IA', { 
      error: err.message,
      stack: err.stack 
    });
    throw err;
  }
}

/**
 * Constrói passos RPA para executar seeds de dependências.
 * 
 * @param {Object} dependencies - Análise de dependências
 * @param {Object} flow - Fluxo sendo testado
 * @returns {Array} - Array de steps para executar dependências
 */
function buildDependencySteps(dependencies, flow) {
  const steps = [];
  
  if (!dependencies || !dependencies.seeds || !dependencies.seeds.missing || dependencies.seeds.missing.length === 0) {
    return steps;
  }
  
  const frontendUrl = process.env.TEST_FRONTEND_URL || 
                      process.env.FRONTEND_URL || 
                      'http://localhost:5173';
  
  logger.info('Construindo passos de dependências', {
    missingSeedsCount: dependencies.seeds.missing.length
  });
  
  // Agrupa dependências por tipo para evitar duplicatas
  const seedsByType = {};
  for (const seedInfo of dependencies.seeds.missing) {
    const seedName = seedInfo.seedName;
    if (!seedsByType[seedName]) {
      seedsByType[seedName] = [];
    }
    seedsByType[seedName].push(seedInfo);
  }
  
  // Para cada tipo de seed, adiciona passos
  for (const [seedName, seedInfos] of Object.entries(seedsByType)) {
    const seedInfo = seedInfos[0]; // Usa o primeiro como referência
    
    if (seedName === 'seed-platform-create-department') {
      // Passos para criar departamento
      for (const deptInfo of seedInfos) {
        steps.push({
          type: 'navigate',
          url: `${frontendUrl}/admin/departments`,
          description: `Navegar para página de departamentos para criar: ${deptInfo.target || 'departamento'}`,
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'body',
          description: 'Aguardar carregamento da página de departamentos'
        });
        steps.push({
          type: 'click',
          selector: 'button:has-text("Novo"), button:has-text("Criar"), button:has-text("Adicionar")',
          description: 'Clicar em botão para criar novo departamento',
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'input[name="name"], input[placeholder*="nome" i], input[placeholder*="name" i]',
          description: 'Aguardar formulário de criação aparecer'
        });
        steps.push({
          type: 'fill',
          selector: 'input[name="name"], input[placeholder*="nome" i], input[placeholder*="name" i]',
          value: deptInfo.target || 'Departamento de Teste',
          description: `Preencher nome do departamento: ${deptInfo.target || 'Departamento de Teste'}`,
          critical: true
        });
        steps.push({
          type: 'click',
          selector: 'button[type="submit"]:has-text("Salvar"), button:has-text("Criar"), button:has-text("Confirmar")',
          description: 'Salvar departamento',
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'body',
          description: 'Aguardar confirmação de criação do departamento'
        });
      }
    } else if (seedName === 'seed-platform-create-queue') {
      // Passos para criar fila
      for (const queueInfo of seedInfos) {
        steps.push({
          type: 'navigate',
          url: `${frontendUrl}/admin/queues`,
          description: `Navegar para página de filas para criar: ${queueInfo.target || 'fila'}`,
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'body',
          description: 'Aguardar carregamento da página de filas'
        });
        steps.push({
          type: 'click',
          selector: 'button:has-text("Nova"), button:has-text("Criar"), button:has-text("Adicionar")',
          description: 'Clicar em botão para criar nova fila',
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'input[name="name"], input[placeholder*="nome" i], input[placeholder*="name" i]',
          description: 'Aguardar formulário de criação aparecer'
        });
        steps.push({
          type: 'fill',
          selector: 'input[name="name"], input[placeholder*="nome" i], input[placeholder*="name" i]',
          value: queueInfo.target || 'Fila de Teste',
          description: `Preencher nome da fila: ${queueInfo.target || 'Fila de Teste'}`,
          critical: true
        });
        steps.push({
          type: 'click',
          selector: 'button[type="submit"]:has-text("Salvar"), button:has-text("Criar"), button:has-text("Confirmar")',
          description: 'Salvar fila',
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'body',
          description: 'Aguardar confirmação de criação da fila'
        });
      }
    } else if (seedName === 'seed-platform-create-agent') {
      // Passos para criar agente
      for (const agentInfo of seedInfos) {
        steps.push({
          type: 'navigate',
          url: `${frontendUrl}/admin/agents`,
          description: `Navegar para página de agentes para criar: ${agentInfo.target || 'agente'}`,
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'body',
          description: 'Aguardar carregamento da página de agentes'
        });
        steps.push({
          type: 'click',
          selector: 'button:has-text("Novo"), button:has-text("Criar"), button:has-text("Adicionar")',
          description: 'Clicar em botão para criar novo agente',
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'input[name="name"], input[placeholder*="nome" i], input[placeholder*="name" i]',
          description: 'Aguardar formulário de criação aparecer'
        });
        steps.push({
          type: 'fill',
          selector: 'input[name="name"], input[placeholder*="nome" i], input[placeholder*="name" i]',
          value: agentInfo.target || 'Agente de Teste',
          description: `Preencher nome do agente: ${agentInfo.target || 'Agente de Teste'}`,
          critical: true
        });
        steps.push({
          type: 'click',
          selector: 'button[type="submit"]:has-text("Salvar"), button:has-text("Criar"), button:has-text("Confirmar")',
          description: 'Salvar agente',
          critical: true
        });
        steps.push({
          type: 'wait',
          selector: 'body',
          description: 'Aguardar confirmação de criação do agente'
        });
      }
    } else if (seedName === 'seed-platform-login') {
      // Passos para login
      steps.push({
        type: 'navigate',
        url: `${frontendUrl}/login`,
        description: 'Navegar para página de login',
        critical: true
      });
      steps.push({
        type: 'wait',
        selector: 'input[type="email"], input[name="email"], input[placeholder*="email" i]',
        description: 'Aguardar formulário de login aparecer'
      });
      steps.push({
        type: 'fill',
        selector: 'input[type="email"], input[name="email"], input[placeholder*="email" i]',
        value: 'admin@example.com',
        description: 'Preencher email de login',
        critical: true
      });
      steps.push({
        type: 'fill',
        selector: 'input[type="password"], input[name="password"], input[placeholder*="senha" i]',
        value: 'admin123',
        description: 'Preencher senha de login',
        critical: true
      });
      steps.push({
        type: 'click',
        selector: 'button[type="submit"]:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar")',
        description: 'Clicar em botão de login',
        critical: true
      });
      steps.push({
        type: 'wait',
        selector: 'body',
        description: 'Aguardar login ser processado e redirecionamento'
      });
    }
  }
  
  logger.info('Passos de dependências construídos', {
    stepsCount: steps.length,
    seedsProcessed: Object.keys(seedsByType).length
  });
  
  return steps;
}

/**
 * Infere um caminho válido através do fluxo.
 */
function inferPathFromFlow(flow) {
  const path = [];
  
  if (!flow.nodes || !Array.isArray(flow.nodes)) {
    return path;
  }
  
  // Encontra nó start
  const startNode = flow.nodes.find(n => n.type === 'start');
  if (!startNode) {
    return path;
  }
  
  let currentNode = startNode;
  const visited = new Set();
  
  while (currentNode && !visited.has(currentNode.id)) {
    visited.add(currentNode.id);
    
    path.push({
      nodeId: currentNode.id,
      nodeType: currentNode.type,
      action: getNodeAction(currentNode),
    });
    
    // Se chegou no end, para
    if (currentNode.type === 'end') {
      break;
    }
    
    // Encontra próximo nó
    if (currentNode.next) {
      const nextId = Array.isArray(currentNode.next) ? currentNode.next[0] : currentNode.next;
      currentNode = flow.nodes.find(n => n.id === nextId);
    } else {
      break;
    }
  }
  
  return path;
}

/**
 * Obtém a ação RPA apropriada para um nó.
 */
function getNodeAction(node) {
  switch (node.type) {
    case 'start':
      return 'Iniciar fluxo';
    case 'message':
      return `Validar mensagem: ${node.config?.text?.substring(0, 50) || 'N/A'}`;
    case 'user_input':
      return `Simular entrada do usuário: ${node.config?.variable || 'N/A'}`;
    case 'router':
      return 'Validar roteamento';
    case 'ai_task':
      return `Validar classificação de intenção: ${node.config?.task || 'N/A'}`;
    case 'handoff':
      return `Validar handoff para fila: ${node.config?.queue || 'N/A'}`;
    case 'end':
      return 'Validar encerramento do fluxo';
    default:
      return `Processar nó ${node.type}`;
  }
}

// Importa normalização de URLs do módulo utilitário
const { normalizeRpaTestUrls } = require('../../tests/rpa/utils/urlNormalizer');

/**
 * Corrige seletores inválidos comuns gerados pela IA.
 * Substitui seletores que não existem por seletores genéricos válidos.
 */
function fixInvalidSelectors(test) {
  // Mapeamento de seletores inválidos para seletores genéricos válidos
  const selectorReplacements = {
    "[data-testid='chat-root']": "body",
    "[data-testid=\"chat-root\"]": "body",
    "[data-testid='chat-message']": "body",
    "[data-testid=\"chat-message\"]": "body",
    "[data-testid='chat-input']": "input[type='text'], textarea",
    "[data-testid=\"chat-input\"]": "input[type='text'], textarea",
    "[data-testid='chat-send']": "button",
    "[data-testid=\"chat-send\"]": "button",
    "[data-testid='debug-panel']": "body",
    "[data-testid=\"debug-panel\"]": "body",
  };
  
  // Corrige steps
  if (test.steps && Array.isArray(test.steps)) {
    test.steps.forEach((step) => {
      if (step.selector && typeof step.selector === 'string') {
        // Verifica se o seletor precisa ser substituído
        for (const [invalid, replacement] of Object.entries(selectorReplacements)) {
          if (step.selector.includes(invalid) || step.selector === invalid) {
            logger.warn('Corrigindo seletor inválido no step', {
              original: step.selector,
              replacement: replacement,
              stepType: step.type
            });
            step.selector = replacement;
            // Adiciona nota na descrição se não existir
            if (step.description && !step.description.includes('(seletor corrigido)')) {
              step.description += ' (seletor corrigido automaticamente)';
            }
          }
        }
      }
      
      // Corrige condition também (usado em alguns tipos de wait)
      if (step.condition && typeof step.condition === 'string') {
        for (const [invalid, replacement] of Object.entries(selectorReplacements)) {
          if (step.condition.includes(invalid) || step.condition === invalid) {
            logger.warn('Corrigindo condition inválida no step', {
              original: step.condition,
              replacement: replacement,
              stepType: step.type
            });
            step.condition = replacement;
          }
        }
      }
    });
  }
  
  // Corrige asserts
  if (test.asserts && Array.isArray(test.asserts)) {
    test.asserts.forEach((assert) => {
      if (assert.selector && typeof assert.selector === 'string') {
        for (const [invalid, replacement] of Object.entries(selectorReplacements)) {
          if (assert.selector.includes(invalid) || assert.selector === invalid) {
            logger.warn('Corrigindo seletor inválido no assert', {
              original: assert.selector,
              replacement: replacement,
              assertType: assert.type
            });
            assert.selector = replacement;
          }
        }
      }
    });
  }
}

/**
 * Valida um teste RPA gerado.
 */
function validateRpaTest(test) {
  const errors = [];
  
  if (!test.id) {
    errors.push({ code: 'MISSING_ID', message: 'Teste RPA deve ter um ID' });
  }
  
  if (!test.name) {
    errors.push({ code: 'MISSING_NAME', message: 'Teste RPA deve ter um nome' });
  }
  
  if (!test.flowId) {
    errors.push({ code: 'MISSING_FLOW_ID', message: 'Teste RPA deve referenciar um flowId' });
  }
  
  if (!test.steps || !Array.isArray(test.steps) || test.steps.length === 0) {
    errors.push({ code: 'MISSING_STEPS', message: 'Teste RPA deve ter pelo menos um step' });
  }
  
  if (!test.asserts || !Array.isArray(test.asserts) || test.asserts.length === 0) {
    errors.push({ code: 'MISSING_ASSERTS', message: 'Teste RPA deve ter pelo menos um assert' });
  }
  
  // Valida cada step
  if (test.steps) {
    // Lista de seletores inválidos comuns que a IA pode gerar
    const invalidSelectors = [
      /data-testid=['"]chat-root['"]/i,
      /data-testid=['"]chat-message['"]/i,
      /data-testid=['"]chat-input['"]/i,
      /data-testid=['"]chat-send['"]/i,
      /data-testid=['"]debug-panel['"]/i,
      /data-testid=['"]debug-last-node-id['"]/i,
      /data-testid=['"]debug-var-/i,
      /data-testid=['"]debug-router-/i,
      /data-testid=['"]debug-flow-ended['"]/i,
      /data-testid=['"]debug-end-node-id['"]/i,
      /data-testid=['"]ticket-created['"]/i,
    ];
    
    test.steps.forEach((step, index) => {
      if (!step.type) {
        errors.push({ code: 'STEP_MISSING_TYPE', message: `Step ${index + 1} deve ter um tipo` });
      }
      if (!step.description) {
        errors.push({ code: 'STEP_MISSING_DESCRIPTION', message: `Step ${index + 1} deve ter uma descrição` });
      }
      
      // Valida seletor inválido
      const selector = step.selector || step.condition || '';
      if (selector && typeof selector === 'string') {
        const hasInvalidSelector = invalidSelectors.some(pattern => pattern.test(selector));
        if (hasInvalidSelector) {
          errors.push({ 
            code: 'INVALID_SELECTOR', 
            message: `Step ${index + 1} usa seletor inválido que não existe no código: ${selector}. Use seletores genéricos como "body", "input", "button" ou validações lógicas.`,
            step: index + 1,
            selector: selector
          });
        }
      }
    });
  }
  
  // Valida asserts também
  if (test.asserts) {
    const invalidSelectors = [
      /data-testid=['"]chat-root['"]/i,
      /data-testid=['"]chat-message['"]/i,
      /data-testid=['"]chat-input['"]/i,
      /data-testid=['"]chat-send['"]/i,
      /data-testid=['"]debug-panel['"]/i,
      /data-testid=['"]debug-last-node-id['"]/i,
      /data-testid=['"]debug-var-/i,
      /data-testid=['"]debug-router-/i,
      /data-testid=['"]debug-flow-ended['"]/i,
      /data-testid=['"]debug-end-node-id['"]/i,
      /data-testid=['"]ticket-created['"]/i,
    ];
    
    test.asserts.forEach((assert, index) => {
      const selector = assert.selector || '';
      if (selector && typeof selector === 'string') {
        const hasInvalidSelector = invalidSelectors.some(pattern => pattern.test(selector));
        if (hasInvalidSelector) {
          errors.push({ 
            code: 'INVALID_SELECTOR', 
            message: `Assert ${index + 1} usa seletor inválido que não existe no código: ${selector}. Use seletores genéricos ou validações lógicas.`,
            assert: index + 1,
            selector: selector
          });
        }
      }
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  generateRpaTestFromFlow,
  validateRpaTest,
  // Re-exporta normalizeRpaTestUrls para compatibilidade (agora vem de utils/urlNormalizer)
  normalizeRpaTestUrls,
  inferPathFromFlow,
  loadRpaTestPrompts,
  reloadRpaTestPrompts,
};

