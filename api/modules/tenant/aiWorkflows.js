const fs = require('fs');
const path = require('path');

async function generateTenantByAi({
  description,
  create = false,
  agent,
  headers,
  logger,
  generateAiResponse,
  registerGeneration,
  createTenant,
}) {
  const prompt = `Você é um assistente especializado em criar perfis de tenants para uma plataforma SaaS de automação com IA.

Com base na seguinte descrição, gere um JSON válido com os dados do tenant:

Descrição: ${description}

Gere um JSON com a seguinte estrutura:
{
  "name": "Nome do Tenant",
  "site": "https://exemplo.com",
  "ramo_atividade": "Descrição detalhada do ramo de atividade (2-3 frases)",
  "objetivo": "Objetivo estratégico do tenant com a plataforma (2-3 frases)"
}

Regras:
- O nome deve ser claro e profissional
- O site deve ser uma URL válida (use https://exemplo.com se não houver site específico)
- O ramo_atividade deve descrever o segmento de negócio de forma detalhada
- O objetivo deve explicar como o tenant pretende usar a plataforma

Retorne APENAS o JSON, sem markdown, sem explicações adicionais.`;

  logger.info('[Tenants] Gerando tenant por IA', { description: description.substring(0, 100) });
  const aiResult = await generateAiResponse(prompt, 'system', {});
  const aiText = aiResult.text || '';

  let tenantData;
  try {
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      tenantData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('JSON não encontrado na resposta');
    }
  } catch (parseError) {
    const error = new Error('A IA não retornou um JSON válido. Tente novamente com uma descrição mais detalhada.');
    error.httpStatus = 500;
    error.code = 'tenant_ai_parse_failed';
    error.details = { aiText, error: parseError.message };
    throw error;
  }

  if (!tenantData.name || !tenantData.ramo_atividade || !tenantData.objetivo) {
    const error = new Error('A IA não gerou todos os campos necessários. Tente novamente.');
    error.httpStatus = 500;
    error.code = 'tenant_ai_incomplete';
    throw error;
  }

  if (!tenantData.site) {
    tenantData.site = 'https://exemplo.com';
  }

  const { buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../../../engine/ai/aiEnvelope');
  const contractsDir = path.join(__dirname, '..', '..', '..', 'contracts');
  const tenantContractPath = path.join(contractsDir, 'tenant.contract.json');
  const tenantContract = JSON.parse(fs.readFileSync(tenantContractPath, 'utf8'));
  const { slugifyTenantKey, createTenantAiDraft } = require('../../services/tenantAiDraft');

  async function ensureUniqueTenantKey(baseKey) {
    const { getSequelize } = require('../../db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) return baseKey;
    const { Tenant } = require('../../db/models');
    const TenantModel = Tenant();
    let key = baseKey;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await TenantModel.findOne({ where: { tenant_key: key } });
      if (!existing) return key;
      key = `${baseKey}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 50);
    }
    return null;
  }

  const baseTenantKey = slugifyTenantKey(tenantData.name);
  const uniqueTenantKey = await ensureUniqueTenantKey(baseTenantKey);
  if (!uniqueTenantKey) {
    const error = new Error('Não foi possível gerar tenant_key único');
    error.httpStatus = 409;
    error.code = 'tenant_key_conflict';
    throw error;
  }

  const requestId = (headers['x-request-id'] && String(headers['x-request-id']).trim())
    ? String(headers['x-request-id']).trim()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const draftRes = createTenantAiDraft(tenantData, {
    tenantContractPath: 'contracts/tenant.contract.json',
    tenant_key: uniqueTenantKey,
  });

  const tenantDraft = draftRes.tenantDraft;
  const aiMeta = {
    provider: { name: null, model: null, temperature: null },
    input: {
      prompt_summary: 'tenants.generate-by-ai',
      user_goal: description,
      context: { tenantId: 'system' },
    },
    audit: {
      request_id: requestId,
      seed: null,
      tenant_id: 'system',
      user_id: agent?.id || agent?.username || null,
    },
    rawModelOutput: aiText,
  };

  const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope('tenant', tenantDraft, {
    valid: draftRes.valid === true,
    errors: draftRes.errors || [],
    warnings: draftRes.warnings || [],
    qualityScore: draftRes.qualityScore ?? (draftRes.valid ? 100 : 0),
    riskFlags: draftRes.riskFlags || [],
  }, aiMeta));

  if (!draftRes.valid) {
    try {
      const { appendGeneration } = require('../../../qa/aiGenerationStore');
      appendGeneration({ envelope, valid: false, domain: 'tenant', requestId });
    } catch {}

    try {
      const { logFailure } = require('../../../engine/ai/aiTelemetry');
      logFailure({
        domain: 'tenant',
        requestId,
        promptUsed: 'tenants.generate-by-ai',
        stage: 'TENANT_DRAFT_INVALID',
        errors: draftRes.errors || [],
      });
    } catch {}

    try {
      await registerGeneration({
        tenantId: 'system',
        payload: { description, createRequested: !!create },
        context: { sources: [] },
        artifacts: { tenantKey: tenantDraft?.tenant_key || null },
        contract: { version: tenantContract?.version || '1.0.0', hash: null },
        envelope,
        error: { type: 'TENANT_DRAFT_INVALID', errors: draftRes.errors || [] },
      });
    } catch {}

    const error = new Error('Tenant gerado não passou por contrato/semântica/safe-mode');
    error.httpStatus = 400;
    error.code = 'tenant_ai_validation_failed';
    error.payload = {
      envelope,
      error: {
        code: 'tenant_ai_validation_failed',
        message: 'Tenant gerado não passou por contrato/semântica/safe-mode',
        details: draftRes.errors,
      },
    };
    throw error;
  }

  logger.info('[Tenants] Tenant gerado por IA com sucesso', {
    name: tenantDraft.name,
    site: tenantDraft.site,
    tenant_key: tenantDraft.tenant_key,
    createRequested: !!create,
  });

  let aiAuditId = null;
  try {
    const { appendGeneration } = require('../../../qa/aiGenerationStore');
    aiAuditId = appendGeneration({ envelope, valid: true, domain: 'tenant', requestId });
  } catch {}

  try {
    const { logSuccess } = require('../../../engine/ai/aiTelemetry');
    logSuccess({
      domain: 'tenant',
      requestId,
      promptUsed: 'tenants.generate-by-ai',
      qualityScore: envelope?.validation?.qualityScore ?? null,
      riskFlags: envelope?.validation?.riskFlags || [],
    });
  } catch {}

  let auditGenerationId = null;
  try {
    auditGenerationId = await registerGeneration({
      tenantId: 'system',
      payload: { description, createRequested: !!create },
      context: { sources: [] },
      artifacts: { tenantKey: tenantDraft?.tenant_key || null },
      contract: { version: tenantContract?.version || '1.0.0', hash: null },
      envelope,
    });
  } catch {}

  let createdTenant = null;
  if (create === true) {
    const createResult = await createTenant({
      tenant_key: tenantDraft.tenant_key,
      name: tenantDraft.name,
      site: tenantDraft.site,
      ramo_atividade: tenantDraft.ramo_atividade,
      objetivo: tenantDraft.objetivo,
      plan: tenantDraft.plan,
      status: tenantDraft.status,
      limits: tenantDraft.limits,
      settings: tenantDraft.settings,
      branding: tenantDraft.branding,
      _aiSafeMode: true,
    });
    if (!createResult.success) {
      const error = new Error(createResult.error || 'Erro ao criar tenant (safe-mode)');
      error.httpStatus = 500;
      error.code = 'tenant_create_failed';
      error.payload = {
        error: 'tenant_create_failed',
        message: createResult.error || 'Erro ao criar tenant (safe-mode)',
        tenantDraft,
        envelope,
        auditId: aiAuditId,
      };
      throw error;
    }
    createdTenant = createResult.tenant;
  }

  return {
    generated: true,
    auditId: aiAuditId,
    auditGenerationId,
    envelope,
    tenantDraft,
    tenant: tenantDraft,
    created: !!createdTenant,
    createdTenant,
  };
}

async function getTenantAiProviderStatus({ tenantId, tenantAIService }) {
  const { getAiProviderForTenant } = require('../../../engine/aiProviderManager');

  // A engine decide o provider (roteamento engine-wide). O tenant tem provider
  // válido quando há pelo menos UM provider registrado com credencial salva.
  const provider = getAiProviderForTenant(tenantId);
  const hasRegisteredProvider = provider !== null
    && typeof provider === 'object'
    && typeof provider.generate === 'function';

  let hasAnyCredential = false;
  try {
    const statusMap = await tenantAIService.getCredentialStatusMap(tenantId);
    hasAnyCredential = Object.values(statusMap || {}).some(Boolean);
  } catch {
    hasAnyCredential = false;
  }

  return {
    hasValidProvider: hasRegisteredProvider && hasAnyCredential,
    tenantId,
  };
}

async function validateProviderCredentials(provider, apiKey) {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    return { valid: false, error: 'Token não pode estar vazio' };
  }

  // Fonte única de providers: registry dinâmico (built-ins + custom).
  // eslint-disable-next-line global-require
  const aiProviderRegistryService = require('../../services/aiProviderRegistryService');
  const def = await aiProviderRegistryService.getProviderDef(String(provider || '').trim().toLowerCase());
  if (!def) {
    return { valid: false, error: 'Provider não suportado' };
  }

  const baseUrl = def.baseUrl.replace(/\/$/, '');

  try {
    if (def.kind === 'anthropic') {
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': cleanApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: def.validationModel || 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return data?.content
          ? { valid: true, error: null }
          : { valid: false, error: `Resposta inválida da API ${def.label}` };
      }

      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
      if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
      return { valid: false, error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}` };
    }

    // openai-sdk e openai-compatible: valida via GET /models com Bearer
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cleanApiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);
      return Array.isArray(data?.data)
        ? { valid: true, error: null }
        : { valid: false, error: `Resposta inválida da API ${def.label}` };
    }

    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
    if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
    return { valid: false, error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}` };
  } catch (validationError) {
    if (validationError.name === 'AbortError' || validationError.name === 'TimeoutError') {
      return { valid: false, error: 'Timeout ao validar token. Verifique sua conexão com a internet.' };
    }
    if (validationError.name === 'TypeError' && String(validationError.message || '').includes('fetch')) {
      return { valid: false, error: 'Erro de conexão. Verifique sua conexão com a internet.' };
    }
    return { valid: false, error: validationError.message || 'Erro ao validar token' };
  }
}

module.exports = {
  generateTenantByAi,
  getTenantAiProviderStatus,
  validateProviderCredentials,
};
