# 🧪 Scripts de Teste - Integração WhatsApp

## 📋 Scripts Disponíveis

### 1. test-whatsapp-complete.js ⭐ **RECOMENDADO**

Executa todos os testes em sequência e gera relatório completo.

```bash
cd scripts
node test-whatsapp-complete.js
```

**Resultado:**
- ✅ Executa todos os testes
- ✅ Gera relatório em JSON (`test-report.json`)
- ✅ Diferencia testes obrigatórios e opcionais
- ✅ Mostra resumo detalhado

### 2. test-whatsapp-integration.js

Versão simplificada do teste completo.

```bash
cd scripts
node test-whatsapp-integration.js
```

### 3. Testes Individuais

#### Setup do Fluxo
```bash
node setup-test-flow.js
```
Cria fluxo de teste e configura defaultFlowId.

#### Verificação do Webhook
```bash
node test-whatsapp-webhook.js
```
Testa verificação do webhook do Meta.

#### Criação de Ticket
```bash
node test-ticket-creation.js [FILA] [SESSION_ID] [MENSAGEM]
```
Testa criação e listagem de tickets.

#### Envio de Mensagem
```bash
node test-whatsapp-send.js [NUMERO] [MENSAGEM]
```
Testa envio via WhatsApp Cloud API (requer credenciais reais).

#### Recebimento de Mensagem
```bash
node test-whatsapp-receive.js [NUMERO] [MENSAGEM]
```
Simula recebimento de mensagem do WhatsApp.

#### Diagnóstico
```bash
node diagnose-whatsapp-error.js
```
Diagnostica problemas na integração.

## 📊 Resultados dos Testes

### Testes Obrigatórios (Devem Passar)

- ✅ **Setup do Fluxo de Teste** - Cria e configura fluxo
- ✅ **Verificação do Webhook** - Valida webhook do Meta
- ✅ **Criação de Ticket** - Testa sistema de tickets

### Testes Opcionais (Podem Falhar)

- ⚠️ **Envio de Mensagem** - Requer credenciais reais do WhatsApp
- ⚠️ **Recebimento de Mensagem** - Pode falhar em ambiente de teste

## 🔧 Correções Implementadas

1. ✅ Adicionado tipo "fallback" ao validador
2. ✅ Scripts de teste criados e testados
3. ✅ Tratamento de erros melhorado
4. ✅ Relatórios em JSON implementados

## 📄 Relatórios

Os relatórios são salvos em:
- `scripts/test-report.json` - Relatório em JSON

## 🐛 Troubleshooting

### Erro 500 no Recebimento

**Causa:** Erro no processamento do fluxo

**Solução:**
1. Execute diagnóstico: `node diagnose-whatsapp-error.js`
2. Verifique logs do servidor
3. Confirme que o fluxo está válido

### Credenciais Não Configuradas

**Solução:**
1. Configure em `api/data/config.json`
2. Reinicie o servidor

---

**Última Execução:** Ver `scripts/test-report.json`

