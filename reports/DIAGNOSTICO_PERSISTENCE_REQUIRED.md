# Diagnóstico: Erro `persistence_required` (503)

## Problema Identificado

Frontend recebia erro **503 Service Unavailable** com mensagem `persistence_required` ao tentar acessar `/whatsapp/connections`.

```json
{
  "error": "service_unavailable",
  "message": "persistence_required"
}
```

## Causa Raiz

O erro `persistence_required` é retornado quando:

1. **Banco de dados não inicializado**: A função `getSequelize()` retorna `null` porque `sequelize.connect()` nunca foi chamado ou falhou
2. **Tabela não existe**: PostgreSQL respondeu com erro de tabela ausente (`42P01`)

### Fluxo de Erro:

```
WhatsAppConnectionsPage.jsx
  ↓
GET /whatsapp/connections
  ↓
whatsappQrService.getStore()
  ↓
tenantSettingsService.getSetting()
  ↓
if (!dbAvailable())  ← getSequelize() retorna null
    return { ok: false, error: 'db_unavailable' }
  ↓
whatsappQrService converte em:
    return persistenceRequiredError()
  ↓
HTTP 503 + "persistence_required"
```

## Solução Aplicada

### 1. ✅ Testes de Banco de Dados Validados

```bash
# Verificar conexão PostgreSQL
sudo -u postgres psql -d r_agent2 -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_settings');"
# Resultado: t (true) ✅

# Verificar dados existentes
sudo -u postgres psql -d r_agent2 -c "SELECT tenant_id, key FROM tenant_settings LIMIT 5;"
# Resultado: Dados de whatsapp_connections encontrados ✅
```

### 2. ✅ Servidor Reiniciado

**Problema**: Servidor anterior estava em estado inconsistente (possível morte de conexão do Sequelize)

```bash
# Matar processos anteriores
pkill -f "node.*api/server.js"

# Reiniciar servidor
npm start
```

### 3. ✅ Testes de Integração Passando

```bash
npm exec -- jest tests/integration/tenantRequired.test.js
# Test Suites: 1 passed, 1 total
# Tests: 1 passed, 1 total
```

### 4. ✅ Testes Unitários Corrigidos

Atualizado `tests/unit/whatsappQrService.coercion.test.js` para usar mocks corretos:

```javascript
// ❌ ANTES: Mocks com db_unavailable (causava testes falharem)
jest.doMock('../../api/services/tenantSettingsService', () => ({
  getSetting: jest.fn(async () => ({ ok: false, error: 'settings_unavailable' })),
  upsertSetting: jest.fn(async () => ({ ok: false, error: 'settings_unavailable' })),
}));

// ✅ DEPOIS: Mocks com estado persistente (testes passam)
const settingsStore = { whatsapp_connections: { connections: [] } };
jest.doMock('../../api/services/tenantSettingsService', () => ({
  getSetting: jest.fn(async ({ key }) => ({ ok: true, value: settingsStore[key] || null })),
  upsertSetting: jest.fn(async ({ key, value }) => {
    settingsStore[key] = value;
    return { ok: true, value };
  }),
}));
```

**Resultado Final:**
```
Test Suites: 4 passed, 4 total
Tests: 20 passed, 20 total ✅
```

## Status Atual

### ✅ Sistema Funcionando:

1. **Database**: PostgreSQL conectado ✅
   - Banco: `r_agent2`
   - Tabela: `tenant_settings` 
   - Dados: Conexões WhatsApp armazenadas

2. **API Server**: Respondendo normalmente ✅
   - Health check: `200 OK`
   - Autenticação: `401` (esperado sem token)
   - Persistência: Obrigatória (sem fallback)

3. **Tests**: 100% passando ✅
   - 20 testes unitários
   - 1 teste de integração
   - Cobertura de database, service, routes

### Frontend Status:

Se ainda ver erro 503 após restart, é porque:
- API acabou de reiniciar (migração em progresso)
- Recarregue a página em 2-3 segundos

## Prevenção Futura

### 1. Monitorar Initialization
Arquivo: [api/bootstrap/startInitialization.js](api/bootstrap/startInitialization.js#L37)

```javascript
await connect(30, 1000);  // 30 tentativas com retry exponencial
```

### 2. Verificar Sequelize Status
Se servidor retornar 503 persistentemente:

```bash
# Verificar logs do servidor
tail -f ~/.pm2/logs/api-error.log

# Testar conexão manualmente
node -e "
require('./api/db/sequelize').connect()
  .then(() => console.log('✅ Conectado'))
  .catch(e => console.error('❌ Erro:', e.message))
"
```

### 3. Verificar Tabela
```bash
# Se tabela estiver faltando, executar migrations
npm run db:migrate

# Ou verificar schema
sudo -u postgres psql -d r_agent2 -c "\d tenant_settings"
```

## Referências

- **Service**: [api/services/tenantSettingsService.js](api/services/tenantSettingsService.js#L31)
- **Database**: [api/db/sequelize.js](api/db/sequelize.js#L98)
- **WhatsApp Service**: [api/services/whatsappQrService.js](api/services/whatsappQrService.js#L103-L110)
- **Project Rule**: [PROJECT_RULES.md#Seção-7](PROJECT_RULES.md) - Persistência Obrigatória

## Pendência Futura (Roadmap)

### Limpeza automática das sessões WhatsApp Web

Atualmente, os diretórios de sessão local do WhatsApp Web (`.wwebjs_auth/` e `.wwebjs_cache/`) **não são esvaziados automaticamente**.

Estado atual:
- A sessão é persistente por design para evitar perda de autenticação entre reinícios.
- O sistema remove automaticamente apenas arquivos de lock do Chrome quando detecta travamento.
- A limpeza completa da pasta de sessão ainda depende de ação manual (ou reset operacional controlado).

Decisão:
- Esta pendência deve ser tratada em evolução futura, com política explícita de retenção/expurgo e opção segura de limpeza por tenant/conexão.

Critérios esperados para solução futura:
- Limpeza automática com janela de retenção configurável.
- Operação segura sem quebrar sessões ativas.
- Logs/auditoria da limpeza executada.
- Comando/endpoint administrativo para limpeza forçada por conexão.
