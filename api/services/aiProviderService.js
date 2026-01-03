/**
 * Serviço para gerenciar providers de IA.
 * 
 * Responsabilidades:
 * - Registrar providers de IA (OpenAI, Anthropic, etc.)
 * - Configurar providers por tenant
 * - Fornecer interface para gerar respostas de IA
 */

const { registerAiProvider, setTenantAiConfig, getAiProviderForTenant } = require('../../engine/aiProviderManager');
const config = require('../utils/config');

// Logger simples para o backend (usa console com prefixo)
const logger = {
  debug: (msg, data) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG] ${msg}`, data || '');
    }
  },
  info: (msg, data) => {
    console.log(`[INFO] ${msg}`, data || '');
  },
  warn: (msg, data) => {
    console.warn(`[WARN] ${msg}`, data || '');
  },
  error: (msg, error) => {
    const errorData = error instanceof Error 
      ? { message: error.message, stack: error.stack }
      : error;
    console.error(`[ERROR] ${msg}`, errorData || '');
  },
};

/**
 * Determina qual parâmetro usar para limitar tokens baseado no modelo
 * Modelos mais recentes (gpt-5.x) usam max_completion_tokens
 * Modelos antigos usam max_tokens
 * 
 * @param {string} model - Nome do modelo
 * @param {number} promptLength - Tamanho do prompt em caracteres (opcional, para ajustar limite)
 * @returns {Object} Parâmetros de limite de tokens
 */
function getTokenLimitParam(model, promptLength = 0) {
  // Modelos que requerem max_completion_tokens
  const requiresMaxCompletionTokens = /^gpt-5\./;
  
  // Ajusta o limite baseado no tamanho do prompt
  // Para prompts grandes (>5000 chars), aumenta o limite para 4000 tokens
  // Para prompts médios (>2000 chars), usa 2000 tokens
  // Caso contrário, usa 1000 tokens padrão
  let tokenLimit = 1000;
  if (promptLength > 5000) {
    tokenLimit = 4000;
  } else if (promptLength > 2000) {
    tokenLimit = 2000;
  }
  
  if (requiresMaxCompletionTokens.test(model)) {
    return { max_completion_tokens: tokenLimit };
  }
  
  return { max_tokens: tokenLimit };
}

/**
 * Provider de IA usando OpenAI
 */
function createOpenAIProvider() {
  const apiKey = config.get('ai.openai.apiKey');
  if (!apiKey) {
    throw new Error('OpenAI API key não configurada');
  }

  return {
    async generate(prompt, context) {
      try {
        const model = config.get('ai.openai.model', 'gpt-5.2');
        const tokenParams = getTokenLimitParam(model, prompt.length);
        
        logger.debug('🤖 OpenAI: Iniciando geração', {
          model,
          promptLength: prompt.length,
          hasApiKey: !!apiKey,
          apiKeyPrefix: apiKey ? apiKey.substring(0, 7) + '...' : 'não configurado',
          tokenParams,
        });

        // Tenta usar o SDK da OpenAI se disponível
        let OpenAI;
        try {
          OpenAI = require('openai');
          logger.debug('✅ SDK OpenAI encontrado, usando SDK');
        } catch (requireError) {
          // SDK não instalado: usa fetch direto
          logger.debug('⚠️ SDK OpenAI não encontrado, usando fetch direto', {
            error: requireError.message,
          });
          
          const url = 'https://api.openai.com/v1/chat/completions';
          logger.debug('📤 OpenAI: Enviando requisição via fetch', { url, model, tokenParams });
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }],
              ...tokenParams,
            }),
          });

          logger.debug('📥 OpenAI: Resposta recebida', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message || `OpenAI API error: ${response.status} ${response.statusText}`;
            logger.error('❌ OpenAI: Erro na API', {
              status: response.status,
              statusText: response.statusText,
              errorData,
              errorMessage,
            });
            throw new Error(errorMessage);
          }

          const data = await response.json();
          logger.debug('✅ OpenAI: Resposta processada', {
            hasChoices: !!data.choices,
            choicesLength: data.choices?.length,
            hasUsage: !!data.usage,
            textLength: data.choices[0]?.message?.content?.length,
          });
          
          return {
            text: data.choices[0]?.message?.content || '[Resposta vazia da OpenAI]',
            usage: data.usage || null,
          };
        }

        // SDK disponível: usa SDK
        logger.debug('📤 OpenAI: Enviando requisição via SDK', { model, tokenParams });
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          ...tokenParams,
        });

        logger.debug('✅ OpenAI: Resposta recebida via SDK', {
          hasChoices: !!completion.choices,
          choicesLength: completion.choices?.length,
          hasUsage: !!completion.usage,
          textLength: completion.choices[0]?.message?.content?.length,
        });

        return {
          text: completion.choices[0]?.message?.content || '[Resposta vazia da OpenAI]',
          usage: completion.usage || null,
        };
      } catch (error) {
        logger.error('❌ OpenAI: Erro ao gerar resposta', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: error.code,
          status: error.status,
          response: error.response,
        });
        throw error;
      }
    },
  };
}

/**
 * Provider de IA usando Anthropic (Claude)
 */
function createAnthropicProvider() {
  const apiKey = config.get('ai.anthropic.apiKey');
  if (!apiKey) {
    throw new Error('Anthropic API key não configurada');
  }

  return {
    async generate(prompt, context) {
      try {
        const model = config.get('ai.anthropic.model', 'claude-3-sonnet-20240229');
        logger.debug('🤖 Anthropic: Iniciando geração', {
          model,
          promptLength: prompt.length,
          hasApiKey: !!apiKey,
          apiKeyPrefix: apiKey ? apiKey.substring(0, 7) + '...' : 'não configurado',
        });

        // Tenta usar o SDK da Anthropic se disponível
        let Anthropic;
        try {
          Anthropic = require('@anthropic-ai/sdk');
          logger.debug('✅ SDK Anthropic encontrado, usando SDK');
        } catch (requireError) {
          // SDK não instalado: usa fetch direto
          logger.debug('⚠️ SDK Anthropic não encontrado, usando fetch direto', {
            error: requireError.message,
          });
          
          const url = 'https://api.anthropic.com/v1/messages';
          logger.debug('📤 Anthropic: Enviando requisição via fetch', { url, model });
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: model,
              max_tokens: 1000,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          logger.debug('📥 Anthropic: Resposta recebida', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message || `Anthropic API error: ${response.status} ${response.statusText}`;
            logger.error('❌ Anthropic: Erro na API', {
              status: response.status,
              statusText: response.statusText,
              errorData,
              errorMessage,
            });
            throw new Error(errorMessage);
          }

          const data = await response.json();
          logger.debug('✅ Anthropic: Resposta processada', {
            hasContent: !!data.content,
            contentLength: data.content?.length,
            textLength: data.content?.[0]?.text?.length,
          });
          
          return {
            text: data.content?.[0]?.text || '[Resposta vazia da Anthropic]',
            usage: data.usage || null,
          };
        }

        // SDK disponível: usa SDK
        logger.debug('📤 Anthropic: Enviando requisição via SDK', { model });
        const anthropic = new Anthropic({ apiKey });
        const message = await anthropic.messages.create({
          model: model,
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        });

        logger.debug('✅ Anthropic: Resposta recebida via SDK', {
          hasContent: !!message.content,
          contentLength: message.content?.length,
          textLength: message.content?.[0]?.text?.length,
          hasUsage: !!message.usage,
        });

        return {
          text: message.content[0]?.text || '[Resposta vazia da Anthropic]',
          usage: message.usage || null,
        };
      } catch (error) {
        logger.error('❌ Anthropic: Erro ao gerar resposta', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: error.code,
          status: error.status,
          response: error.response,
        });
        throw error;
      }
    },
  };
}

/**
 * Provider de fallback (respostas estáticas)
 */
function createFallbackProvider() {
  return {
    async generate(prompt, context) {
      return {
        text: '[IA não disponível] Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.',
      };
    },
  };
}

/**
 * Inicializa os providers de IA baseado na configuração
 */
function initializeAiProviders() {
  try {
    // Registra provider de fallback
    registerAiProvider('fallback', createFallbackProvider());

    // Tenta registrar OpenAI se configurado
    try {
      const openaiProvider = createOpenAIProvider();
      registerAiProvider('openai', openaiProvider);
      logger.info('✅ Provider OpenAI registrado');
    } catch (err) {
      logger.warn('⚠️  OpenAI não configurado', { message: err.message });
    }

    // Tenta registrar Anthropic se configurado
    try {
      const anthropicProvider = createAnthropicProvider();
      registerAiProvider('anthropic', anthropicProvider);
      logger.info('✅ Provider Anthropic registrado');
    } catch (err) {
      logger.warn('⚠️  Anthropic não configurado', { message: err.message });
    }

    // Configura providers por tenant
    const defaultTenantId = config.get('api.defaultTenantId', 'tenant-demo');
    const aiConfig = config.get('ai', {});
    const tenantConfig = aiConfig.tenants || {};

    // Configuração padrão para todos os tenants
    const defaultProvider = aiConfig.defaultProvider || 'fallback';
    const defaultFallback = aiConfig.defaultFallback || 'fallback';

    // Configura tenant padrão
    setTenantAiConfig(defaultTenantId, {
      primary: defaultProvider,
      fallback: defaultFallback,
    });

    // Configura tenants específicos
    for (const [tenantId, tenantAiConfig] of Object.entries(tenantConfig)) {
      setTenantAiConfig(tenantId, {
        primary: tenantAiConfig.primary || defaultProvider,
        fallback: tenantAiConfig.fallback || defaultFallback,
      });
      logger.info(`✅ Configurado provider de IA para tenant: ${tenantId}`);
    }

    logger.info(`✅ Providers de IA inicializados. Provider padrão: ${defaultProvider}`);
  } catch (err) {
    logger.error('❌ Erro ao inicializar providers de IA', err);
  }
}

/**
 * Gera resposta de IA para um prompt
 * 
 * @param {string} prompt - Prompt para a IA
 * @param {string} tenantId - ID do tenant
 * @param {Object} context - Contexto adicional (sessionId, flowId, nodeId)
 * @returns {Promise<{text: string, usage?: Object}>}
 */
async function generateAiResponse(prompt, tenantId, context = {}) {
  logger.debug('🔍 generateAiResponse: Obtendo provider', { tenantId });
  
  const provider = getAiProviderForTenant(tenantId);
  if (!provider) {
    const errorMsg = `Nenhum provider de IA configurado para tenant: ${tenantId}`;
    logger.error('❌ generateAiResponse', new Error(errorMsg));
    throw new Error(errorMsg);
  }

  logger.debug('✅ generateAiResponse: Provider obtido, gerando resposta', {
    tenantId,
    promptLength: prompt.length,
    hasProvider: !!provider,
    hasGenerate: typeof provider.generate === 'function',
  });

  try {
    const result = await provider.generate(prompt, {
      sessionId: context.sessionId,
      flowId: context.flowId,
      nodeId: context.nodeId,
      variables: context.variables || {},
    });
    
    logger.debug('✅ generateAiResponse: Resposta gerada', {
      hasText: !!result?.text,
      textLength: result?.text?.length,
      hasUsage: !!result?.usage,
    });
    
    return result;
  } catch (error) {
    logger.error('❌ generateAiResponse: Erro ao gerar', {
      tenantId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  initializeAiProviders,
  generateAiResponse,
  createOpenAIProvider,
  createAnthropicProvider,
  createFallbackProvider,
};

