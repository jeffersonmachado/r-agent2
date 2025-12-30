# 🔄 Reiniciar Servidor

## 📋 Funcionalidade

A interface de configuração agora possui um botão para reiniciar o servidor da API.

## 🎯 Como Usar

1. Acesse a página de **Configuração** (`/config`)
2. Clique no botão **"🔄 Reiniciar Servidor"** na toolbar
3. Confirme a ação no diálogo
4. O servidor será encerrado e reiniciado (se estiver usando PM2, nodemon, etc.)

## ⚠️ Importante

### Requisitos para Reinício Automático

O botão encerra o processo do servidor (`process.exit(0)`). Para que o servidor reinicie automaticamente, você precisa usar um gerenciador de processos:

#### Opção 1: PM2 (Recomendado para Produção)

```bash
# Instalar PM2
npm install -g pm2

# Iniciar servidor com PM2
pm2 start api/server.js --name r-agent2

# O servidor reiniciará automaticamente quando encerrado
```

#### Opção 2: Nodemon (Desenvolvimento)

```bash
# Instalar nodemon
npm install -g nodemon

# Iniciar com nodemon
nodemon api/server.js

# O servidor reiniciará automaticamente quando encerrado
```

#### Opção 3: Script de Inicialização

Crie um script que reinicia automaticamente:

```bash
#!/bin/bash
# restart.sh
while true; do
  node api/server.js
  echo "Servidor encerrado. Reiniciando em 2 segundos..."
  sleep 2
done
```

### Sem Gerenciador de Processos

Se você não estiver usando PM2, nodemon ou similar:
- ⚠️ O servidor **não reiniciará automaticamente**
- Você precisará iniciá-lo manualmente novamente
- Use `npm start` ou `node api/server.js`

## 🔧 Implementação Técnica

### Endpoint da API

**POST** `/server/restart`

```javascript
// Resposta
{
  "success": true,
  "message": "Servidor será reiniciado em breve",
  "note": "Se estiver usando PM2 ou similar, o servidor será reiniciado automaticamente"
}
```

### Código do Servidor

O servidor encerra graciosamente após 500ms:

```javascript
// api/server.js
if (method === 'POST' && pathname === '/server/restart') {
  logger.info('Reinício do servidor solicitado via API');
  
  sendJson(res, 200, { success: true, message: '...' });
  
  setTimeout(() => {
    logger.info('Encerrando servidor para reinício...');
    process.exit(0); // Código 0 para reinício limpo
  }, 500);
}
```

### Interface Frontend

```javascript
// frontend/src/pages/ConfigPage.jsx
const handleRestart = async () => {
  if (!confirm('⚠️ ATENÇÃO: ...')) {
    return;
  }
  
  await restartServer();
  showToast('Servidor sendo reiniciado...');
  
  setTimeout(() => {
    window.location.reload();
  }, 3000);
};
```

## 📊 Fluxo de Reinício

1. **Usuário clica no botão** → Confirmação
2. **Frontend chama API** → `POST /server/restart`
3. **Servidor responde** → 200 OK
4. **Servidor encerra** → `process.exit(0)` após 500ms
5. **Gerenciador detecta** → Reinicia automaticamente (PM2/nodemon)
6. **Frontend recarrega** → Após 3 segundos

## 🛡️ Segurança

- ⚠️ **Apenas para uso interno** - Não exponha esta rota publicamente
- ⚠️ **Requer confirmação** - Diálogo de confirmação antes de reiniciar
- ⚠️ **Logs registrados** - Todas as tentativas são logadas

## 🔍 Troubleshooting

### Servidor não reinicia automaticamente

**Problema:** Servidor não reinicia após clicar no botão

**Solução:**
1. Verifique se está usando PM2 ou nodemon
2. Se não estiver, instale e configure:
   ```bash
   npm install -g pm2
   pm2 start api/server.js --name r-agent2
   ```

### Erro ao chamar endpoint

**Problema:** Erro ao tentar reiniciar

**Solução:**
- O erro é esperado (servidor está sendo encerrado)
- A página será recarregada automaticamente
- Verifique se o servidor reiniciou corretamente

### Página não recarrega

**Problema:** Página não recarrega após reinício

**Solução:**
- Recarregue manualmente (F5)
- Verifique se o servidor está rodando novamente

---

**Status:** ✅ **IMPLEMENTADO E FUNCIONANDO**

**Última Atualização:** 2024

