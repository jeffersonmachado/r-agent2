/**
 * Serviço para gerenciar providers de IA.
 * 
 * Responsabilidades:
 * - Registrar providers de IA (OpenAI, Anthropic, etc.)
 * - Configurar providers por tenant
 * - Fornecer interface para gerar respostas de IA
 */

const { registerAiProvider, setTenantAiConfig, getAiProviderForTenant } = require('./aiProviderManager.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const aiControlPlaneStatus = require('./aiControlPlaneStatus');

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

/**
 * ORÇAMENTO DE SAÍDA ADAPTATIVO (max_tokens) — fonte ÚNICA para todos os providers.
 *
 * DEFEITO REAL MEDIDO (2026-10-07): DeepSeek e Kimi enviavam `max_tokens: 1000` FIXO (hardcoded)
 * enquanto só a OpenAI usava esta função. Com o prompt REAL do CODER (~65 KB), modelos que emitem
 * reasoning consumiam o orçamento INTEIRO em `reasoning_tokens` e devolviam `content` VAZIO — o
 * Router repetia o MESMO modelo até esgotar `max_iterations` e toda EngineeringTask terminava RED.
 *
 * Regras (determinísticas e testadas):
 *   - tiers por TAMANHO do prompt (a saída cresce com a entrada: patch/diff acompanham o contexto);
 *   - RESERVA de reasoning para modelos que emitem `reasoning_tokens` ANTES do conteúdo, para que
 *     o orçamento cubra raciocínio + resposta (nunca "só raciocínio");
 *   - teto absoluto (MAX): custo nunca cresce sem limite.
 */
const OUTPUT_TOKEN_BUDGET = Object.freeze({
  BASE: 1000,               // prompt pequeno (<= 2000 chars)
  MEDIUM_PROMPT: 2000,      // > 2000 chars
  LARGE_PROMPT: 4000,       // > 5000 chars
  ENGINEERING_PROMPT: 8000, // > 20000 chars (contrato de tarefa + arquivos de contexto)
  MAX: 10000,               // teto absoluto: tier + reserva de reasoning nunca passa daqui
});

/**
 * Reserva de reasoning somada ao tier quando o modelo emite tokens de raciocínio antes do
 * conteúdo. A lista é EXPLÍCITA e versionada (mesmo critério de `modelCapabilities.js`: um modelo
 * não listado não ganha reserva por adivinhação) e cobre os modelos OBSERVADOS consumindo o teto
 * inteiro em reasoning na medição de 2026-10-07 (deepseek-v4-pro, deepseek-flash, kimi-k2.6).
 */
const REASONING_TOKEN_RESERVE = 4000;
const REASONING_CAPABLE_MODEL_RE = /(deepseek-v4-pro|deepseek-flash|kimi-k2|kimi-k3|reasoner|thinking)/i;

/**
 * @param {string} model
 * @param {number} promptLength - tamanho do prompt em caracteres
 * @returns {number} orçamento de saída em tokens (limitado por OUTPUT_TOKEN_BUDGET.MAX)
 */
function resolveMaxOutputTokens(model, promptLength = 0) {
  const length = Number.isFinite(promptLength) ? promptLength : 0;
  let tokens = OUTPUT_TOKEN_BUDGET.BASE;
  if (length > 20000) tokens = OUTPUT_TOKEN_BUDGET.ENGINEERING_PROMPT;
  else if (length > 5000) tokens = OUTPUT_TOKEN_BUDGET.LARGE_PROMPT;
  else if (length > 2000) tokens = OUTPUT_TOKEN_BUDGET.MEDIUM_PROMPT;

  if (REASONING_CAPABLE_MODEL_RE.test(String(model || ''))) tokens += REASONING_TOKEN_RESERVE;
  return Math.min(tokens, OUTPUT_TOKEN_BUDGET.MAX);
}

/**
 * Códigos de falha de SAÍDA do provider. São REROUTEÁVEIS por construção:
 * `engineeringAiInvoker` embrulha qualquer erro de invocação como `PROVIDER_UNAVAILABLE`, e é
 * nesse código que o Router dispara `outcome: 'REROUTE'` (fallback/escalation para o próximo
 * candidato qualificado) em vez de repetir o mesmo modelo.
 */
const PROVIDER_OUTPUT_FAILURE_CODES = Object.freeze({
  EMPTY_RESPONSE: 'PROVIDER_EMPTY_RESPONSE',
  OUTPUT_TRUNCATED: 'PROVIDER_OUTPUT_TRUNCATED',
});

/** Normaliza `stop_reason` da Anthropic para o vocabulário de `finish_reason`. */
function anthropicFinishReason(payload) {
  const stop = payload?.stop_reason ?? null;
  return stop === 'max_tokens' ? 'length' : stop;
}

/**
 * Extrai o texto do provider e RECUSA saída inutilizável — nunca inventa texto.
 *
 * Antes: `content || '[Resposta vazia da X]'` convertia resposta vazia em TEXTO VÁLIDO; o CODER
 * falhava depois com `NO_JSON_FOUND` (classe NÃO rerouteável) e o Router repetia o MESMO modelo
 * até esgotar `max_iterations`. Agora a saída inutilizável sobe como erro de provider
 * classificado → invoker → `PROVIDER_UNAVAILABLE` → fallback/escalation.
 *
 * @throws {Error} `.code = PROVIDER_EMPTY_RESPONSE` (sem conteúdo — tipicamente reasoning
 *   consumindo todo o orçamento) ou `.code = PROVIDER_OUTPUT_TRUNCATED`
 *   (`finish_reason === 'length'` — resposta cortada pelo limite, portanto INCOMPLETA).
 */
function usableTextOrThrow({ label, model, text, finishReason = null, usage = null }) {
  const value = typeof text === 'string' ? text : '';
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null;
  if (value.trim() === '') {
    const err = new Error(
      `${label}: resposta SEM conteúdo utilizável (modelo=${model}; finish_reason=${finishReason || 'desconhecido'}`
      + `${reasoningTokens === null ? '' : `; reasoning_tokens=${reasoningTokens}`}) — orçamento de saída esgotado pelo modelo, nunca texto válido`,
    );
    err.code = PROVIDER_OUTPUT_FAILURE_CODES.EMPTY_RESPONSE;
    err.finishReason = finishReason;
    err.usage = usage;
    err.reasoningTokens = reasoningTokens;
    throw err;
  }
  if (finishReason === 'length') {
    const err = new Error(
      `${label}: resposta TRUNCADA pelo limite de tokens de saída (modelo=${model}; chars=${value.length}) — saída incompleta, nunca tratada como válida`,
    );
    err.code = PROVIDER_OUTPUT_FAILURE_CODES.OUTPUT_TRUNCATED;
    err.finishReason = finishReason;
    err.usage = usage;
    throw err;
  }
  return value;
}

function getTokenLimitParam(model, promptLength = 0) {
  // Modelos que requerem max_completion_tokens
  const requiresMaxCompletionTokens = /^gpt-5\./;
  
  // Ajusta o limite baseado no tamanho do prompt
  // Para prompts grandes (>5000 chars), aumenta o limite para 4000 tokens
  // Para prompts médios (>2000 chars), usa 2000 tokens
  // Caso contrário, usa 1000 tokens padrão
  // Orçamento ADAPTATIVO (fonte única, compartilhada com DeepSeek/Kimi/compatíveis): a tabela
  // fixa antiga (1000/2000/4000) não cobria reasoning tokens nem prompts reais de engenharia.
  const tokenLimit = resolveMaxOutputTokens(model, promptLength);
  
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
          // Provider sem credencial configurada é erro de configuração do
          // tenant (cliente), não falha interna: as rotas de geração mapeiam
          // AI_PROVIDER_NOT_CONFIGURED para 400 estruturado.
          throw Object.assign(
            new Error(`OpenAI API key não configurada para o tenant: ${tenantId}`),
            { code: 'AI_PROVIDER_NOT_CONFIGURED' },
          );
        }

        const model = context?.model || config.get('ai.openai.model', 'gpt-5.2');
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
          
          const openaiFinishReason = data.choices?.[0]?.finish_reason ?? null;
          return {
            text: usableTextOrThrow({
              label: 'OpenAI',
              model,
              text: data.choices?.[0]?.message?.content,
              finishReason: openaiFinishReason,
              usage: data.usage || null,
            }),
            usage: data.usage || null,
            finishReason: openaiFinishReason,
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

        const openaiSdkFinishReason = completion.choices?.[0]?.finish_reason ?? null;
        return {
          text: usableTextOrThrow({
            label: 'OpenAI',
            model,
            text: completion.choices?.[0]?.message?.content,
            finishReason: openaiSdkFinishReason,
            usage: completion.usage || null,
          }),
          usage: completion.usage || null,
          finishReason: openaiSdkFinishReason,
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
          throw Object.assign(
            new Error(`Anthropic API key não configurada para o tenant: ${tenantId}`),
            { code: 'AI_PROVIDER_NOT_CONFIGURED' },
          );
        }

        const model = context?.model || config.get('ai.anthropic.model', 'claude-sonnet-5');
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
          
          const anthropicFetchFinishReason = anthropicFinishReason(data);
          return {
            text: usableTextOrThrow({
              label: 'Anthropic',
              model,
              text: data.content?.[0]?.text,
              finishReason: anthropicFetchFinishReason,
              usage: data.usage || null,
            }),
            usage: data.usage || null,
            finishReason: anthropicFetchFinishReason,
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

        const anthropicSdkFinishReason = anthropicFinishReason(message);
        return {
          text: usableTextOrThrow({
            label: 'Anthropic',
            model,
            text: message.content?.[0]?.text,
            finishReason: anthropicSdkFinishReason,
            usage: message.usage || null,
          }),
          usage: message.usage || null,
          finishReason: anthropicSdkFinishReason,
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
 * Factory genérica para providers OpenAI-compatible (DeepSeek, Kimi, Mistral, Groq…).
 * A definição vem do registry central (`engine/aiProviderRegistry.js`).
 */
function createOpenAICompatibleProvider(def) {
  if (!def || !def.id || !def.baseUrl) {
    throw new Error('createOpenAICompatibleProvider: definição de provider inválida');
  }
  const providerId = def.id;
  const label = def.label || providerId;

  return {
    async generate(prompt, context) {
      try {
        const tenantId = context?.tenantId || null;
        if (!tenantId) {
          throw new Error(`${label}: tenantId é obrigatório para resolver credenciais por tenant`);
        }
        let apiKey = null;
        try {
          // eslint-disable-next-line global-require
          const { getDecryptedAPIKey } = require('./tenantAIService');
          apiKey = await getDecryptedAPIKey(safeToString(tenantId), providerId);
        } catch (e) {
          logger.warn(`⚠️ ${label}: falha ao obter API key do tenant (DB)`, { tenantId, error: safeErrorMessage(e) });
        }

        if (!apiKey) {
          throw Object.assign(
            new Error(`${label} API key não configurada para o tenant: ${tenantId}`),
            { code: 'AI_PROVIDER_NOT_CONFIGURED' },
          );
        }

        const model = context?.model || config.get(`ai.${providerId}.model`, def.defaultModel);
        logger.debug(`🤖 ${label}: Iniciando geração`, {
          source: context?.source || null,
          executionId: context?.executionId || null,
          model,
          promptLength: prompt.length,
        });

        const url = `${def.baseUrl.replace(/\/$/, '')}/chat/completions`;
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
            ...getTokenLimitParam(model, prompt.length),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || `${label} API error: ${response.status}`;
          const e = new Error(errorMessage);
          e.status = response.status;
          e.code = errorData?.error?.code || null;
          throw e;
        }

        const data = await response.json();
        const compatibleFinishReason = data.choices?.[0]?.finish_reason ?? null;
        return {
          text: usableTextOrThrow({
            label,
            model,
            text: data.choices?.[0]?.message?.content,
            finishReason: compatibleFinishReason,
            usage: data.usage || null,
          }),
          usage: data.usage || null,
          finishReason: compatibleFinishReason,
        };
      } catch (error) {
        logger.error(`❌ ${label}: Erro ao gerar resposta`, {
          message: safeErrorMessage(error),
          stack: error.stack,
        });
        throw error;
      }
    },
  };
}

/**
 * Factory genérica para providers Anthropic-compatible (custom).
 * Usa o formato /messages com x-api-key + anthropic-version (fetch direto).
 */
function createAnthropicCompatibleProvider(def) {
  if (!def || !def.id || !def.baseUrl) {
    throw new Error('createAnthropicCompatibleProvider: definição de provider inválida');
  }
  const providerId = def.id;
  const label = def.label || providerId;

  return {
    async generate(prompt, context) {
      try {
        const tenantId = context?.tenantId || null;
        if (!tenantId) {
          throw new Error(`${label}: tenantId é obrigatório para resolver credenciais por tenant`);
        }
        let apiKey = null;
        try {
          // eslint-disable-next-line global-require
          const { getDecryptedAPIKey } = require('./tenantAIService');
          apiKey = await getDecryptedAPIKey(safeToString(tenantId), providerId);
        } catch (e) {
          logger.warn(`⚠️ ${label}: falha ao obter API key do tenant (DB)`, { tenantId, error: safeErrorMessage(e) });
        }

        if (!apiKey) {
          throw Object.assign(
            new Error(`${label} API key não configurada para o tenant: ${tenantId}`),
            { code: 'AI_PROVIDER_NOT_CONFIGURED' },
          );
        }

        const model = context?.model || config.get(`ai.${providerId}.model`, def.defaultModel);
        const url = `${def.baseUrl.replace(/\/$/, '')}/messages`;
        const response = await fetch(url, {
          method: 'POST',
          signal: context?.signal || undefined,
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || `${label} API error: ${response.status}`;
          const e = new Error(errorMessage);
          e.status = response.status;
          e.code = errorData?.error?.type || errorData?.error?.code || null;
          throw e;
        }

        const data = await response.json();
        const compatibleAnthropicFinishReason = anthropicFinishReason(data);
        return {
          text: usableTextOrThrow({
            label,
            model,
            text: data.content?.[0]?.text,
            finishReason: compatibleAnthropicFinishReason,
            usage: data.usage || null,
          }),
          usage: data.usage || null,
          finishReason: compatibleAnthropicFinishReason,
        };
      } catch (error) {
        logger.error(`❌ ${label}: Erro ao gerar resposta`, {
          message: safeErrorMessage(error),
          stack: error.stack,
        });
        throw error;
      }
    },
  };
}

/**
 * Provider de IA usando DeepSeek (API OpenAI-compatible)
 */
function createDeepSeekProvider() {
  return {
    async generate(prompt, context) {
      try {
        const tenantId = context?.tenantId || null;
        if (!tenantId) {
          throw new Error('DeepSeek: tenantId é obrigatório para resolver credenciais por tenant');
        }
        let apiKey = null;
        try {
          // eslint-disable-next-line global-require
          const { getDecryptedAPIKey } = require('./tenantAIService');
          apiKey = await getDecryptedAPIKey(safeToString(tenantId), 'deepseek');
        } catch (e) {
          logger.warn('⚠️ DeepSeek: falha ao obter API key do tenant (DB)', { tenantId, error: safeErrorMessage(e) });
        }

        if (!apiKey) {
          throw Object.assign(
            new Error(`DeepSeek API key não configurada para o tenant: ${tenantId}`),
            { code: 'AI_PROVIDER_NOT_CONFIGURED' },
          );
        }

        const model = context?.model || config.get('ai.deepseek.model', 'deepseek-flash');
        // Orçamento de saída ADAPTATIVO (defeito real: 1000 fixo → content vazio consumido por reasoning).
        const tokenParams = getTokenLimitParam(model, prompt.length);
        logger.debug('🤖 DeepSeek: Iniciando geração', {
          source: context?.source || null,
          executionId: context?.executionId || null,
          model,
          promptLength: prompt.length,
          tokenParams,
        });

        // DeepSeek é OpenAI-compatible: usa fetch direto
        const url = 'https://api.deepseek.com/v1/chat/completions';
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

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || `DeepSeek API error: ${response.status}`;
          const e = new Error(errorMessage);
          e.status = response.status;
          e.code = errorData?.error?.code || null;
          throw e;
        }

        const data = await response.json();
        const deepseekFinishReason = data.choices?.[0]?.finish_reason ?? null;
        return {
          text: usableTextOrThrow({
            label: 'DeepSeek',
            model,
            text: data.choices?.[0]?.message?.content,
            finishReason: deepseekFinishReason,
            usage: data.usage || null,
          }),
          usage: data.usage || null,
          finishReason: deepseekFinishReason,
        };
      } catch (error) {
        logger.error('❌ DeepSeek: Erro ao gerar resposta', {
          message: safeErrorMessage(error),
          stack: error.stack,
        });
        throw error;
      }
    },
  };
}


/**
 * Provider de IA usando Kimi (Moonshot AI — API OpenAI-compatible)
 */
function createKimiProvider() {
  return {
    async generate(prompt, context) {
      try {
        const tenantId = context?.tenantId || null;
        if (!tenantId) {
          throw new Error('Kimi: tenantId é obrigatório para resolver credenciais por tenant');
        }
        let apiKey = null;
        try {
          // eslint-disable-next-line global-require
          const { getDecryptedAPIKey } = require('./tenantAIService');
          apiKey = await getDecryptedAPIKey(safeToString(tenantId), 'kimi');
        } catch (e) {
          logger.warn('⚠️ Kimi: falha ao obter API key do tenant (DB)', { tenantId, error: safeErrorMessage(e) });
        }

        if (!apiKey) {
          throw Object.assign(
            new Error(`Kimi API key não configurada para o tenant: ${tenantId}`),
            { code: 'AI_PROVIDER_NOT_CONFIGURED' },
          );
        }

        const model = context?.model || config.get('ai.kimi.model', 'kimi-k2.6');
        // Orçamento de saída ADAPTATIVO (defeito real: 1000 fixo → content vazio consumido por reasoning).
        const tokenParams = getTokenLimitParam(model, prompt.length);
        logger.debug('🤖 Kimi: Iniciando geração', {
          source: context?.source || null,
          executionId: context?.executionId || null,
          model,
          promptLength: prompt.length,
          tokenParams,
        });

        // Kimi (Moonshot) é OpenAI-compatible: usa fetch direto
        const url = 'https://api.moonshot.ai/v1/chat/completions';
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

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || `Kimi API error: ${response.status}`;
          const e = new Error(errorMessage);
          e.status = response.status;
          e.code = errorData?.error?.code || null;
          throw e;
        }

        const data = await response.json();
        const kimiFinishReason = data.choices?.[0]?.finish_reason ?? null;
        return {
          text: usableTextOrThrow({
            label: 'Kimi',
            model,
            text: data.choices?.[0]?.message?.content,
            finishReason: kimiFinishReason,
            usage: data.usage || null,
          }),
          usage: data.usage || null,
          finishReason: kimiFinishReason,
        };
      } catch (error) {
        logger.error('❌ Kimi: Erro ao gerar resposta', {
          message: safeErrorMessage(error),
          stack: error.stack,
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
      registerAiProvider('openai', {
        generate: aiControlPlaneStatus.wrapProviderGenerate('openai', openaiProvider.generate.bind(openaiProvider)),
      });
      logger.info('✅ Provider OpenAI registrado');
    } catch (err) {
      logger.warn('⚠️  OpenAI não configurado', { message: safeErrorMessage(err) });
    }

    // Tenta registrar Anthropic se configurado
    try {
      const anthropicProvider = createAnthropicProvider();
      registerAiProvider('anthropic', {
        generate: aiControlPlaneStatus.wrapProviderGenerate('anthropic', anthropicProvider.generate.bind(anthropicProvider)),
      });
      logger.info('✅ Provider Anthropic registrado');
    } catch (err) {
      logger.warn('⚠️  Anthropic não configurado', { message: safeErrorMessage(err) });
    }

    // Sincroniza built-ins no banco e registra os providers OpenAI-compatible
    // a partir do registry de runtime (built-ins + custom do DB). Adicionar um
    // provider custom via UI = nova linha em ai_providers → registrado aqui.
    let runtimeProviders = {};
    try {
      // eslint-disable-next-line global-require
      const aiProviderRegistryService = require('./aiProviderRegistryService');
      await aiProviderRegistryService.ensureBuiltinProviders();
      runtimeProviders = await aiProviderRegistryService.getRuntimeProviders();
    } catch (err) {
      logger.warn('⚠️  Registry de providers indisponível; usando built-ins estáticos', { message: safeErrorMessage(err) });
      // eslint-disable-next-line global-require
      const { AI_PROVIDERS } = require('../../engine/aiProviderRegistry');
      runtimeProviders = Object.fromEntries(
        Object.entries(AI_PROVIDERS).map(([id, def]) => [id, { id, label: def.label, kind: def.kind, baseUrl: def.baseUrl, defaultModel: def.defaultModel, models: def.models || [] }]),
      );
    }

    for (const def of Object.values(runtimeProviders)) {
      // openai (SDK) e anthropic (SDK) já foram registrados explicitamente acima.
      if (def.id === 'openai' || def.id === 'anthropic') continue;

      // Provider DESABILITADO no banco não é registrado como invocável: sem
      // isto, desligar um provider na UI/DB só mudava o rótulo e a engine
      // continuava roteando para ele (defeito medido 2026-09-24 — groq sem
      // credencial habilitado por padrão derrubava o mesh com 500
      // "circuit breaker aberto"). Estado desabilitado é fail-closed.
      if (def.enabled === false) {
        logger.info(`⏭️  Provider ${def.label || def.id} desabilitado — não registrado`);
        continue;
      }

      try {
        const provider = def.kind === 'anthropic'
          ? createAnthropicCompatibleProvider(def)
          : createOpenAICompatibleProvider(def);
        registerAiProvider(def.id, {
          generate: aiControlPlaneStatus.wrapProviderGenerate(def.id, provider.generate.bind(provider)),
        });
        logger.info(`✅ Provider ${def.label} registrado`);
      } catch (err) {
        logger.warn(`⚠️  ${def.label} não configurado`, { message: safeErrorMessage(err) });
      }
    }

    // A seleção de provider por tenant agora é decisão da ENGINE (roteamento
    // engine-wide com circuit breaker + failover). Não sincronizamos mais
    // primary/secondary do banco/config.json para o runtime.
    logger.info('ℹ️  Seleção de provider por tenant é decidida pela engine (roteamento engine-wide)');

    // Model Registry (providerRegistry) observável: HEALTHY se houver pelo
    // menos um provider registrado; BLOCKED caso contrário (roteamento sem
    // rota homologada deve falhar fechado, nunca escolher modelo arbitrário).
    try {
      const { getRegisteredProviderIds } = require('./aiProviderManager.js');
      const registered = getRegisteredProviderIds();
      aiControlPlaneStatus.setComponentStatus(
        'MODEL_REGISTRY',
        registered.length > 0 ? 'HEALTHY' : 'BLOCKED',
      );
    } catch (err) {
      aiControlPlaneStatus.setComponentStatus('MODEL_REGISTRY', 'UNKNOWN');
      logger.warn('⚠️  Erro ao avaliar status do Model Registry', { error: safeErrorMessage(err) });
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
  resolveMaxOutputTokens,
  usableTextOrThrow,
  OUTPUT_TOKEN_BUDGET,
  REASONING_TOKEN_RESERVE,
  PROVIDER_OUTPUT_FAILURE_CODES,
  createOpenAIProvider,
  createAnthropicProvider,
  createDeepSeekProvider,
  createKimiProvider,
  createOpenAICompatibleProvider,
  createAnthropicCompatibleProvider,
};

