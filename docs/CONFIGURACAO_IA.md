# Configuração de Providers de IA

Este guia explica como configurar providers de IA no sistema.

## Visão Geral

O sistema suporta múltiplos providers de IA e permite configurar diferentes providers por tenant. Os providers são gerenciados pelo módulo `aiProviderManager` e a configuração/credenciais são **por tenant (no banco, criptografadas)**.

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

### 1. Configurar via UI (recomendado)

Use `http://localhost:5173/config?tab=ai&tenant=<TENANT_KEY>` para:

- escolher o provider primário (e opcionalmente secundário)
- salvar a configuração do tenant
- salvar credenciais (API key) do provider (criptografadas no DB)

### 2. Campos de Configuração (por tenant)

- **`primary`**: Provider principal para o tenant (obrigatório)
- **`secondary`**: Provider secundário (opcional)
- **Credenciais**: API key do provider selecionado (salvas no DB e nunca exibidas)

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
- Verifique se o tenant tem `primary` configurado e salvo
- Verifique se existem credenciais salvas para o provider (no DB)

### Provider sempre retorna resposta simulada
- Verifique se os pacotes SDK estão instalados
- Descomente e implemente o código real em `aiProviderService.js`

## Segurança

⚠️ **IMPORTANTE**: Nunca commite chaves de API reais no controle de versão.

- As credenciais são salvas criptografadas no DB e nunca são exibidas pela API.

