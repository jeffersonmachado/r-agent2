# 🧪 Guia Completo de Testes - Integração WhatsApp

Este guia fornece scripts automatizados e instruções para testar toda a integração com WhatsApp.

## 📋 Índice

1. [Pré-requisitos](#pré-requisitos)
2. [Scripts de Teste](#scripts-de-teste)
3. [Executando os Testes](#executando-os-testes)
4. [Testes Individuais](#testes-individuais)
5. [Testes de Integração Completa](#testes-de-integração-completa)
6. [Troubleshooting](#troubleshooting)

---

## 🔧 Pré-requisitos

### 1. Configurar Credenciais

Edite `api/data/config.json`:

```json
{
  "whatsapp": {
    "apiUrl": "https://graph.facebook.com/v18.0",
    "phoneNumberId": "SEU_PHONE_NUMBER_ID",
    "accessToken": "SEU_ACCESS_TOKEN",
    "verifyToken": "seu_token_de_verificacao_webhook"
  },
  "flows": {
    "defaultFlowId": "ID_DO_FLUXO_PADRAO"
  }
}
```

### 2. Criar Fila de Teste

```bash
# Via API
curl -X POST http://localhost:3000/queues \
  -H "Content-Type: application/json" \
  -d '{"name": "suporte"}'

# Ou edite api/data/queues.json diretamente
```

### 3. Iniciar Servidor

```bash
cd api
npm start
```

O servidor deve estar rodando em `http://localhost:3000`

---

## 🧪 Scripts de Teste

### Scripts Disponíveis

1. **test-whatsapp-webhook.js** - Testa verificação do webhook
2. **test-whatsapp-send.js** - Testa envio de mensagens
3. **test-whatsapp-receive.js** - Simula recebimento de mensagens
4. **test-ticket-creation.js** - Testa criação de tickets
5. **test-whatsapp-integration.js** - Executa todos os testes em sequência

---

## 🚀 Executando os Testes

### Teste Completo (Recomendado)

Execute todos os testes em sequência:

```bash
cd scripts
chmod +x test-whatsapp-integration.js
node test-whatsapp-integration.js
```

### Testes Individuais

#### 1. Teste de Verificação do Webhook

```bash
cd scripts
node test-whatsapp-webhook.js
```

**O que testa:**
- Verificação do webhook do Meta
- Retorno correto do challenge

**Resultado esperado:**
```
✅ Webhook verificado com sucesso!
   Status: 200
   Challenge retornado: 1234567890
```

#### 2. Teste de Envio de Mensagem

```bash
cd scripts
node test-whatsapp-send.js [NUMERO] [MENSAGEM]
```

**Exemplo:**
```bash
node test-whatsapp-send.js 5511999999999 "Teste de mensagem"
```

**O que testa:**
- Envio de mensagem via WhatsApp Cloud API
- Validação de credenciais

**Resultado esperado:**
```
✅ Mensagem enviada com sucesso!
   Resultado: { "messages": [{ "id": "wamid.xxx" }] }
```

#### 3. Teste de Recebimento de Mensagem

```bash
cd scripts
node test-whatsapp-receive.js [NUMERO] [MENSAGEM]
```

**Exemplo:**
```bash
node test-whatsapp-receive.js 5511999999999 "Olá, preciso de ajuda!"
```

**O que testa:**
- Processamento de webhook do WhatsApp
- Criação de sessão
- Processamento pelo bot

**Resultado esperado:**
```
✅ Webhook processado com sucesso!
   Status: 200
   Resposta: {"success":true}
```

#### 4. Teste de Criação de Ticket

```bash
cd scripts
node test-ticket-creation.js [FILA] [SESSION_ID] [MENSAGEM]
```

**Exemplo:**
```bash
node test-ticket-creation.js suporte whatsapp_5511999999999 "Preciso de ajuda"
```

**O que testa:**
- Criação de ticket
- Listagem de tickets
- Preservação de contexto

**Resultado esperado:**
```
✅ Ticket criado com sucesso!
   ID: suporte-1234567890-abc123
   Status: waiting
   Fila: suporte

✅ Encontrados 1 ticket(s) na fila
   1. suporte-1234567890-abc123 - waiting - Preciso de ajuda
```

---

## 🔄 Testes de Integração Completa

### Cenário 1: Fluxo Completo de Atendimento

1. **Enviar mensagem do usuário:**
   ```bash
   node scripts/test-whatsapp-receive.js 5511999999999 "quero falar com um atendente"
   ```

2. **Verificar ticket criado:**
   ```bash
   curl http://localhost:3000/queues/suporte/tickets
   ```

3. **Atribuir ticket (via interface ou API):**
   ```bash
   curl -X POST http://localhost:3000/tickets/TICKET_ID/assign \
     -H "Content-Type: application/json" \
     -d '{"assignedTo": "atendente_teste"}'
   ```

4. **Enviar mensagem do atendente:**
   ```bash
   curl -X POST http://localhost:3000/tickets/TICKET_ID/message \
     -H "Content-Type: application/json" \
     -d '{"message": "Olá! Como posso ajudar?"}'
   ```

5. **Verificar histórico:**
   ```bash
   curl http://localhost:3000/tickets/TICKET_ID/messages
   ```

### Cenário 2: Fallback Automático

1. **Enviar mensagens que o bot não entende:**
   ```bash
   node scripts/test-whatsapp-receive.js 5511999999999 "asdfghjkl"
   node scripts/test-whatsapp-receive.js 5511999999999 "xyzabc"
   node scripts/test-whatsapp-receive.js 5511999999999 "123456"
   ```

2. **Verificar escalação automática:**
   - Após 2-3 tentativas, fallback deve escalar
   - Ticket deve ser criado automaticamente
   - Verificar logs do servidor

### Cenário 3: Comunicação Bidirecional

1. **Criar ticket manualmente:**
   ```bash
   node scripts/test-ticket-creation.js suporte whatsapp_5511999999999 "Teste bidirecional"
   ```

2. **Enviar mensagem do usuário (simular):**
   ```bash
   node scripts/test-whatsapp-receive.js 5511999999999 "Mensagem do usuário durante atendimento"
   ```

3. **Verificar que mensagem foi adicionada ao histórico:**
   ```bash
   # Obter ID do ticket criado
   TICKET_ID=$(curl -s http://localhost:3000/queues/suporte/tickets | jq -r '.[0].id')
   
   # Verificar histórico
   curl http://localhost:3000/tickets/$TICKET_ID/messages
   ```

4. **Enviar mensagem do atendente:**
   ```bash
   curl -X POST http://localhost:3000/tickets/$TICKET_ID/message \
     -H "Content-Type: application/json" \
     -d '{"message": "Resposta do atendente"}'
   ```

---

## 🐛 Troubleshooting

### Erro: "Servidor não está rodando"

**Solução:**
```bash
cd api
npm start
```

Verifique se o servidor está respondendo:
```bash
curl http://localhost:3000/health
```

### Erro: "Credenciais do WhatsApp não configuradas"

**Solução:**
1. Edite `api/data/config.json`
2. Configure `whatsapp.phoneNumberId` e `whatsapp.accessToken`
3. Reinicie o servidor

### Erro: "Webhook não verifica"

**Solução:**
1. Verifique `whatsapp.verifyToken` no config
2. Use o mesmo token no painel do Meta
3. Certifique-se de que a URL está acessível publicamente

### Erro: "Fila não encontrada"

**Solução:**
```bash
# Criar fila
curl -X POST http://localhost:3000/queues \
  -H "Content-Type: application/json" \
  -d '{"name": "suporte"}'
```

### Erro: "Mensagem não enviada"

**Solução:**
1. Verifique credenciais do WhatsApp
2. Verifique se o número está no formato correto (sem +, sem espaços)
3. Verifique logs do servidor para erros da API

---

## 📊 Checklist de Testes

### Testes Básicos
- [ ] Webhook verificado com sucesso
- [ ] Mensagem enviada via API
- [ ] Mensagem recebida e processada
- [ ] Bot responde corretamente

### Testes de Escalação
- [ ] Escalação direta cria ticket
- [ ] Fallback automático cria ticket
- [ ] Contexto preservado no ticket
- [ ] Bot suspende durante atendimento

### Testes de Atendimento
- [ ] Mensagens do usuário aparecem na interface
- [ ] Mensagens do atendente são enviadas
- [ ] Histórico completo preservado
- [ ] Badges de não lidas funcionam

### Testes de Integração
- [ ] Comunicação bidirecional funcionando
- [ ] Múltiplos tickets simultâneos
- [ ] Fechamento de ticket funciona

---

## 🔍 Verificação Manual

### Verificar Logs do Servidor

Os logs devem mostrar:
```
[HANDOFF] Ticket criado: suporte-1234567890-abc123 na fila "suporte" para sessão whatsapp_5511999999999
```

### Verificar Interface Web

1. Acesse: `http://localhost:3000/support`
2. Selecione a fila "suporte"
3. Verifique se os tickets aparecem
4. Teste envio de mensagens

### Verificar APIs

```bash
# Health check
curl http://localhost:3000/health

# Listar filas
curl http://localhost:3000/queues

# Listar tickets
curl http://localhost:3000/queues/suporte/tickets

# Obter ticket específico
curl http://localhost:3000/tickets/TICKET_ID
```

---

## 📚 Referências

- [Documentação de Integração WhatsApp](./INTEGRACAO_WHATSAPP_ATENDIMENTO.md)
- [Template de Teste](./TEMPLATE_TESTE_WHATSAPP.md)
- [Guia de Acesso ao Atendimento](./GUIA_ACESSO_ATENDIMENTO.md)
- [Rotas de Atendimento](./ROTAS_ATENDIMENTO.md)

---

## ✅ Resultado Esperado

Após executar todos os testes, você deve ver:

```
🚀 Executando Testes de Integração WhatsApp
============================================================

📋 Teste 1/3: Verificação do Webhook
------------------------------------------------------------
✅ Webhook verificado com sucesso!

✅ Verificação do Webhook: PASSOU

📋 Teste 2/3: Criação de Ticket
------------------------------------------------------------
✅ Ticket criado com sucesso!
✅ Encontrados 1 ticket(s) na fila

✅ Criação de Ticket: PASSOU

📋 Teste 3/3: Recebimento de Mensagem
------------------------------------------------------------
✅ Webhook processado com sucesso!

✅ Recebimento de Mensagem: PASSOU

============================================================
📊 RESUMO DOS TESTES
============================================================

✅ 1. Verificação do Webhook
✅ 2. Criação de Ticket
✅ 3. Recebimento de Mensagem

------------------------------------------------------------
Total: 3 | Passou: 3 | Falhou: 0
------------------------------------------------------------

🎉 Todos os testes passaram!
```

