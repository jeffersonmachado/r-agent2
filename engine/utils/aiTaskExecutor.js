/**
 * Executor de tarefas de IA (módulo compartilhado).
 *
 * Este módulo pode ser usado tanto no backend (Node.js) quanto no frontend.
 * 
 * Responsabilidades:
 * - Executar tarefas de IA de forma controlada e determinística
 * - Não depender de APIs externas (usa implementação mock)
 * - Retornar respostas estruturadas e validáveis
 * - Suportar diferentes tipos de tarefas: intent_classification, entity_extraction, text_normalization, assisted_response
 *
 * Princípios:
 * - IA nunca decide o fluxo
 * - IA apenas produz dados estruturados
 * - O fluxo continua sendo a única autoridade de decisão
 */

/**
 * Tipos de tarefas de IA suportadas.
 */
const SUPPORTED_TASKS = {
  intent_classification: 'intent_classification',
  entity_extraction: 'entity_extraction',
  text_normalization: 'text_normalization',
  assisted_response: 'assisted_response',
};

/**
 * Executa uma tarefa de classificação de intenção.
 *
 * @param {string} input - Texto de entrada do usuário
 * @param {Object} config - Configuração do nó (allowedOutputs, fallback, confidenceThreshold, keywords)
 * @returns {Promise<{value: string, confidence: number}>}
 */
async function executeIntentClassification(input, config) {
  const text = String(input || '').toLowerCase().trim();
  const allowedOutputs = Array.isArray(config.allowedOutputs) ? config.allowedOutputs : [];
  const fallback = config.fallback || 'desconhecido';
  const confidenceThreshold = typeof config.confidenceThreshold === 'number' 
    ? config.confidenceThreshold 
    : 0.75;

  // Palavras-chave padrão (fallback se não configuradas)
  const defaultKeywordMap = {
    comprar: ['comprar', 'quero comprar', 'desejo comprar', 'adquirir', 'vender'],
    suporte: ['suporte', 'ajuda', 'problema', 'erro', 'não funciona', 'dúvida'],
    financeiro: ['financeiro', 'pagamento', 'boleto', 'fatura', 'conta', 'dinheiro'],
  };

  // Usa palavras-chave do config se disponível, senão usa as padrão
  let keywordMap = defaultKeywordMap;
  if (config.keywords && typeof config.keywords === 'object') {
    // Config.keywords pode ser um objeto { intent: [palavras] } ou um array de objetos
    if (Array.isArray(config.keywords)) {
      // Formato: [{ intent: "comprar", keywords: ["comprar", "adquirir"] }, ...]
      keywordMap = {};
      config.keywords.forEach((item) => {
        if (item.intent && Array.isArray(item.keywords)) {
          keywordMap[item.intent] = item.keywords;
        }
      });
    } else {
      // Formato: { comprar: ["comprar", "adquirir"], suporte: ["ajuda", ...] }
      keywordMap = config.keywords;
    }
    // Se o keywordMap configurado estiver vazio, usa o padrão
    if (Object.keys(keywordMap).length === 0) {
      keywordMap = defaultKeywordMap;
    }
  }

  let bestMatch = null;
  let bestConfidence = 0;

  // Converte keywords para lowercase para comparação
  const normalizedKeywords = {};
  for (const [intent, keywords] of Object.entries(keywordMap)) {
    if (Array.isArray(keywords) && keywords.length > 0) {
      normalizedKeywords[intent] = keywords
        .map(k => String(k).toLowerCase().trim())
        .filter(k => k.length > 0);
    }
  }

  for (const [intent, keywords] of Object.entries(normalizedKeywords)) {
    // Verifica se a intenção está nas saídas permitidas (se allowedOutputs estiver definido)
    if (allowedOutputs.length > 0 && !allowedOutputs.includes(intent)) {
      continue;
    }

    for (const keyword of keywords) {
      // Verifica se o texto contém a palavra-chave (match exato ou parcial)
      if (keyword && text.includes(keyword)) {
        // Calcula confiança baseada na correspondência
        // Match exato = 1.0, match parcial = proporcional
        let confidence = 1.0;
        if (text !== keyword) {
          // Match parcial: quanto maior a proporção da palavra-chave no texto, maior a confiança
          // Se a palavra-chave é uma palavra completa no texto, confiança maior
          const words = text.split(/\s+/);
          const isExactWord = words.includes(keyword);
          if (isExactWord) {
            confidence = 0.95; // Match de palavra completa
          } else {
            confidence = Math.min(0.9, keyword.length / Math.max(text.length, 1));
          }
        }
        
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = intent;
        }
      }
    }
  }

  // Normaliza confiança para estar entre 0.5 e 0.95
  // Match exato = 0.95, match parcial = proporcional entre 0.5 e 0.95
  const normalizedConfidence = bestMatch 
    ? Math.min(0.95, Math.max(0.5, 0.5 + (bestConfidence * 0.45)))
    : 0.3;

  // Se encontrou match e confiança está acima do threshold, retorna
  if (bestMatch && normalizedConfidence >= confidenceThreshold) {
    return {
      value: bestMatch,
      confidence: normalizedConfidence,
    };
  }

  // Se encontrou match mas confiança está abaixo do threshold, ainda retorna o match
  // mas com confiança baixa (o fallback será usado pelo caller se necessário)
  if (bestMatch) {
    return {
      value: bestMatch,
      confidence: normalizedConfidence,
      _lowConfidence: normalizedConfidence < confidenceThreshold,
    };
  }

  // Nenhum match encontrado - retorna null para indicar que não houve match
  // O caller deve usar o fallback neste caso
  return {
    value: null,
    confidence: 0.0,
    _noMatch: true,
  };
}

