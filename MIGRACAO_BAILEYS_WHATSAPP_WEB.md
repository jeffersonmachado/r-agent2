# Migração: Baileys → whatsapp-web.js

**Data:** 2026-03-24  
**Status:** ✅ Concluído

## Resumo Executivo

Migração da biblioteca `@whiskeysockets/baileys` para `whatsapp-web.js` como bridge obrigatório para geração de QR code WhatsApp.

### Motivação

1. **Stability**: Baileys teve histórico de instabilidade e breaking changes com atualizações do WhatsApp
2. **Architecture**: Refatoração para bridge limpo e desacoplado com suporte multi-tenant
3. **Reliability**: whatsapp-web.js oferece alternativa mais robusta e ativa
4. **Cost**: Bridge agora é componente isolado com falhas previsíveis

## Mudanças Implementadas

### 1. Remoção de Referências a Baileys

#### Remover de `frontend/jest.config.js`
- ❌ `@whiskeysockets/baileys` removido da lista de exclusão de transformação

#### Remover de `frontend/src/pages/VERIFICACAO_ADMIN_USER.md`
- ❌ Referências a "Baileys" no título e descrição

### 2. Bridge Agora é Obrigatório

#### ❌ Removido: `ENABLE_WHATSAPP_QR_BRIDGE` env var
- Antes: Bridge era opcional (padrão: `false`)
- Agora: Bridge inicializa sempre na startup

#### ✅ Implementado: Validação na startup
```javascript
// api/services/whatsappQrBridgeService.js
function loadWhatsappWebJs() {
  const wa = require('whatsapp-web.js'); // Erro se não instalada
  if (!wa || typeof wa.Client !== 'function') {
    throw new Error(
      'whatsapp-web.js não instalado. ' +
      'Instale com: npm install whatsapp-web.js'
    );
  }
  return wa;
}
```

### 3. Dependências

#### Adicionar a `package.json`
```json
{
  "dependencies": {
    "whatsapp-web.js": "^1.25.0"
  },
  "devDependencies": {
    "@types/whatsapp-web.js": "^1.25.0"
  }
}
```

**Instalar:**
```bash
npm install whatsapp-web.js
```

### 4. Configuração da Bridge

#### Variáveis de Ambiente (apenas as necessárias)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `WHATSAPP_QR_BRIDGE_SYNC_MS` | `30000` | Intervalo de sincronização (ms) |
| `WHATSAPP_QR_BRIDGE_TENANTS` | ` ` | Tenants para sincronizar (opcional) |
| `WHATSAPP_QR_PUPPETEER_NO_SANDBOX` | `true` | Desabilitar sandbox do Puppeteer |

#### ❌ Removido
- `ENABLE_WHATSAPP_QR_BRIDGE` — bridge sempre ativa

### 5. Fluxo de Geração de QR

**Antes (com fallback a `test:` QR):**
```
generateQr() → sem real
  ↓
↓→ Gera test:conn-id:token:timestamp (inválido!)
```

**Agora (com bridge obrigatório):**
```
generateQr() → sem real
  ↓
Seta status pairing + retorna pending: true, qr: null
  ↓
Rota chama requestConnectionQr() → bridge inicializa cliente
  ↓
Bridge aguarda evento 'qr' do WhatsApp Web
  ↓
QR chegava via webhook → UI atualiza via WebSocket
```

## Checklist de Migração

- [x] Remover `@whiskeysockets/baileys` de jest.config.js
- [x] Remover referências a "Baileys" da documentação
- [x] Adicionar `whatsapp-web.js` como dependência obrigatória
- [x] Remover lógica de fallback (ENABLE_WHATSAPP_QR_BRIDGE)
- [x] Atualizar whatsappQrBridgeService.js para erro na startup se lib ausente
- [x] Remover `generateTestQrText()` (test QR)
- [x] Ajustar testes para novo fluxo
- [x] Documentar no .env.example

## Instalação

### Pré-requisitos

- Node.js >= 14
- npm >= 6

### Passos

```bash
# 1. Instalar dependência
npm install whatsapp-web.js

# 2. Compilar (se necessário)
npm run build

# 3. Iniciar servidor
npm start
```

### Validação

Ao iniciar, o servidor verificará:
```
[INFO] Bridge obrigatório iniciando...
[INFO] whatsapp-web.js detectado ✓
[INFO] Sincronização de conexões ativa
```

## Troubleshooting

### Erro: "whatsapp-web.js não instalado"

```bash
npm install whatsapp-web.js
# Se persistir, limpar cache:
npm cache clean --force
rm package-lock.json
npm install
```

### Erro: "Bridge inicialização falhou"

- Verificar variáveis de ambiente
- Verificar bandeja de disco (Puppeteer requer espaço)
- Verificar logs em `WHATSAPP_QR_BRIDGE_LOG_LEVEL`

### Performance: Bridge consumindo muita memória

- Ajustar `WHATSAPP_QR_BRIDGE_SYNC_MS` (aumentar intervalo)
- Limitar tenants com `WHATSAPP_QR_BRIDGE_TENANTS`
- Usar container com limites de memória

## Impacto em Produção

| Aspecto | Antes | Depois |
|--------|-------|--------|
| Bridge | Opcional, com fallback inválido | Obrigatório, QR real garantido |
| Libraria | @whiskeysockets/baileys | whatsapp-web.js |
| Startup | Falha silenciosa se bridge desabilitada | Erro claro na startup se lib ausente |
| Multi-tenant | Suporte básico | Isolamento total por tenant |
| QR Fallback | test:connectionId:token (❌ inválido) | pending: true, aguarda provider (✓ correto) |

## Rollback

Se necessário reverter:

```bash
npm uninstall whatsapp-web.js
npm install @whiskeysockets/baileys@latest
# Restaurar código de bridge com ENABLE_WHATSAPP_QR_BRIDGE
```

## Próximos Passos

- [ ] Monitoramento de bridge em produção
- [ ] Alerts se bridge cair
- [ ] Dashboard de saúde de conexões
- [ ] Métricas de geração de QR
