/**
 * CDR Validator - Capability-Driven Responses Validator
 * 
 * Valida todas as respostas do chatbot antes de serem enviadas ao usuário.
 * Bloqueia qualquer resposta que prometa, simule ou sugira capacidades inexistentes.
 * 
 * Regras implementadas:
 * R1 - Ações inexistentes
 * R2 - Promessas de futuro
 * R3 - Simulação de humano ou setor
 * R4 - Estados operacionais falsos
 * R5 - Negativa inválida
 */

const fs = require('fs');
const path = require('path');

// Cache de capacidades
let capabilitiesCache = null;

/**
 * Carrega o arquivo de capacidades
 * @returns {Object|null} Objeto com can/cannot ou null se não encontrado
 */
function loadCapabilities() {
  if (capabilitiesCache) {
    return capabilitiesCache;
  }

  try {
    const capabilitiesPath = path.join(__dirname, '../config/capabilities.json');
    const capabilitiesContent = fs.readFileSync(capabilitiesPath, 'utf8');
    capabilitiesCache = JSON.parse(capabilitiesContent);
    return capabilitiesCache;
  } catch (error) {
    console.error('[CDR Validator] Erro ao carregar capabilities.json:', error.message);
    // Fallback: retorna objeto vazio para não quebrar
    return { can: [], cannot: [] };
  }
}

/**
 * Detecta se o ambiente é produção ou QA runtime
 * @returns {boolean} True se for produção/QA runtime
 */
function isProductionOrQa() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  return nodeEnv === 'production' || nodeEnv === 'qa' || nodeEnv === 'qa-runtime';
}

/**
 * R1 - Detecta ações inexistentes
 * Verifica verbos operacionais associados a capacidades não declaradas
 * @param {string} text - Texto da resposta
 * @param {Object} capabilities - Objeto de capacidades
 * @returns {Array<string>} Array de erros encontrados
 */
function checkR1_ActionsNotAllowed(text, capabilities) {
  const errors = [];
  const textLower = text.toLowerCase();
  
  // Verbos operacionais que indicam ações
  const actionVerbs = [
    /\b(?:vou|irei|vamos|iremos)\s+(?:abrir|solicitar|verificar|analisar|encaminhar|processar|executar|criar|alterar|excluir|resolver|consultar|buscar|enviar|transferir|pedir|fazer|realizar)/i,
    /\b(?:já|estou|estamos|foi|será|serão)\s+(?:abrindo|solicitando|verificando|analisando|encaminhando|processando|executando|criando|alterando|excluindo|resolvendo|consultando|buscando|enviando|transferindo|pedindo|fazendo|realizando)/i,
    /\b(?:abri|solicitei|verifiquei|analisei|encaminhei|processei|executei|criei|alterei|excluí|resolvi|consultei|busquei|enviei|transfiri|pedi|fiz|realizei)\b/i
  ];

  // Verifica se há verbos de ação
  const hasActionVerb = actionVerbs.some(pattern => pattern.test(text));
  
  if (hasActionVerb) {
    // Verifica se a ação está nas capacidades permitidas
    const canActions = capabilities.can || [];
    const cannotActions = capabilities.cannot || [];
    
    // Se menciona algo que está explicitamente em "cannot", é erro
    const mentionsCannot = cannotActions.some(action => {
      const actionWords = action.split('_');
      return actionWords.some(word => textLower.includes(word));
    });
    
    if (mentionsCannot) {
      errors.push('CDR_ACTION_NOT_ALLOWED');
    } else {
      // Verifica se a ação mencionada está em "can"
      // Se não está nem em can nem em cannot, pode ser uma ação não mapeada
      // Por segurança, consideramos como erro se não está explicitamente em "can"
      const mentionsCan = canActions.some(action => {
        const actionWords = action.split('_');
        return actionWords.some(word => textLower.includes(word));
      });
      
      // Se não menciona nenhuma capacidade conhecida, pode ser ação não permitida
      if (!mentionsCan && hasActionVerb) {
        // Verifica padrões específicos que sempre são proibidos
        const prohibitedPatterns = [
          /\b(?:vou|irei|vamos)\s+(?:abrir|solicitar|verificar|analisar|encaminhar)\s+(?:chamado|ticket|pedido|solicitação)\s+(?:em|no|para)\s+(?:sistema|sistemas|externo|externos)/i,
          /\b(?:vou|irei|vamos)\s+(?:contatar|ligar|chamar|falar)\s+(?:com|ao|a)\s+(?:atendente|humano|pessoa|equipe|setor)/i,
        ];
        
        if (prohibitedPatterns.some(pattern => pattern.test(text))) {
          errors.push('CDR_ACTION_NOT_ALLOWED');
        }
      }
    }
  }

  return errors;
}

/**
 * R2 - Detecta promessas de futuro
 * @param {string} text - Texto da resposta
 * @returns {Array<string>} Array de erros encontrados
 */
