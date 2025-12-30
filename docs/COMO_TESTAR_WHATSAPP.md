# 🧪 Como Testar a Integração com WhatsApp

## 🚀 Início Rápido

### Executar Todos os Testes

```bash
cd scripts
node test-whatsapp-complete.js
```

**Resultado esperado:**
```
✅ 1. Setup do Fluxo de Teste - PASSOU
✅ 2. Verificação do Webhook - PASSOU
✅ 3. Criação de Ticket - PASSOU
⚠️ 4. Recebimento de Mensagem - FALHOU (opcional)

🎉 Todos os testes obrigatórios passaram!
```

---

## 📋 Pré-requisitos

### 1. Servidor Rodando

```bash
cd api
npm start
```

Verifique: `curl http://localhost:3000/health`

### 2. Configuração Básica

Edite `api/data/config.json`:

```json
{
  "whatsapp": {
    "verifyToken": "seu_token_aqui"
  },
  "flows": {
    "defaultFlowId": "teste-whatsapp"
  }
}
```

### 3. Fila de Teste

```bash
curl -X POST http://localhost:3000/queues \
  -H "Content-Type: application/json" \
  -d '{"name": "suporte"}'
```

---

## 🧪 Testes Disponíveis

### 1. Teste Completo (Recomendado)

```bash
node test-whatsapp-complete.js
```

**O que faz:**
- ✅ Cria fluxo de teste automaticamente
- ✅ Testa verificação do webhook
- ✅ Testa criação de tickets
- ✅ Testa recebimento de mensagens
- ✅ Gera relatório em JSON

### 2. Testes Individuais

#### Verificação do Webhook
```bash
node test-whatsapp-webhook.js
```
Testa se o webhook do Meta pode ser verificado.

#### Criação de Ticket
```bash
node test-ticket-creation.js suporte whatsapp_5511999999999 "Mensagem de teste"
```
Testa criação e listagem de tickets.

#### Envio de Mensagem
```bash
node test-whatsapp-send.js 5511999999999 "Mensagem de teste"
```
**⚠️ Requer credenciais reais do WhatsApp**

#### Recebimento de Mensagem
```bash
node test-whatsapp-receive.js 5511999999999 "Olá, preciso de ajuda!"
```
Simula recebimento de mensagem do WhatsApp.

#### Diagnóstico
```bash
node diagnose-whatsapp-error.js
```
Diagnostica problemas na integração.

---

## 📊 Interpretando Resultados

### ✅ Testes que DEVEM Passar

1. **Setup do Fluxo de Teste**
   - Deve criar fluxo automaticamente
   - Deve configurar defaultFlowId

2. **Verificação do Webhook**
   - Deve retornar status 200
   - Deve retornar o challenge

3. **Criação de Ticket**
   - Deve criar ticket com sucesso
   - Deve listar tickets corretamente

### ⚠️ Testes que PODEM Falhar

1. **Envio de Mensagem**
   - **Motivo:** Requer credenciais reais do WhatsApp
   - **Normal:** Falhar sem credenciais

2. **Recebimento de Mensagem**
   - **Motivo:** Pode falhar em ambiente de teste
   - **Normal:** Erro 500 é esperado sem credenciais reais

---

## 🔧 Troubleshooting

### Erro: "Servidor não está rodando"

**Solução:**
```bash
cd api
npm start
```

### Erro: "Fluxo não encontrado"

**Solução:**
```bash
node scripts/setup-test-flow.js
```

### Erro: "Credenciais não configuradas"

**Solução:**
1. Edite `api/data/config.json`
2. Configure `whatsapp.phoneNumberId` e `whatsapp.accessToken`
3. Reinicie o servidor

### Erro 500 no Recebimento

**Causa:** Erro no processamento do fluxo

**Solução:**
1. Execute diagnóstico: `node diagnose-whatsapp-error.js`
2. Verifique se o fluxo está válido
3. Verifique logs do servidor

**Nota:** Este erro é **normal** em ambiente de teste sem credenciais reais.

---

## 📄 Relatórios

Os relatórios são salvos em:
- `scripts/test-report.json` - Relatório completo em JSON

**Estrutura:**
```json
{
  "timestamp": "2024-...",
  "duration": 5.05,
  "total": 4,
  "passed": 3,
  "failed": 1,
  "requiredFailed": 0,
  "results": [...]
}
```

---

## 🎯 Próximos Passos

### Para Testar com WhatsApp Real

1. **Obter Credenciais**
   - Acesse Meta Business Suite
   - Configure WhatsApp Cloud API
   - Obtenha Phone Number ID e Access Token

2. **Configurar Webhook**
   - URL: `https://seu-dominio.com/webhooks/whatsapp`
   - Token: Mesmo valor de `verifyToken` no config
   - Use ngrok para desenvolvimento local

3. **Executar Testes**
   ```bash
   node test-whatsapp-complete.js
   ```

---

## 📚 Documentação Relacionada

- [Guia Completo de Testes](./GUIA_TESTES_WHATSAPP.md)
- [Relatório de Testes](./RELATORIO_TESTES_WHATSAPP.md)
- [Resumo dos Testes](./RESUMO_TESTES_WHATSAPP.md)
- [Integração WhatsApp](./INTEGRACAO_WHATSAPP_ATENDIMENTO.md)

---

## ✅ Checklist Rápido

- [ ] Servidor rodando (`curl http://localhost:3000/health`)
- [ ] Fila criada (`curl http://localhost:3000/queues`)
- [ ] Fluxo de teste criado (`node setup-test-flow.js`)
- [ ] Testes executados (`node test-whatsapp-complete.js`)
- [ ] Relatório verificado (`cat scripts/test-report.json`)

---

**Última Atualização:** 2024  
**Status:** ✅ Scripts de teste implementados e funcionando