/**
 * Executa uma tarefa de extração de entidades.
 *
 * @param {string} input - Texto de entrada
 * @param {Object} config - Configuração do nó
 * @returns {Promise<{entities: Array<{type: string, value: string, confidence: number}>}>}
 */
async function executeEntityExtraction(input, config) {
  const text = String(input || '').trim();
  const entities = [];

  // Mock: extrai números, emails e datas básicas
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const phoneRegex = /\b\d{10,11}\b/g;
  const numberRegex = /\b\d+\.?\d*\b/g;

  const emails = text.match(emailRegex) || [];
  const phones = text.match(phoneRegex) || [];
  const numbers = text.match(numberRegex) || [];

  emails.forEach((email) => {
    entities.push({
      type: 'email',
      value: email,
      confidence: 0.9,
    });
  });

  phones.forEach((phone) => {
    entities.push({
      type: 'phone',
      value: phone,
      confidence: 0.85,
    });
  });

  // Limita números para evitar muitos resultados
  numbers.slice(0, 3).forEach((num) => {
    entities.push({
      type: 'number',
      value: num,
      confidence: 0.8,
    });
  });

  return { entities };
}

/**
 * Executa uma tarefa de normalização de texto.
 *
 * @param {string} input - Texto de entrada
 * @param {Object} config - Configuração do nó
 * @returns {Promise<{normalized: string, confidence: number}>}
 */
async function executeTextNormalization(input, config) {
  const text = String(input || '').trim();
  
  // Normalização básica: remove acentos, converte para minúsculas, remove espaços extras
  let normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/\s+/g, ' ') // Remove espaços extras
    .trim();

  return {
    normalized,
    confidence: 0.9,
  };
}

/**
 * Executa uma tarefa de resposta assistida.
 *
 * @param {string} input - Texto de entrada do usuário
 * @param {Object} config - Configuração do nó
 * @param {Object} context - Contexto da conversa (variáveis, histórico)
 * @returns {Promise<{response: string, confidence: number}>}
 */
async function executeAssistedResponse(input, config, context) {
  const text = String(input || '').trim();
  
  // Mock: gera resposta básica baseada em padrões
  // Em produção, isso seria substituído por chamada real à IA
  let response = 'Entendi sua solicitação. Como posso ajudar?';
  let confidence = 0.7;

  if (text.includes('?')) {
    response = 'Vou verificar isso para você.';
    confidence = 0.75;
  }

  if (text.length > 50) {
    response = 'Recebi sua mensagem. Vou processar sua solicitação.';
    confidence = 0.8;
  }

  return {
    response,
    confidence,
  };
}