function checkR2_FuturePromises(text) {
  const errors = [];
  const textLower = text.toLowerCase();
  
  const futurePromisePatterns = [
    /\b(?:em breve|assim que possível|o mais breve possível|logo|logo mais|daqui a pouco|em alguns instantes|em alguns momentos)\b/i,
    /\b(?:iremos|vamos|vou)\s+(?:resolver|resolver isso|resolver isso para você|fazer isso|realizar isso|concluir isso)\b/i,
    /\b(?:retornarei|retornaremos|voltarei|voltaremos|responderei|responderemos)\s+(?:em breve|assim que|quando|logo que)\b/i,
    /\b(?:será|serão)\s+(?:feito|feita|feitas|resolvido|resolvida|resolvidas|processado|processada|processadas)\s+(?:em breve|assim que possível|logo)\b/i,
  ];

  const hasFuturePromise = futurePromisePatterns.some(pattern => pattern.test(text));
  
  if (hasFuturePromise) {
    errors.push('CDR_FUTURE_PROMISE');
  }

  return errors;
}

/**
 * R3 - Detecta simulação de humano ou setor
 * @param {string} text - Texto da resposta
 * @param {Object} capabilities - Objeto de capacidades
 * @returns {Array<string>} Array de erros encontrados
 */
function checkR3_FakeHandoff(text, capabilities) {
  const errors = [];
  const textLower = text.toLowerCase();
  
  // Verifica se há capacidade explícita de handoff humano
  const hasHumanHandoff = capabilities.can && (
    capabilities.can.includes('transferir_humano') ||
    capabilities.can.includes('criar_tickets')
  );
  
  // Padrões que indicam simulação de humano/setor
  const humanSimulationPatterns = [
    /\b(?:atendente|atendentes|pessoa|pessoas|humano|humanos|equipe|equipes|setor|setores|departamento|departamentos)\s+(?:já|está|estão|foi|foram|será|serão)\s+(?:resolvendo|analisando|verificando|processando|atendendo)/i,
    /\b(?:nossa|nosso)\s+(?:atendente|atendentes|equipe|equipes|setor|setores|departamento|departamentos)\s+(?:já|está|estão|foi|foram|será|serão)\b/i,
    /\b(?:transferi|transfiri|encaminhei|encaminhamos)\s+(?:para|ao|a)\s+(?:atendente|atendentes|equipe|equipes|setor|setores|departamento|departamentos)\s+(?:e|que)\s+(?:já|está|estão|foi|foram|será|serão)\b/i,
  ];
  
  const hasHumanSimulation = humanSimulationPatterns.some(pattern => pattern.test(text));
  
  if (hasHumanSimulation && !hasHumanHandoff) {
    errors.push('CDR_FAKE_HANDOFF');
  } else if (hasHumanSimulation) {
    // Mesmo com capacidade de handoff, verifica se não está simulando ação já feita
    const fakeActionPatterns = [
      /\b(?:atendente|equipe|setor)\s+(?:já|está|estão)\s+(?:resolvendo|analisando|verificando|processando)\b/i,
    ];
    
    if (fakeActionPatterns.some(pattern => pattern.test(text))) {
      errors.push('CDR_FAKE_HANDOFF');
    }
  }

  return errors;
}

/**
 * R4 - Detecta estados operacionais falsos
 * @param {string} text - Texto da resposta
 * @returns {Array<string>} Array de erros encontrados
 */
function checkR4_FakeState(text) {
  const errors = [];
  const textLower = text.toLowerCase();
  
  const fakeStatePatterns = [
    /\b(?:está|estão|foi|foram)\s+(?:em análise|em andamento|em processamento|sendo analisado|sendo analisada|sendo analisadas|sendo processado|sendo processada|sendo processadas|sendo resolvido|sendo resolvida|sendo resolvidas)\b/i,
    /\b(?:em análise|em andamento|em processamento)\s+(?:do|da|das|do seu|da sua|das suas)\s+(?:pedido|pedidos|solicitação|solicitações|chamado|chamados|ticket|tickets)\b/i,
    /\b(?:seu|sua|seus|suas)\s+(?:pedido|pedidos|solicitação|solicitações|chamado|chamados|ticket|tickets)\s+(?:está|estão|foi|foram)\s+(?:em análise|em andamento|em processamento)\b/i,
  ];
  
  const hasFakeState = fakeStatePatterns.some(pattern => pattern.test(text));
  
  if (hasFakeState) {
    errors.push('CDR_FAKE_STATE');
  }

  return errors;
}

/**
 * R5 - Detecta negativa inválida
 * Quando o bot nega algo mas promete alternativa inexistente ou fala de roadmap/futuro
 * @param {string} text - Texto da resposta
 * @param {Object} capabilities - Objeto de capacidades
 * @returns {Array<string>} Array de erros encontrados
 */
