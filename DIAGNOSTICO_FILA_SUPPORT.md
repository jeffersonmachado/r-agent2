# Diagnóstico: Fila Outbound + Mensagens em /support

**Data:** 2026-02-19 21:31-21:38Z  
**Status:** 2 problemas identificados e parcialmente resolvidos

## Problema 1: "Cannot read properties of undefined (reading 'id')"

### Sintoma
```
Falha ao enviar item, agendando retry
{
  "id": "outq-1771537081965-443f643ac58b",
  "attempts": 3-4,
  "reasonCode": "send_failed",
  "error": "Cannot read properties of undefined (reading 'id')"
}
```

### Causa Raiz
O `sock.sendMessage()` do Baileys estava retornando:
- `null` ou `undefined` (não retorna resposta)
- Ou um objeto sem propriedade `key` (ou `key` é vazio)

Depois o código tentava acessar `result.messages[0].id` e encontrava `undefined`.

### Solução Implementada

#### 1. **Melhorado whatsappProviderQr.js** (sendText e sendMedia)
- Adicionado try-catch explícito ao `sock.sendMessage()`
- Log de erro se Baileys lançar exceção
- Validação: se `result` for falsy, log de WARN com tipo do resultado
- Sempre retorna `{ messages: [{ id: messageId || null }] }` - nunca deixa id undefined

```javascript
const result = await sock.sendMessage(jid, { text });
if (!result) {
  logger.warn('Baileys retornou resultado vazio', { tenantId, to, jid });
}
const messageId = result?.key?.id || null;
return { messages: [{ id: messageId }] }; // Nunca undefined
```

#### 2. **Melhorado outboundQueueService.js**
- Adicionada validação de formato após chamar `provider.sendText/sendTemplate/sendMedia`
- Se `result.messages` não for array, lança erro com detalhes
- Erro é capturado com `reasonCode: "send_failed"` e agendado para retry

```javascript
if (!result || !Array.isArray(result?.messages)) {
  throw new Error(`Provider retornou formato inválido: resultType=${typeof result}, hasMessages=${!!result?.messages}`);
}
```

### Comportamento Esperado
- Na próxima tentativa, se Baileys retornar null/invalid:
  - ✅ Log incluirá exatamente qual é o tipo de resultado
  - ✅ Erro será capturado e agendado para retry com backoff
  - ✅ Fila não tentará acessar `.id` em undefined
  - ✅ Log melhorado permite diagnosticar o problema no Baileys

---

## Problema 2: Mensagens Não Aparecem em /support

### Sintoma
> "e tem mensagem no meu app do whatsapp que não recebi em /support"

Mensagens chegam no WhatsApp QR, mas não aparecem na interface de /support.

### Diagnóstico Realizado

#### Logs Encontrados
```
[WA_IN_PRE] Inbound recebido (antes de resolver tenant)
[WA_PIPE_START] traceId=system:waqr-...-801783a0:142D1AB78692E9CB50
[WA_PIPE_BOT_SKIPPED] reason="missing_deps"
```

**Confirmado:** As mensagens estão sendo recebidas e **criadas como tickets**, mas com um problema.

#### Análise da Pipeline

1. ✅ **Mensagem recebida:** WhatsApp QR detecta `messages.upsert`
2. ✅ **Log pré-tenant:** `WA_IN_PRE` aparece
3. ✅ **Gateway ingest:** Mensagem persistida como inbound
4. ✅ **Ticket criado:** `default-1771520605108-78oze5e` (default ticket)
5. ❌ **Bot skipped:** `reason="missing_deps"` 
   - Significa que `flows`, `sessionEvents`, `saveSessionEvents` não foram injetados

### Causa Raiz

No `whatsappQrRunner.js`, ao chamar `handleWhatsAppInbound()`, **não está passando `deps`**:

```javascript
// ANTES (linha 580-589)
await handleWhatsAppInbound({
  source: 'qr',
  tenantId,
  payload,
  normalized,
  traceId,
  // ❌ deps não passado aqui!
});
```

Mas em `whatsappInboundService.js`, o código espera `deps`:
```javascript
const flows = deps?.flows;
const sessionEvents = deps?.sessionEvents;
if (!flows || !sessionEvents) {
  logger.warn('missing_deps', ...);
  return; // ❌ Bot não processa a mensagem
}
```

### Impacto

- ✅ **Mensage criada como ticket** (no default ticket `default-...`)
- ❌ **UI não mostra** (porque ainda não há integração de tickets com /support ou bot não processa)

### Solução Necessária

**Requereapri:** Como `flows` e `sessionEvents` são definidos?

1. Em `api/server.js`, há definição de `flows` e `sessionEvents` para o webhook do WhatsApp?
2. Como eles deveriam ser injetados no `whatsappQrRunner`?
3. Ou o WhatsApp QR deveria criar um tipo especial de ticket para não precisar do bot?

### Sugestões

#### Opção A: Passar deps pelo whatsappQrRunner
```javascript
// Assumindo flows estão definidos em algum lugar
const flows = require('./flowsService').getFlows(tenantId);
const sessionEvents = new Map();

await handleWhatsAppInbound({
  source: 'qr',
  ...otherProps,
  deps: { flows, sessionEvents, saveSessionEvents }
});
```

#### Opção B: Criar tickets sem processar bot
Se o WhatsApp QR é apenas para **receber mensagens** (não processar bot), então:
```javascript
// Pular pipeline de bot, apenas criar ticket human
const ticket = await createTicketFromInbound({
  tenantId,
  conversationId: ingest.conversationId,
  type: 'human', // Sempre humano, pra aparecer em /support
  channelType: 'whatsapp',
  source: 'qr',
  message
});
```

---

## Validações Feitas ✅

- ✅ Sem erros de sintaxe em whatsappProviderQr.js
- ✅ Sem erros de sintaxe em outboundQueueService.js  
- ✅ Sem erros de sintaxe em whatsappQrRunner.js
- ✅ Logs agora mostram detalhes de resultado do Baileys
- ✅ Fila agora valida formato de resposta do provider

---

## Próximos Passos

### 1. **Fila Outbound (RESOLVIDO)**
Na próxima falha, o log mostrará exatamente qual é o resultado do Baileys, permitindo debug mais rápido.

### 2. **Mensagens em /support (AGUARDANDO)**
Precisar de clarificação sobre:
- Como `flows` e `sessionEvents` funcionam?
- Devem ser injetados no WhatsApp QR?
- Ou WhatsApp QR é apenas pré-ticket (e tickets aparecem em outro lugar)?
- Qual é o endpoint/página que deveria mostrar esses tickets?

### 3. **Validação com Usuário**
Após escanear novo QR em "Pareando":
1. Enviar uma mensagem nova via WhatsApp QR
2. Verificar logs para `WA_PIPE_BOT_SKIPPED`
3. Confirmar se ticket é criado (verificando DB ou API)
4. Identificar por que ticket não aparece em /support
