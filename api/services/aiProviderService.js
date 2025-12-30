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
        const model = config.get('ai.openai.model', 'gpt-3.5-turbo');
        logger.debug('🤖 OpenAI: Iniciando geração', {
          model,
          promptLength: prompt.length,
          hasApiKey: !!apiKey,
          apiKeyPrefix: apiKey ? apiKey.substring(0, 7) + '...' : 'não configurado',
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
          logger.debug('📤 OpenAI: Enviando requisição via fetch', { url, model });
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 1000,
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
        logger.debug('📤 OpenAI: Enviando requisição via SDK', { model });
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
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
      // Nota: Você precisa instalar o pacote @anthropic-ai/sdk: npm install @anthropic-ai/sdk
      // const Anthropic = require('@anthropic-ai/sdk');
      // const anthropic = new Anthropic({ apiKey });
      // const message = await anthropic.messages.create({
      //   model: config.get('ai.anthropic.model', 'claude-3-sonnet-20240229'),
      //   max_tokens: 1024,
      //   messages: [{ role: 'user', content: prompt }],
      // });
      // return { text: message.content[0].text };

      // Por enquanto, retorna uma resposta simulada
      // TODO: Implementar chamada real à API Anthropic
      return {
        text: `[Anthropic] Resposta para: ${prompt.substring(0, 50)}...`,
      };
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