function checkR5_InvalidDenial(text, capabilities) {
  const errors = [];
  const textLower = text.toLowerCase();
  
  // Padrões de negação
  const denialPatterns = [
    /\b(?:não|não posso|não consigo|não tenho|não disponível|não implementado|não disponho)\s+(?:de|da|do|das|dos)\b/i,
    /\b(?:infelizmente|desculpe|desculpa)\s+(?:não|não posso|não consigo|não tenho)\b/i,
  ];
  
  const hasDenial = denialPatterns.some(pattern => pattern.test(text));
  
  if (hasDenial) {
    // Verifica se após a negação há promessa de alternativa ou futuro
    const invalidAfterDenialPatterns = [
      /\b(?:mas|porém|contudo|entretanto|no entanto)\s+(?:em breve|assim que possível|logo|iremos|vamos|será|serão)\b/i,
      /\b(?:mas|porém|contudo|entretanto|no entanto)\s+(?:você pode|você poderá|será possível|estará disponível)\s+(?:em breve|assim que possível|logo)\b/i,
      /\b(?:mas|porém|contudo|entretanto|no entanto)\s+(?:estamos|estou)\s+(?:trabalhando|desenvolvendo|planejando|preparando)\s+(?:para|isso|essa funcionalidade)\b/i,
    ];
    
    const hasInvalidAfterDenial = invalidAfterDenialPatterns.some(pattern => pattern.test(text));
    
    if (hasInvalidAfterDenial) {
      errors.push('CDR_INVALID_DENIAL');
    }
  }

  return errors;
}

/**
 * Resposta segura padrão quando resposta é bloqueada
 * @returns {string} Mensagem segura
 */
function getSafeResponse() {
  return 'No momento, não tenho essa funcionalidade.\nPosso ajudar com o que está disponível.';
}

/**
 * Valida resposta textual final antes de ser enviada ao usuário
 * @param {string} responseText - Texto da resposta a validar
 * @param {Object} [capabilities] - Objeto de capacidades (opcional, carrega automaticamente se não fornecido)
 * @returns {Object} { status: "ok"|"warn"|"error", code?: string, message?: string }
 */
function validateCDR(responseText, capabilities = null) {
  // Valida entrada
  if (!responseText || typeof responseText !== 'string' || responseText.trim() === '') {
    return {
      status: 'error',
      code: 'CDR_INVALID_INPUT',
      message: 'Resposta deve ser uma string não vazia'
    };
  }

  // Carrega capacidades se não fornecidas
  if (!capabilities) {
    capabilities = loadCapabilities();
  }

  // Se não conseguiu carregar capacidades, retorna erro
  if (!capabilities || (!capabilities.can && !capabilities.cannot)) {
    return {
      status: 'error',
      code: 'CDR_CAPABILITIES_NOT_LOADED',
      message: 'Não foi possível carregar arquivo de capacidades'
    };
  }

  // Executa todas as regras
  const errors = [];
  
  errors.push(...checkR1_ActionsNotAllowed(responseText, capabilities));
  errors.push(...checkR2_FuturePromises(responseText));
  errors.push(...checkR3_FakeHandoff(responseText, capabilities));
  errors.push(...checkR4_FakeState(responseText));
  errors.push(...checkR5_InvalidDenial(responseText, capabilities));

  // Remove duplicatas
  const uniqueErrors = [...new Set(errors)];

  // Determina status baseado no ambiente e erros encontrados
  const isProd = isProductionOrQa();
  
  if (uniqueErrors.length > 0) {
    if (isProd) {
      // Produção/QA: erro bloqueia
      return {
        status: 'error',
        code: uniqueErrors[0], // Retorna o primeiro erro encontrado
        message: `Resposta viola regras CDR: ${uniqueErrors.join(', ')}`
      };
    } else {
      // Desenvolvimento: warning apenas
      return {
        status: 'warn',
        code: uniqueErrors[0],
        message: `Resposta viola regras CDR: ${uniqueErrors.join(', ')}`
      };
    }
  }

  // Sem violações
  return {
    status: 'ok'
  };
}

/**
 * Gera log estruturado de violação CDR
 * @param {Object} validationResult - Resultado da validação
 * @param {string} responseText - Texto da resposta que violou
 * @returns {Object} Log estruturado
 */
function generateViolationLog(validationResult, responseText) {
  return {
    type: 'CDR_VIOLATION',
    code: validationResult.code || 'UNKNOWN',
    response: responseText.substring(0, 500), // Limita tamanho
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  };
}

/**
 * Limpa cache de capacidades (útil para testes)
 */
function clearCache() {
  capabilitiesCache = null;
}

module.exports = {
  validateCDR,
  getSafeResponse,
  generateViolationLog,
  clearCache,
  loadCapabilities
};

