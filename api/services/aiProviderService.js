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
const logger = require('../utils/logger');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}
function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }
  if (message !== null && message !== undefined) return safeToString(message, fallback);
  return safeToString(err, fallback);
}

/**
 * Extrai um "caller hint" do stack para debug (dev only).
 * Ajuda a identificar qual serviço/arquivo originou a chamada de IA.
 *
 * @returns {string|null}
 */
function getCallerHint() {
  try {
    const stack = new Error().stack || '';
    const lines = String(stack).split('\n').map((l) => l.trim());
    // Remove as 2 primeiras linhas (Error + este helper) e procura o primeiro frame fora deste arquivo.
    for (const line of lines.slice(2)) {
      if (!line) continue;
      // Evita frames do próprio aiProviderService
      if (line.includes('api/services/aiProviderService.js')) continue;
      if (line.includes('aiProviderService.js')) continue;
      return line;
    }
    return lines[2] || null;
  } catch {
    return null;
  }
}

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
  return {
    async generate(prompt, context) {
      try {
        // Resolve API key EXCLUSIVAMENTE por tenant (DB, criptografada).
        const tenantId = context?.tenantId || null;
        if (!tenantId) {
          throw new Error('OpenAI: tenantId é obrigatório para resolver credenciais por tenant');
        }
        let apiKey = null;
        try {
          // eslint-disable-next-line global-require
          const { getDecryptedAPIKey } = require('./tenantAIService');
          apiKey = await getDecryptedAPIKey(safeToString(tenantId), 'openai');
        } catch (e) {
          logger.warn('⚠️ OpenAI: falha ao obter API key do tenant (DB)', { tenantId, error: safeErrorMessage(e) });
        }

        if (!apiKey) {
          throw new Error(`OpenAI API key não configurada para o tenant: ${tenantId}`);
        }

        const model = config.get('ai.openai.model', 'gpt-5.2');
        const tokenParams = getTokenLimitParam(model, prompt.length);
        
        logger.debug('🤖 OpenAI: Iniciando geração', {
          // Observabilidade do "porquê" (origem) da chamada:
          source: context?.source || null,
          executionId: context?.executionId || null,
          endpoint: context?.endpoint || null,
          requestId: context?.requestId || null,
          caller: context?.caller || null,
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
            error: safeErrorMessage(requireError),
          });
          
          const url = 'https://api.openai.com/v1/chat/completions';
          logger.debug('📤 OpenAI: Enviando requisição via fetch', { url, model, tokenParams });
          
          const response = await fetch(url, {
            method: 'POST',
            signal: context?.signal || undefined,
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
            const e = new Error(errorMessage);
            e.status = response.status;
            e.code = errorData?.error?.code || null;
            e.type = errorData?.error?.type || null;
            try {
              // best-effort: expõe headers para camadas superiores (retry-after etc.)
              e.headers = Object.fromEntries(response.headers.entries());
            } catch (_) {
              e.headers = null;
            }
            throw e;
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
        const completion = await openai.chat.completions.create(
          {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            ...tokenParams,
          },
          context?.signal ? { signal: context.signal } : undefined,
        );

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
          message: safeErrorMessage(error),
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
  return {
    async generate(prompt, context) {
      try {
        const tenantId = context?.tenantId || null;
        if (!tenantId) {
          throw new Error('Anthropic: tenantId é obrigatório para resolver credenciais por tenant');
        }
        let apiKey = null;
        try {
          // eslint-disable-next-line global-require
          const { getDecryptedAPIKey } = require('./tenantAIService');
          apiKey = await getDecryptedAPIKey(safeToString(tenantId), 'anthropic');
        } catch (e) {
          logger.warn('⚠️ Anthropic: falha ao obter API key do tenant (DB)', { tenantId, error: safeErrorMessage(e) });
        }

        if (!apiKey) {
          throw new Error(`Anthropic API key não configurada para o tenant: ${tenantId}`);
        }

        const model = config.get('ai.anthropic.model', 'claude-3-sonnet-20240229');
        logger.debug('🤖 Anthropic: Iniciando geração', {
          // Observabilidade do "porquê" (origem) da chamada:
          source: context?.source || null,
          executionId: context?.executionId || null,
          endpoint: context?.endpoint || null,
          requestId: context?.requestId || null,
          caller: context?.caller || null,
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
            error: safeErrorMessage(requireError),
          });
          
          const url = 'https://api.anthropic.com/v1/messages';
          logger.debug('📤 Anthropic: Enviando requisição via fetch', { url, model });
          
          const response = await fetch(url, {
            method: 'POST',
            signal: context?.signal || undefined,
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
            const e = new Error(errorMessage);
            e.status = response.status;
            e.code = errorData?.error?.type || errorData?.error?.code || null;
            e.type = errorData?.error?.type || null;
            try {
              e.headers = Object.fromEntries(response.headers.entries());
            } catch (_) {
              e.headers = null;
            }
            throw e;
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
        const message = await anthropic.messages.create(
          {
            model: model,
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }],
          },
          context?.signal ? { signal: context.signal } : undefined,
        );

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
          message: safeErrorMessage(error),
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
 * Inicializa os providers de IA baseado na configuração
 * Carrega configurações do banco de dados (PostgreSQL) ou do config.json como fallback
 */
async function initializeAiProviders() {
  try {
    // Tenta registrar OpenAI se configurado
    try {
      const openaiProvider = createOpenAIProvider();
      registerAiProvider('openai', openaiProvider);
      logger.info('✅ Provider OpenAI registrado');
    } catch (err) {
      logger.warn('⚠️  OpenAI não configurado', { message: safeErrorMessage(err) });
    }

    // Tenta registrar Anthropic se configurado
    try {
      const anthropicProvider = createAnthropicProvider();
      registerAiProvider('anthropic', anthropicProvider);
      logger.info('✅ Provider Anthropic registrado');
    } catch (err) {
      logger.warn('⚠️  Anthropic não configurado', { message: safeErrorMessage(err) });
    }

    // Tenta carregar configurações do banco de dados
    let tenantsLoaded = 0;
    try {
      const { listAllTenants } = require('./superAdminService');
      const { getAIConfig } = require('./tenantAIService');
      
      // Lista todos os tenants do banco
      const tenants = await listAllTenants();
      
      // Para cada tenant, carrega a configuração de IA
      for (const tenant of tenants) {
        try {
          const tenantId = tenant.tenant_key || tenant.id;
          const aiConfig = await getAIConfig(tenantId);
          
          if (aiConfig && aiConfig.configured && aiConfig.primary) {
            setTenantAiConfig(tenantId, {
              primary: aiConfig.primary,
              secondary: aiConfig.secondary,
            });
            logger.info(`✅ Configurado provider de IA para tenant: ${tenantId} (primary: ${aiConfig.primary})`);
            tenantsLoaded++;
          }
        } catch (err) {
          logger.debug(`Não foi possível carregar configuração de IA para tenant ${tenant.tenant_key || tenant.id}`, { error: safeErrorMessage(err) });
        }
      }
      
      logger.info(`✅ Providers de IA inicializados. Tenants configurados do banco: ${tenantsLoaded}`);
    } catch (err) {
      logger.warn('⚠️  Não foi possível carregar configurações do banco, usando config.json como fallback', { error: safeErrorMessage(err) });
      
      // Fallback: carrega do config.json (para migração gradual)
      const aiConfig = config.get('ai', {});
      const tenantConfig = aiConfig.tenants || {};

      // Configura tenants específicos (apenas configurações explícitas)
      for (const [tenantId, tenantAiConfig] of Object.entries(tenantConfig)) {
        if (!tenantAiConfig.primary) {
          logger.warn(`⚠️  Tenant ${tenantId} não tem provider primário configurado, ignorando`);
          continue;
        }
        
        setTenantAiConfig(tenantId, {
          primary: tenantAiConfig.primary,
          secondary: tenantAiConfig.secondary,
        });
        logger.info(`✅ Configurado provider de IA para tenant: ${tenantId} (primary: ${tenantAiConfig.primary})`);
        tenantsLoaded++;
      }
      
      logger.info(`✅ Providers de IA inicializados. Tenants configurados do config.json: ${tenantsLoaded}`);
    }
    
    // Configuração automática obrigatória para o tenant "system"
    try {
      const { getAiProviderForTenant, setTenantAiConfig, isProviderRegistered } = require('../../engine/aiProviderManager');
      const systemProvider = getAiProviderForTenant('system');
      if (!systemProvider) {
        // Configura com o primeiro provider disponível (prioriza openai, depois anthropic)
        const preferredProviders = ['openai', 'anthropic'];
        let configured = false;
        
        for (const providerId of preferredProviders) {
          if (isProviderRegistered(providerId)) {
            setTenantAiConfig('system', { primary: providerId });
            logger.info(`✅ Configurado provider de IA para tenant "system": ${providerId}`);
            configured = true;
            break;
          }
        }
        
        if (!configured) {
          logger.warn('⚠️  Tenant "system" não pôde ser configurado - nenhum provider de IA disponível');
        }
      } else {
        logger.debug('ℹ️  Tenant "system" já possui provider configurado');
      }
    } catch (err) {
      logger.warn('⚠️  Erro ao configurar tenant "system"', { error: safeErrorMessage(err) });
    }
  } catch (err) {
    logger.error('❌ Erro ao inicializar providers de IA', err);
  }
}

/**
 * Garante que a configuração de IA do tenant esteja carregada no runtime (aiProviderManager).
 * Isso evita inconsistência entre:
 * - status do tenant (config no banco) e
 * - execução real (getAiProviderForTenant usa cache em memória).
 *
 * Observação: esta função NÃO registra providers globais (openai/anthropic).
 * Ela apenas sincroniza a configuração do tenant (primary/secondary) do DB → memória.
 *
 * @param {string} tenantId
 * @returns {Promise<{loaded: boolean, reason?: string, primary?: string, secondary?: string}>}
 */
async function ensureTenantAiConfigLoaded(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    return { loaded: false, reason: 'tenantId inválido' };
  }

  try {
    const { getAIConfig } = require('./tenantAIService');
    const aiConfig = await getAIConfig(tenantId);

    // Se tenant não existe, não carrega
    if (aiConfig === null) {
      return { loaded: false, reason: 'tenant não encontrado' };
    }

    // Se não está configurado, não carrega
    if (!aiConfig?.configured || !aiConfig?.primary) {
      return { loaded: false, reason: 'tenant sem IA configurada' };
    }

    setTenantAiConfig(tenantId, {
      primary: aiConfig.primary,
      secondary: aiConfig.secondary,
    });

    logger.info('✅ ensureTenantAiConfigLoaded: Config carregada no runtime', {
      tenantId,
      primary: aiConfig.primary,
      secondary: aiConfig.secondary,
    });

    return { loaded: true, primary: aiConfig.primary, secondary: aiConfig.secondary };
  } catch (err) {
    logger.warn('⚠️ ensureTenantAiConfigLoaded: Falha ao carregar config do tenant', {
      tenantId,
      error: safeErrorMessage(err),
    });
    return { loaded: false, reason: 'erro ao carregar config do banco' };
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
  
  let provider = getAiProviderForTenant(tenantId);
  if (!provider) {
    // Tenta hidratar config do tenant do DB → memória (caso tenha sido configurado após boot
    // ou caso a inicialização não tenha carregado esse tenant por algum motivo).
    await ensureTenantAiConfigLoaded(tenantId);
    provider = getAiProviderForTenant(tenantId);
  }
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
    // Meta de observabilidade propagada para o provider (vai aparecer no log "Iniciando geração").
    // - `caller` é inferido por stack (dev) quando não vem explicitamente.
    const caller = (typeof context?.caller === 'string' && context.caller.trim())
      ? context.caller.trim()
      : (process.env.NODE_ENV !== 'production' ? getCallerHint() : null);

    const result = await provider.generate(prompt, {
      tenantId,
      sessionId: context.sessionId,
      flowId: context.flowId,
      nodeId: context.nodeId,
      variables: context.variables || {},
      // Cancelamento (best-effort): permite interromper chamadas ao provider
      signal: context.signal || null,
      // Extras (best-effort): ajudam a diagnosticar volume e origem.
      source: context.source || null,
      executionId: context.executionId || null,
      endpoint: context.endpoint || null,
      requestId: context.requestId || null,
      caller,
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
      error: safeErrorMessage(error),
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  initializeAiProviders,
  ensureTenantAiConfigLoaded,
  generateAiResponse,
  createOpenAIProvider,
  createAnthropicProvider,
};

