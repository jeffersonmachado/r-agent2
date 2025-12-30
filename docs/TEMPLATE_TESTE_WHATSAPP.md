# 📱 Template de Teste - WhatsApp com Atendimento Humano

Template simples para testar a integração do WhatsApp com o sistema de atendimento humano.

## 🎯 Objetivo

Este template permite testar rapidamente:
- ✅ Recebimento de mensagens do WhatsApp
- ✅ Processamento básico pelo bot
- ✅ Escalação para atendimento humano via sistema de tickets
- ✅ Comunicação bidirecional entre usuário e atendente

## 📋 Estrutura do Template

### Fluxo Principal

1. **Boas-vindas** - Mensagem inicial de apresentação
2. **Coleta de Mensagem** - Captura a mensagem do usuário
3. **Verificação** - Detecta se o usuário pediu atendimento humano
4. **Resposta do Bot** - Responde quando não há pedido de humano
5. **Fallback** - Sistema de fallback que pode escalar automaticamente
6. **Escalação** - Transfere para fila de atendimento humano

### Nós do Fluxo

- `start` - Início do fluxo
- `boas_vindas` - Mensagem de boas-vindas
- `coletar_mensagem` - Coleta input do usuário
- `verificar_atendimento` - Router que detecta pedidos de atendente
- `resposta_bot` - Resposta padrão do bot
- `escalar_humano` - Handoff para fila "suporte"
- `fallback` - Sistema de fallback com escalação automática
- `tentar_novamente` - Mensagem de retry
- `opcoes` - Mensagem com opções
- `end` - Fim do fluxo

## 🚀 Como Usar

### 1. Importar o Template

1. Acesse o editor de fluxos
2. Clique em "Novo Fluxo" ou "Importar Template"
3. Selecione o template "Teste WhatsApp - Atendimento Humano"

### 2. Configurar a Fila

O template usa a fila `"suporte"` por padrão. Certifique-se de que ela existe:

```json
// api/data/queues.json
{
  "queues": {
    "suporte": []
  }
}
```

### 3. Testar no WhatsApp

#### Cenário 1: Pedido Direto de Atendente
- Usuário envia: "quero falar com um atendente"
- Bot detecta e transfere para fila "suporte"
- Ticket é criado automaticamente

#### Cenário 2: Fallback Automático
- Usuário envia mensagens que o bot não entende
- Após 2 tentativas, fallback escala automaticamente
- Ticket é criado na fila "suporte"

#### Cenário 3: Conversa Normal
- Usuário envia mensagem normal
- Bot responde e continua a conversa
- Fallback monitora e pode escalar se necessário

### 4. Atender no Painel

1. Acesse a página de Suporte (`/support`)
2. Veja o ticket criado na fila "suporte"
3. Clique no ticket para abrir
4. Envie mensagens que serão entregues no WhatsApp
5. Receba mensagens do usuário em tempo real

## ⚙️ Configurações do Fallback

O nó `fallback` está configurado com:

```json
{
  "maxAttempts": 2,              // Máximo 2 tentativas antes de escalar
  "confidenceThreshold": 0.7,     // Threshold de confiança (70%)
  "enableEmotionCheck": true,     // Detecta frustração do usuário
  "escalationMode": "ticket",     // Modo assíncrono (ticket)
  "queue": "suporte",             // Fila de destino
  "allowReturnToBot": true,       // Permite retorno ao bot após atendimento
  "safeReturnNode": "boas_vindas" // Nó para retornar
}
```

## 🔄 Fluxo de Escalação

```
Usuário no WhatsApp
    ↓
Bot processa mensagem
    ↓
Fallback detecta necessidade
    ↓
Cria ticket na fila "suporte"
    ↓
Bot suspende processamento
    ↓
Atendente assume no painel
    ↓
Comunicação bidirecional
    ↓
Atendente encerra ticket
    ↓
Bot retoma (se allowReturnToBot: true)
```

## 📝 Personalização

### Alterar Fila de Atendimento

Edite o nó `escalar_humano` e `fallback`:

```json
{
  "config": {
    "queue": "sua_fila_aqui"
  }
}
```

### Alterar Mensagens

Edite os nós do tipo `message` para personalizar as mensagens:
- `boas_vindas`
- `resposta_bot`
- `tentar_novamente`
- `opcoes`

### Ajustar Sensibilidade do Fallback

No nó `fallback`, ajuste:
- `maxAttempts`: Número de tentativas antes de escalar
- `confidenceThreshold`: Threshold de confiança (0.0 a 1.0)
- `enableEmotionCheck`: Ativar/desativar detecção de emoção

## 🐛 Troubleshooting

### Ticket não é criado

- Verifique se a fila "suporte" existe em `api/data/queues.json`
- Verifique os logs do servidor para erros
- Confirme que o WhatsApp está configurado corretamente

### Mensagens não chegam no painel

- Verifique se o auto-refresh está ativado (5 segundos)
- Confirme que o ticket está em status `in_progress`
- Verifique a conexão com a API

### Bot não retoma após atendimento

- Verifique se `allowReturnToBot` está como `true`
- Confirme que o `safeReturnNode` aponta para um nó válido
- Verifique se o atendente encerrou o ticket corretamente

## 📚 Referências

- [Documentação de Fallback](./FALLBACK_SYSTEM.md)
- [Integração WhatsApp ↔ Atendimento](./INTEGRACAO_WHATSAPP_ATENDIMENTO.md)
- [Guia de Acesso ao Atendimento](./GUIA_ACESSO_ATENDIMENTO.md)
- [Rotas de Atendimento](./ROTAS_ATENDIMENTO.md)