/**
 * Executa uma tarefa de IA.
 *
 * @param {string} task - Tipo de tarefa (intent_classification, entity_extraction, etc.)
 * @param {string} input - Input para a tarefa (geralmente texto)
 * @param {Object} config - Configuração do nó ai_task
 * @param {Object} [context] - Contexto adicional (variáveis, histórico)
 * @returns {Promise<Object>} Resultado estruturado da tarefa
 */
async function executeAiTask(task, input, config = {}, context = {}) {
  // Validação básica
  if (!task || typeof task !== 'string') {
    throw new Error('aiTaskExecutor: task deve ser uma string válida');
  }

  if (!SUPPORTED_TASKS[task]) {
    throw new Error(`aiTaskExecutor: tarefa não suportada: ${task}`);
  }

  // Executa a tarefa específica
  switch (task) {
    case SUPPORTED_TASKS.intent_classification:
      return executeIntentClassification(input, config);

    case SUPPORTED_TASKS.entity_extraction:
      return executeEntityExtraction(input, config);

    case SUPPORTED_TASKS.text_normalization:
      return executeTextNormalization(input, config);

    case SUPPORTED_TASKS.assisted_response:
      return executeAssistedResponse(input, config, context);

    default:
      throw new Error(`aiTaskExecutor: handler não implementado para tarefa: ${task}`);
  }
}

/**
 * Valida a estrutura de uma resposta de IA.
 *
 * @param {Object} response - Resposta da IA
 * @param {string} task - Tipo de tarefa
 * @param {Object} config - Configuração do nó
 * @returns {{valid: boolean, error?: string}}
 */
function validateResponse(response, task, config) {
  if (!response || typeof response !== 'object') {
    return { valid: false, error: 'Resposta deve ser um objeto' };
  }

  switch (task) {
    case SUPPORTED_TASKS.intent_classification:
      // Se _noMatch está presente, a resposta indica que não houve match (válido, mas deve usar fallback)
      if (response._noMatch || response.value === null) {
        return { valid: true }; // Válido, mas indica que deve usar fallback
      }
      if (typeof response.value !== 'string') {
        return { valid: false, error: 'Resposta deve ter campo "value" (string)' };
      }
      if (typeof response.confidence !== 'number') {
        return { valid: false, error: 'Resposta deve ter campo "confidence" (number)' };
      }
      if (response.confidence < 0 || response.confidence > 1) {
        return { valid: false, error: 'Confidence deve estar entre 0 e 1' };
      }
      // Valida se o valor está em allowedOutputs (se definido)
      if (Array.isArray(config.allowedOutputs) && config.allowedOutputs.length > 0) {
        if (!config.allowedOutputs.includes(response.value) && response.value !== config.fallback) {
          return { valid: false, error: `Valor "${response.value}" não está em allowedOutputs` };
        }
      }
      break;

    case SUPPORTED_TASKS.entity_extraction:
      if (!Array.isArray(response.entities)) {
        return { valid: false, error: 'Resposta deve ter campo "entities" (array)' };
      }
      break;

    case SUPPORTED_TASKS.text_normalization:
      if (typeof response.normalized !== 'string') {
        return { valid: false, error: 'Resposta deve ter campo "normalized" (string)' };
      }
      break;

    case SUPPORTED_TASKS.assisted_response:
      if (typeof response.response !== 'string') {
        return { valid: false, error: 'Resposta deve ter campo "response" (string)' };
      }
      break;

    default:
      return { valid: false, error: `Tarefa não suportada: ${task}` };
  }

  return { valid: true };
}

// Exportação CommonJS (para Node.js/backend)
// O Vite pode importar CommonJS normalmente, então não precisamos de export ES module explícito
module.exports = {
  executeAiTask,
  validateResponse,
  SUPPORTED_TASKS,
  executeIntentClassification,
  executeEntityExtraction,
  executeTextNormalization,
  executeAssistedResponse,
};

