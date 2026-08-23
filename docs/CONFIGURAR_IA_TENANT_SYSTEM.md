# Como Configurar IA para o Tenant "system"

Este documento explica como salvar a configuração de IA para o tenant "system".

## ⚠️ Atualizado (2026-08): a engine decide o provider

A partir de 2026-08, **não é mais necessário configurar `primary`/`secondary`**. Os providers são registrados globalmente (`engine/aiProviderRegistry.js` + tabela `ai_providers`) e a engine roteia por todos os providers com credencial configurada (circuit breaker + failover). `primary`/`secondary` continuam aceitos por compatibilidade, mas **não dirigem mais o roteamento**.

O que importa agora:
1. **Credenciais por provider** (`PUT /tenants/:tenantKey/ai-credentials`) — a engine usa qualquer provider que tenha chave salva.
2. **Registro de providers** (`GET/POST /ai-providers`, `DELETE /ai-providers/:key`) — gerencie os providers na aba IA (⚙️ Configuração → 🤖 IA).

## Visão Geral

O tenant "system" é um tenant especial usado para operações administrativas e geração de sistemas. Ele precisa ter ao menos um provider de IA com credencial configurada para funcionar corretamente.

## Métodos para Configurar

### 1. Via API REST (Recomendado)

#### Endpoint: `PUT /tenants/system/ai-config`

**Requisitos:**
- Autenticação: Token JWT válido
- Permissão: Super Admin OU Owner do tenant "system"

**Exemplo de requisição:**

```bash
curl -X PUT http://localhost:3000/tenants/system/ai-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "primary": "openai",
    "secondary": "anthropic",
    "enabled": true,
    "model": "gpt-5.2",
    "temperature": 0.7,
    "max_tokens": 2000
  }'
```

**Campos do body:**
- `primary` (obrigatório): Provider primário (`"openai"` ou `"anthropic"`)
- `secondary` (opcional): Provider secundário para fallback
- `enabled` (opcional): Se a IA está habilitada (padrão: `true`)
- `model` (opcional): Modelo a ser usado (ex: `"gpt-5.2"`, `"claude-3-opus"`)
- `temperature` (opcional): Temperatura do modelo (0.0 a 2.0)
- `max_tokens` (opcional): Máximo de tokens na resposta

**Resposta de sucesso (200):**
```json
{
  "primary": "openai",
  "secondary": "anthropic",
  "configured": true,
  "enabled": true,
  "model": "gpt-5.2",
  "temperature": 0.7,
  "max_tokens": 2000
}
```

### 2. Via JavaScript/Node.js (Backend)

```javascript
const { saveAIConfig } = require('./api/services/tenantAIService');

async function configurarIASystem() {
  try {
    const config = {
      primary: 'openai',
      secondary: 'anthropic', // opcional
      enabled: true,
      model: 'gpt-5.2',
      temperature: 0.7,
      max_tokens: 2000
    };
    
    const resultado = await saveAIConfig('system', config);
    console.log('✅ Configuração salva:', resultado);
  } catch (error) {
    console.error('❌ Erro ao salvar configuração:', error);
  }
}
```

### 3. Configuração de Credenciais (API Keys)

As credenciais (API keys) são salvas separadamente e criptografadas:

#### Endpoint: `PUT /tenants/system/ai-credentials`

```bash
curl -X PUT http://localhost:3000/tenants/system/ai-credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "provider": "openai",
    "apiKey": "sk-..."
  }'
```

**Importante:** As API keys são criptografadas antes de serem salvas no banco de dados.

## Verificar Configuração Atual

### Via API: `GET /tenants/system/ai-config`

```bash
curl -X GET http://localhost:3000/tenants/system/ai-config \
  -H "Authorization: Bearer <TOKEN>"
```

### Via JavaScript:

```javascript
const { getAIConfig } = require('./api/services/tenantAIService');

async function verificarConfig() {
  const config = await getAIConfig('system');
  console.log('Configuração atual:', config);
}
```

## Inicialização

Na inicialização, `initializeAiProviders`:
1. Registra os providers built-in (OpenAI SDK, Anthropic SDK) e os demais (DeepSeek, Kimi, Mistral, Groq + custom) via factory genérica.
2. Sincroniza os built-ins na tabela `ai_providers` (`aiProviderRegistryService.ensureBuiltinProviders`).
3. NÃO sincroniza mais `primary`/`secondary` do banco para o runtime — a seleção de provider por tenant é decisão da engine (roteamento engine-wide).

A engine resolve o provider de um tenant sem config explícita: tenta todos os providers registrados em ordem, pula os sem credencial (`AI_PROVIDER_NOT_CONFIGURED`) e para em bloqueios duros (policy denial, modelo aposentado, budget).

## Estrutura no Banco de Dados

A configuração é salva na tabela `tenant_ai_settings`:

```sql
SELECT * FROM tenant_ai_settings WHERE tenant_id = (
  SELECT id FROM tenants WHERE tenant_key = 'system'
);
```

Campos principais:
- `tenant_id`: ID do tenant
- `primary`: Provider primário
- `secondary`: Provider secundário (opcional)
- `enabled`: Se está habilitado
- `model`: Modelo configurado
- `temperature`: Temperatura
- `max_tokens`: Máximo de tokens

## Troubleshooting

### Erro: "Tenant system não encontrado"

O tenant "system" é criado automaticamente na inicialização. Se não existir:
1. Verifique os logs de inicialização
2. Verifique se o banco de dados está conectado
3. Tente criar manualmente via API de tenants

### Erro: "Nenhum provider de IA configurado para tenant: system"

Isso significa que:
1. Nenhum provider registrado tem credencial salva para o tenant "system".

**Solução:**
1. Salve a API key de pelo menos um provider (`PUT /tenants/system/ai-credentials`)
2. Ou registre/configure um provider na aba IA (⚙️ Configuração → 🤖 IA)

### Verificar se Providers Estão Registrados

```javascript
const { getRegisteredProviderIds, isProviderRegistered } = require('../engine/aiProviderManager');

console.log('Providers registrados:', getRegisteredProviderIds());
console.log('OpenAI disponível:', isProviderRegistered('openai'));
console.log('Anthropic disponível:', isProviderRegistered('anthropic'));
```

## Exemplo Completo

```bash
# 1. Configurar credenciais do OpenAI
curl -X PUT http://localhost:3000/tenants/system/ai-credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"provider": "openai", "apiKey": "sk-..."}'

# 2. Configurar a configuração de IA
curl -X PUT http://localhost:3000/tenants/system/ai-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "primary": "openai",
    "enabled": true,
    "model": "gpt-5.2"
  }'

# 3. Verificar configuração
curl -X GET http://localhost:3000/tenants/system/ai-config \
  -H "Authorization: Bearer TOKEN"
```

## Notas Importantes

1. **Permissões:** Apenas Super Admins ou Owners do tenant podem alterar configurações
2. **Criptografia:** API keys são criptografadas antes de serem salvas
3. **Roteamento:** A engine tenta os providers registrados em ordem (com circuit breaker), pulando os sem credencial e parando em bloqueios duros; não depende de primary/secondary.
4. **Reinicialização:** Após salvar a configuração, o sistema precisa recarregar os providers (geralmente automático na próxima requisição)
