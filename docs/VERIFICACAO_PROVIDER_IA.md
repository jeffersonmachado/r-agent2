# Processo de Verificação de Provider de IA Válido

> ⚠️ **ATUALIZADO (2026-08) — este runbook está HISTÓRICO.** A seleção de provider agora é decisão da **engine** (roteamento engine-wide, sem `primary`/`secondary`). A verificação atual está em `getTenantAiProviderStatus` (`api/modules/tenant/aiWorkflows.js`): `hasValidProvider = (engine resolve provider) && (ao menos um provider com credencial para o tenant)`. Consulte os docs atuais: `docs/CONFIGURACAO_IA.md`, `docs/REQUISITOS_PROVIDER_VALIDO.md` e `docs/CONFIGURAR_IA_TENANT_SYSTEM.md`. O conteúdo abaixo descreve o modelo antigo e foi mantido apenas como referência.

Este documento detalha o processo de verificação de provider de IA válido para tenants.

## Visão Geral

O sistema verifica se um tenant possui um provider de IA válido configurado (por-tenant, no banco) antes de permitir o acesso à plataforma. A verificação ocorre em dois momentos:

1. **Após login bem-sucedido** (usuário não super-admin)
2. **Após seleção de tenant** (super-admin)

## Fluxo de Verificação

### 1. Inicialização dos Providers (Servidor)

Quando o servidor inicia, o processo `initializeAiProviders()` é executado:

**Arquivo**: `api/services/aiProviderService.js`

```javascript
function initializeAiProviders() {
  // 1. Tenta registrar OpenAI se configurado
  try {
    const openaiProvider = createOpenAIProvider();
    registerAiProvider('openai', openaiProvider);
    logger.info('✅ Provider OpenAI registrado');
  } catch (err) {
    logger.warn('⚠️  OpenAI não configurado', { message: err.message });
  }

  // 2. Tenta registrar Anthropic se configurado
  try {
    const anthropicProvider = createAnthropicProvider();
    registerAiProvider('anthropic', anthropicProvider);
    logger.info('✅ Provider Anthropic registrado');
  } catch (err) {
    logger.warn('⚠️  Anthropic não configurado', { message: err.message });
  }

  // 3. Configura providers por tenant (se houver configuração específica)
  const aiConfig = config.get('ai', {});
  const tenantConfig = aiConfig.tenants || {};

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
  }
}
```

**O que acontece:**
- Registra providers (OpenAI, Anthropic) no runtime
- Configura providers por tenant a partir do banco (`tenant_ai_settings`)

### 2. Verificação no Endpoint da API

**Endpoint**: `GET /tenants/:id/ai-provider-status`

**Arquivo**: `api/server.js` (linha ~1721)

```javascript
// GET /tenants/:id/ai-provider-status
if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/ai-provider-status')) {
  // 1. Verifica autenticação
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  // 2. Verifica permissões
  const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/ai-provider-status', ''));
  const isSuperAdminUser = isSuperAdmin(req.agent);
  if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  // 3. Verifica provider específico do tenant
  const { getAiProviderForTenant } = require('../engine/aiProviderManager');
  const provider = getAiProviderForTenant(tenantId);
  const hasTenantProvider = provider !== null && typeof provider === 'object' && typeof provider.generate === 'function';

  // 4. Sem fallback global: o provider deve estar configurado por tenant
  const hasValidProvider = hasTenantProvider;

  // 5. Retorna resultado
  sendJson(res, 200, { 
    hasValidProvider,
    tenantId 
  });
}
```

### 3. Verificação no Engine (getAiProviderForTenant)

**Arquivo**: `engine/aiProviderManager.js`

```javascript
function getAiProviderForTenant(tenantId) {
  // 1. Busca configuração específica do tenant
  const cfg = tenantConfig.get(tenantId);
  
  if (!cfg) {
    // 2. Se não houver configuração específica, retorna null
    // (não usa fallback - provider é obrigatório por tenant)
    return null;
  }

  // 3. Busca o provider primário no registry
  const primary = providerRegistry.get(cfg.primary);
  if (!primary) {
    // Provider primário não encontrado no registry
    return null;
  }

  // 4. Se houver provider secundário, cria provider composto
  const secondary = cfg.secondary ? providerRegistry.get(cfg.secondary) : null;
  
  if (!secondary) {
    // Sem secundário, retorna apenas o primário
    return primary;
  }

  // 5. Retorna provider composto (com fallback automático)
  return {
    async generate(prompt, context) {
      try {
        return await primary.generate(prompt, context);
      } catch (err) {
        // Em caso de erro, tenta o secundário
        return await secondary.generate(prompt, context);
      }
    },
  };
}
```

## Lógica de Decisão

### Quando um Provider é Considerado Válido?

Um provider é considerado válido quando **pelo menos uma** das seguintes condições é verdadeira:

