# 🔄 Migração de Console para Logger

## ✅ Mudanças Implementadas

### 1. Logger Criado

**Arquivo:** `api/utils/logger.js`

Sistema de logging profissional com:
- Níveis: DEBUG, INFO, WARN, ERROR
- Formatação com timestamp e nível
- Suporte a objetos e erros
- Configurável via variável de ambiente `LOG_LEVEL`

### 2. Arquivos Atualizados

#### ✅ `api/services/whatsappService.js`
- Substituído `console.warn` por `logger.warn`

#### ✅ `api/services/messageProcessor.js`
- Substituído todas as chamadas de `console.log`, `console.error` por `logger`
- Uso apropriado dos níveis:
  - `logger.debug()` - Mensagens de debug
  - `logger.info()` - Informações importantes
  - `logger.error()` - Erros

#### ✅ `api/server.js`
- Substituído chamadas principais de `console` por `logger`
- Webhook WhatsApp agora usa `logger.error()`

---

## 📋 Uso do Logger

### Importar

```javascript
const logger = require('./utils/logger');
```

### Métodos Disponíveis

```javascript
// Debug (apenas em desenvolvimento)
logger.debug('Mensagem de debug', data);

// Informação
logger.info('Mensagem informativa', data);

// Aviso
logger.warn('Mensagem de aviso', data);

// Erro
logger.error('Mensagem de erro', error);

// Evento estruturado
logger.event('event_type', { key: 'value' });
```

### Configurar Nível

```bash
# Via variável de ambiente
export LOG_LEVEL=0  # DEBUG
export LOG_LEVEL=1  # INFO (padrão em produção)
export LOG_LEVEL=2  # WARN
export LOG_LEVEL=3  # ERROR
export LOG_LEVEL=4  # NONE (sem logs)
```

---

## 🔍 Formato dos Logs

### Exemplo de Saída

```
[2025-12-30T11:03:59.727Z] [INFO] Mensagem informativa
[2025-12-30T11:03:59.736Z] [ERROR] Mensagem de erro
{
  "message": "Erro de teste",
  "stack": "Error: Erro de teste\n    at ..."
}
```

### Estrutura

- **Timestamp:** ISO 8601
- **Nível:** DEBUG, INFO, WARN, ERROR
- **Mensagem:** Texto da mensagem
- **Dados:** Objeto JSON formatado (se fornecido)

---

## ⚠️ Chamadas de Console Restantes

Algumas chamadas de `console` ainda existem em `api/server.js` para:
- Logs de inicialização do servidor
- Logs de configuração
- Logs que são específicos do Node.js

Essas podem ser migradas gradualmente conforme necessário.

---

## ✅ Benefícios

1. **Formatação Consistente:** Todos os logs têm formato padronizado
2. **Níveis de Log:** Controle fino sobre o que é logado
3. **Melhor Debugging:** Stack traces formatados para erros
4. **Produção Ready:** Fácil configurar nível de log por ambiente
5. **Estruturado:** Suporte a objetos e eventos estruturados

---

## 📚 Referências

- [Logger Frontend](../frontend/src/utils/logger.js) - Logger do frontend (ES modules)
- [Logger Backend](./api/utils/logger.js) - Logger do backend (CommonJS)

---

**Status:** ✅ **MIGRAÇÃO CONCLUÍDA**

**Arquivos Migrados:**
- ✅ `api/services/whatsappService.js`
- ✅ `api/services/messageProcessor.js`
- ✅ `api/server.js` (parcial)

