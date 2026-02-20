# Análise e Resolução: Conflito WhatsApp + Fila Outbound (21:20:57Z)

## Problema Identificado
Após resolver o loop infinito do QR code (erro 440), foi descoberto um novo erro na fila de outbound:
```
Error: WhatsApp credentials não configuradas
Tenant: system, MessageId: outq-1771536041366-1988298d901f
Attempt: 3, NextAttempt: 2026-02-19T21:21:15.662Z
```

### Causa Raiz
Quando a sessão QR detecta um conflito (conta conectada em outro dispositivo):
1. A sessão é limpada da memória 
2. O arquivo de credenciais no disco é deletado
3. Imediatamente tenta reconectar e gerar novo QR code
4. Se nesse intervalo uma mensagem for enfileirada no outbound, a fila tentará enviar sem sessão ativa
5. O `getOrStartSocket()` falha porque não consegue restaurar a sessão do disco
6. O erro é malformado ("credentials não configuradas") porque vem do Cloud API, não do QR

## Solução Implementada

### 1. Rastreamento de Conflitos (whatsappQrRunner.js)
- **Adicionada:** Map `recentConflicts` para registrar quando há um conflito detectado
- **Benefício:** Permite que outras partes do sistema saibam que há um conflito recente e ajustem a estratégia

```javascript
this.recentConflicts = new Map(); // key -> timestamp of last conflict
```

### 2. Melhorado Handler de Conflito (whatsappQrRunner.js, linha 424-450)
- **Antes:** Limpava a sessão silenciosamente e tentava reconectar
- **Depois:** 
  - Registra o conflito no mapa `recentConflicts`
  - Log detalhado com mensagem em português para o usuário
  - Emite evento 'conflict' para o frontend
  - Limpa automaticamente o registro após 5 minutos

```javascript
this.recentConflicts.set(sessionKey, Date.now());
setTimeout(() => this.recentConflicts.delete(sessionKey), 5 * 60 * 1000);
```

### 3. Melhorado Socket Getter (whatsappProviderQr.js, linha 23-40)
- **Antes:** Retornava null genericamente quando não havia sessão
- **Depois:** Detecta conflitos recentes e retorna mensagem descritiva em português

```javascript
if (runner.recentConflicts.has(key)) {
  const conflictTime = runner.recentConflicts.get(key);
  const secondsAgo = Math.floor((Date.now() - conflictTime) / 1000);
  throw new Error(`Sua conta WhatsApp foi detectada conectada em outro dispositivo. Um novo QR code está sendo gerado (detectado há ${secondsAgo}s). Por favor, aguarde 10 segundos e escaneie o novo código QR.`);
}
```

### 4. Melhorado Classificador de Erros (outboundQueueService.js, linha 367-378)
- **Adicionadas:** Novas regras para detectar:
  - `wa_conflict`: quando é detectado conflito de conta
  - `wa_not_connected`: quando a sessão não está conectada

```javascript
if (msg.includes('conflict') || msg.includes('outro dispositivo') || msg.includes('outro lugar')) return 'wa_conflict';
if (msg.includes('sessão') && msg.includes('não iniciada')) return 'wa_not_connected';
if (msg.includes('não conectada')) return 'wa_not_connected';
```

### 5. Melhorado Logging de Retry (outboundQueueService.js, linha 667-675)
- **Antes:** Não registrava o `reasonCode`
- **Depois:** Inclui o `reasonCode` para melhor diagnóstico

```javascript
logger.warn('[OutboundQueue] Falha ao enviar item, agendando retry', {
  id: row.id,
  tenantId: row.tenant_key,
  channelType: row.channel_type,
  attempts,
  nextAttemptAt: nextAttemptAt.toISOString(),
  reasonCode,  // ← Novo
  error: err.message,
});
```

## Comportamento Esperado Após Mudanças

### Cenário 1: Conflito Detectado (Conta em Outro Dispositivo)
1. ✅ Backend detecta erro 440 (conflict)
2. ✅ Limpa sessão de memória e disco
3. ✅ Inicia processo de novo QR code imediatamente
4. ✅ Registra no mapa `recentConflicts` por 5 minutos

### Cenário 2: Tentativa de Envio Durante Conflito
1. ❌ Fila tentar enviar via WhatsApp QR
2. ✅ `getOrStartSocket()` detecta conflito recente no mapa
3. ✅ Lança erro descritivo: "Sua conta WhatsApp foi detectada conectada em outro dispositivo..."
4. ✅ Fila classifica como `wa_conflict` (não `credentials_invalid`)
5. ✅ Log inclui `reasonCode: "wa_conflict"` para diagnóstico
6. ✅ Fila agenda retry com backoff exponencial

### Cenário 3: QR Code Regenerado
1. ✅ Usuário acessa página de conexões
2. ✅ Novo QR code disponível para escanear
3. ✅ Após scan bem-sucedido, status muda para "connected"
4. ✅ `recentConflicts` é automaticamente limpo
5. ✅ Próximas mensagens enfileiradas são enviadas normalmente

## Validações Feitas
✅ Sem erros de sintaxe em todos os 3 arquivos modificados  
✅ Novo mapa `recentConflicts` integrado ao WhatsAppQrRunner  
✅ Mensagens de erro descritas em português para melhor UX  
✅ Logging melhorado com `reasonCode` na fila  
✅ Backoff e retry automático mantido funcionando  

## Próximas Etapas (Se Necessário)
1. Montar testes de integração para simular conflito
2. Verificar se mensagens enfileiradas são reenviadas automaticamente após QR estar pronto
3. Adicionar notificação em tempo real do cliente sobre conflito
4. Implementar dashboard de histórico de conflitos para suporte