#### 1. Provider Específico do Tenant
- O tenant tem configuração em `ai.tenants[tenantId]`
- O provider primário configurado está registrado no `providerRegistry`
- O provider tem o método `generate` implementado

#### 2. Provider Global Disponível
**Removido.** O sistema não usa mais API keys globais; credenciais e provider são sempre por tenant (DB).

### Exemplo de Configuração

#### Configuração Específica por Tenant (Recomendado)

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-..."
    },
    "anthropic": {
      "apiKey": "sk-ant-..."
    },
    "tenants": {
      "tenant-acme": {
        "primary": "openai",
        "secondary": "anthropic"
      },
      "tenant-prod": {
        "primary": "anthropic"
      }
    }
  }
}
```

#### Configuração Global (Fallback)
**Removido.** Não há mais fallback global.

## Fluxo no Frontend

### 1. Após Login (Usuário Normal)

**Arquivo**: `frontend/src/components/Login.jsx`

```javascript
// Após login bem-sucedido
const tenantId = result.agent?.tenantId;
if (tenantId) {
  const aiProviderStatus = await checkTenantAiProviderStatus(tenantId);
  
  if (!aiProviderStatus.hasValidProvider) {
    showToast('Configure um provider de IA para o tenant antes de continuar', 'warning');
    setTimeout(() => {
      navigate('/config?tab=ai');
    }, 1500);
    return; // Bloqueia acesso
  }
  
  // Continua para /support
  navigate('/support');
}
```

### 2. Após Seleção de Tenant (Super Admin)

**Arquivo**: `frontend/src/components/Login.jsx`

```javascript
const handleTenantSelected = async (tenant) => {
  // Atualiza tenantId do agente
  updateAgent({ ...loginResult.agent, tenantId: tenant.id });
  
  // Verifica provider de IA
  const aiProviderStatus = await checkTenantAiProviderStatus(tenant.id);
  
  if (!aiProviderStatus.hasValidProvider) {
    showToast('Configure um provider de IA para o tenant antes de continuar', 'warning');
    setTimeout(() => {
      navigate('/config?tab=ai');
    }, 1500);
    return; // Bloqueia acesso
  }
  
  // Continua para /support
  navigate('/support');
};
```

## Logs e Debug

### Logs do Servidor

O sistema gera logs detalhados em cada etapa:

```
[DEBUG] Verificando provider de IA para tenant { tenantId: 'tenant-acme', hasTenantProvider: false, hasValidProvider: true }
[INFO] Status de provider de IA do tenant { tenantId: 'tenant-acme', hasValidProvider: true }
```

### Logs do Frontend

```
[Login] Verificando provider de IA para o tenant selecionado: tenant-acme
[Login] Resposta completa da verificação: { hasValidProvider: true, tenantId: 'tenant-acme' }
[Login] ✅ Tenant tem provider de IA válido, continuando para /support
```

## Resumo do Processo

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Inicialização do Servidor                                │
│    - Registra providers (OpenAI/Anthropic)                 │
│    - Configura providers por tenant (DB)                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Login do Usuário                                         │
│    - Usuário faz login                                      │
│    - Sistema identifica tenantId                            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Verificação de Provider                                  │
│    - Chama GET /tenants/:id/ai-provider-status              │
│    - Verifica provider do tenant no runtime                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
                    ┌─────────┐
                    │ Válido? │
                    └─────────┘
                    │         │
          ┌─────────┘         └─────────┐
          │                             │
          ▼                             ▼
    ┌──────────┐                  ┌──────────┐
    │   SIM    │                  │   NÃO    │
    └──────────┘                  └──────────┘
          │                             │
          ▼                             ▼
    ┌──────────┐                  ┌──────────┐
    │ /support │                  │ /config  │
    │          │                  │ ?tab=ai  │
    └──────────┘                  └──────────┘
```

## Tratamento de Erros

- **Erro na verificação (rede/401/500/timeouts)**: **bloqueia o acesso** e redireciona para a tela de configuração de IA (`/config?tab=ai`, e quando possível inclui `&tenant=<tenantId>`).
- **Provider não encontrado / não configurado**: **bloqueia o acesso** e redireciona para configuração (`/config?tab=ai` / `?tab=ai&tenant=<tenantId>`).
- **API key inválida**: Provider pode existir na configuração, mas será considerado **inválido** e o usuário será direcionado para configuração para corrigir.

## Notas Importantes

1. **Provider é obrigatório**: Não há fallback automático - cada tenant precisa ter configuração explícita ou usar provider global
2. **Verificação assíncrona**: A verificação é feita via API, então pode haver latência
3. **Permissões**: Apenas o próprio tenant, admin ou super-admin podem verificar o status
4. **Cache**: Não há cache - cada verificação consulta o estado atual
