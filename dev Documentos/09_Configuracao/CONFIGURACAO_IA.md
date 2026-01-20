# Configuração de Providers de IA

Este guia explica como configurar providers de IA no sistema.

## Visão Geral

O sistema suporta múltiplos providers de IA e permite configurar diferentes providers por tenant. Os providers são gerenciados pelo módulo `aiProviderManager` e podem ser configurados via arquivo `api/data/config.json`.

## Providers Suportados

### 1. OpenAI
- **ID**: `openai`
- **Requer**: Chave de API OpenAI
- **Modelos**: gpt-5.2 (recomendado), gpt-5.1, gpt-4o, gpt-4, gpt-3.5-turbo, etc.

### 2. Anthropic (Claude)
- **ID**: `anthropic`
- **Requer**: Chave de API Anthropic
- **Modelos**: claude-3-sonnet-20240229, claude-3-opus, etc.

### 3. Fallback
- **ID**: `fallback`
- **Descrição**: Provider de fallback que retorna mensagens estáticas quando outros providers falham

## Configuração

### 1. Editar `api/data/config.json`

Adicione a seção `ai` ao arquivo de configuração:

```json
{
  "ai": {
    "defaultProvider": "openai",
    "defaultFallback": "fallback",
    "openai": {
      "apiKey": "sk-sua-chave-api-openai-aqui",
      "model": "gpt-5.2"
    },
    "anthropic": {
      "apiKey": "sk-ant-sua-chave-api-anthropic-aqui",
      "model": "claude-3-sonnet-20240229"
    },
    "tenants": {
      "tenant-acme": {
        "primary": "openai",
        "fallback": "fallback"
      },
      "tenant-premium": {
        "primary": "anthropic",
        "fallback": "openai"
      }
    }
  }
}
```

### 2. Campos de Configuração

- **`defaultProvider`**: Provider padrão usado quando nenhum tenant específico está configurado
- **`defaultFallback`**: Provider de fallback padrão
- **`openai.apiKey`**: Chave de API da OpenAI (obtenha em https://platform.openai.com/api-keys)
- **`openai.model`**: Modelo OpenAI a ser usado (padrão: `gpt-5.2`). Modelos disponíveis: gpt-5.2, gpt-5.1, gpt-4o, gpt-4, gpt-3.5-turbo
- **`anthropic.apiKey`**: Chave de API da Anthropic (obtenha em https://console.anthropic.com/)
- **`anthropic.model`**: Modelo Anthropic a ser usado (padrão: `claude-3-sonnet-20240229`)
- **`tenants`**: Configuração específica por tenant
  - **`primary`**: Provider principal para o tenant
  - **`fallback`**: Provider de fallback (opcional)

### 3. Instalar Dependências (Opcional)

Para usar providers reais, você precisa instalar os SDKs correspondentes:

```bash
# Para OpenAI
npm install openai

# Para Anthropic
npm install @anthropic-ai/sdk
```

**Nota**: Atualmente, os providers retornam respostas simuladas. Para usar chamadas reais à API, você precisa:

1. Instalar os pacotes acima
2. Descomentar e implementar o código real em `api/services/aiProviderService.js`

## Como Funciona

1. **Inicialização**: Quando o servidor inicia, `initializeAiProviders()` é chamado
2. **Registro**: Os providers configurados são registrados no `aiProviderManager`
3. **Configuração por Tenant**: Cada tenant pode ter seu próprio provider principal e fallback
4. **Fallback Automático**: Se o provider principal falhar, o sistema tenta o fallback automaticamente

## Exemplo de Uso

### Via API

```bash
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Olá, como você está?",
    "tenantId": "tenant-acme",
    "sessionId": "session-123",
    "flowId": "flow-456",
    "nodeId": "node-789"
  }'
```

### Resposta

```json
{
  "text": "Olá! Estou bem, obrigado por perguntar. Como posso ajudá-lo hoje?",
  "usage": {
    "promptTokens": 10,
    "completionTokens": 15,
    "totalTokens": 25
  }
}
```

## Troubleshooting

### Erro: "Nenhum provider de IA configurado"
- Verifique se a seção `ai` existe em `config.json`
- Verifique se `defaultProvider` está configurado
- Verifique se o provider está registrado (veja logs do servidor)

### Erro: "OpenAI API key não configurada"
- Adicione `ai.openai.apiKey` no `config.json`
- Obtenha uma chave em https://platform.openai.com/api-keys

### Provider sempre retorna resposta simulada
- Verifique se os pacotes SDK estão instalados
- Descomente e implemente o código real em `aiProviderService.js`

## Segurança

⚠️ **IMPORTANTE**: Nunca commite o arquivo `config.json` com chaves de API reais no controle de versão!

- Use variáveis de ambiente como alternativa
- Mantenha `config.json` no `.gitignore`
- Use `config.example.json` como template

