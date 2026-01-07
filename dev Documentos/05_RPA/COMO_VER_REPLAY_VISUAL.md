# Como Ver o Replay Visualmente

Este guia mostra como visualizar o replay de conversas de forma clara, mostrando as mensagens do bot e o que o usuário digitou.

## 🚀 Método Rápido

### Script Visual (Recomendado)

```bash
# Simula um fluxo e mostra o replay visualmente
./scripts/ver-replay.sh

# Ou ver replay de uma sessão específica
./scripts/ver-replay.sh session-1234567890
```

O script mostra:
- 🤖 **Mensagens do Bot** (em verde) - O que o bot enviou
- 👤 **Mensagens do Usuário** (em azul) - O que o usuário digitou
- ⏰ **Timestamps** - Quando cada mensagem foi enviada
- 📍 **Nós visitados** - Quais nós do fluxo foram executados
- 🔄 **Handoffs** - Transferências para atendimento humano

## 📱 Exemplo de Saída

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    📱 REPLAY DA CONVERSA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Informações:
   Session ID: sim-tenant-demo-flow-welcome-1234567890
   Flow ID: flow-welcome
   Total de mensagens: 3

💬 HISTÓRICO DA CONVERSA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────────────┐
│ 🤖 BOT [12:00:01]
│
│ Olá! 👋 Bem-vindo ao nosso atendimento.
│
│ Como posso ajudá-lo hoje?
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 👤 USUÁRIO [12:00:15]
│
│ Preciso de ajuda com meu pedido
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 🤖 BOT [12:00:16]
│
│ Vou te ajudar com suporte. Qual é o seu problema?
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Métodos Alternativos

### 1. Via cURL + jq

```bash
# Simular fluxo
RESPONSE=$(curl -s -X POST http://localhost:3000/flows/simulate \
  -H "Content-Type: application/json" \
  -d '{"flowId": "flow-welcome", "maxSteps": 20}')

# Extrair sessionId
SESSION_ID=$(echo $RESPONSE | jq -r '.replay.sessionId')

# Ver mensagens formatadas
curl -s -X GET http://localhost:3000/replay/$SESSION_ID | \
  jq -r '.messages[] | 
    if .from == "bot" then
      "🤖 BOT: " + .text + "\n   ⏰ " + .at
    elif .from == "user" then
      "👤 USUÁRIO: " + .text + "\n   ⏰ " + .at
    else
      "⚙️  SISTEMA: " + .text + "\n   ⏰ " + .at
    end
  '
```

### 2. Via API Diretamente

```bash
# Buscar replay
curl -X GET http://localhost:3000/replay/session-1234567890 | jq '.messages'
```

### 3. Via Frontend

Se o frontend estiver rodando, acesse:
- Interface de simulação
- Visualizador de replay
- Timeline da conversa

## 📊 Estrutura das Mensagens

Cada mensagem no replay contém:

```json
{
  "from": "bot" | "user" | "system",
  "text": "Texto da mensagem",
  "at": "2026-01-02T12:00:00.000Z"
}
```

### Tipos de Mensagens

- **`bot`**: Mensagens enviadas pelo bot (MESSAGE_OUT)
- **`user`**: Mensagens digitadas pelo usuário (MESSAGE_IN)
- **`system`**: Mensagens do sistema (handoffs, erros, etc.)

## 🎯 Casos de Uso

### Debug de Conversas
Veja exatamente o que o bot disse e o que o usuário respondeu em cada momento.

### Análise de Fluxos
Entenda como os usuários interagem com o bot e onde podem estar tendo problemas.

### Treinamento
Use os replays para treinar novos agentes mostrando exemplos reais de conversas.

### Auditoria
Mantenha um registro completo de todas as conversas para análise posterior.

## 🔍 Informações Adicionais no Replay

Além das mensagens, o replay também contém:

- **`handoffs`**: Transferências para atendimento humano
  ```json
  {
    "queue": "suporte",
    "at": "2026-01-02T12:05:00.000Z"
  }
  ```

- **`nodesVisited`**: Nós do fluxo que foram executados
  ```json
  {
    "nodeId": "welcome_message",
    "at": "2026-01-02T12:00:01.000Z"
  }
  ```

- **`rawEvents`**: Todos os eventos da engine (para análise técnica)

## 💡 Dicas

1. **Use o script visual**: É a forma mais fácil de ver a conversa
2. **Salve sessionIds importantes**: Para revisar conversas específicas depois
3. **Combine com logs**: Use os eventos raw para análise técnica detalhada
4. **Exporte para análise**: Salve o JSON do replay para análise em outras ferramentas

## 🛠️ Troubleshooting

### "Sessão não encontrada"
- A sessão pode ter expirado (eventos são armazenados em memória)
- Verifique se o sessionId está correto
- Simule novamente para gerar uma nova sessão

### "Nenhuma mensagem encontrada"
- O fluxo pode não ter gerado eventos MESSAGE_OUT ou MESSAGE_IN
- Verifique os `rawEvents` para ver o que aconteceu
- Alguns fluxos podem não ter mensagens se terminarem rapidamente

### Script não funciona
- Certifique-se de que `jq` está instalado: `sudo apt-get install jq`
- Verifique se o servidor está rodando: `npm start`
- Verifique a URL da API: `API_URL=http://localhost:3001 ./scripts/ver-replay.sh`

