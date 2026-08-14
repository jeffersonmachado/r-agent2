# @results/whatsapp-qr-bridge

Núcleo compartilhado de bridge WhatsApp via QR Code, extraído/generalizado do
r-agent2 (`api/services/whatsappQrBridgeService.js`). CommonJS, Node >= 18, sem
TypeScript.

O pacote gerencia **somente** o ciclo de vida dos clientes
[whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (multi-conexão,
QR, status, envio de texto/mídia, eventos). Persistência (banco,
`tenant_settings`), WebSocket, tickets e recuperação de mensagens não-lidas são
responsabilidade do consumidor, que reage aos eventos emitidos.

## Instalação (via `file:`)

No `package.json` do projeto consumidor (r-agent2, r-observe):

```json
{
  "dependencies": {
    "@results/whatsapp-qr-bridge": "file:../packages/whatsapp-qr-bridge",
    "whatsapp-web.js": "^1.34.6"
  }
}
```

`whatsapp-web.js` é **peerDependency opcional**: o pacote só a carrega em
runtime (require lazy dentro da factory padrão), então testes com
`clientFactory` injetado não puxam puppeteer/Chrome. Instale-a no projeto
consumidor. O QR é convertido em data URL localmente com `qrcode` (sem
api.qrserver.com).

## Uso

```js
const { createBridge } = require('@results/whatsapp-qr-bridge');

const bridge = createBridge({
  authDataPath: '/var/lib/meuapp/whatsapp/auth', // dataPath do LocalAuth
  syncIntervalMs: 30000,                          // default 30000; 0 desliga
  // clientFactory: ({ clientId, dataPath, connectionId, puppeteer, webVersion, webVersionCacheDir }) => client,
  // puppeteer: { headless: true, args: [...] },
  // webVersion: undefined → pin default (ver abaixo); null → WA Web latest; '<versao>' → pin custom
  // webVersionCacheDir: '/dir/com/<versao>.html',  // default: wa-web/ do pacote
  // logger: console,
});

bridge.on('qr', ({ connectionId, qrText, qrDataUrl, expiresAt }) => {
  // persistir/exibir o QR (qrDataUrl é data:image/png;base64,...)
});

bridge.on('status', ({ connectionId, status }) => {
  // status ∈ pairing | connected | ready | disconnected | error
});

bridge.on('ready', ({ connectionId }) => {
  // sessão pronta — aqui o consumidor decide se recupera não-lidas etc.
});

bridge.on('message', ({ connectionId, from, body, hasMedia, raw }) => {
  // mensagens fromMe NÃO são emitidas
});

bridge.on('error', ({ connectionId, error }) => { /* ... */ });

await bridge.addConnection({ id: 'conn-1' });           // inicia o cliente
await bridge.requestQr('conn-1');                        // força novo QR
await bridge.sendText('conn-1', '+55 11 99999-0000', 'olá');
await bridge.sendMedia('conn-1', '5511999990000', {
  data: '<base64 ou Buffer>', mimeType: 'image/png', fileName: 'foto.png', caption: 'opcional',
});
await bridge.disconnect('conn-1');                       // logout + destroy
await bridge.removeConnection('conn-1');                 // remove do bridge
await bridge.stop();                                     // para sync e destrói tudo
```

## Pin de versão do WhatsApp Web (workaround wwebjs#127084)

Desde 2026-06-20, os builds `2.3000.1041xxx+` do WhatsApp Web quebram o
whatsapp-web.js: `authenticated` dispara, mas `ready` nunca (o loading chega a
100% e trava — pareamento e restore de sessão ficam em "aguardando"). O
remédio validado pela comunidade é pinar um build anterior à quebra servido de
cache **local** (o repositório `wppconnect-team/wa-version` poda builds
antigos, então `type: 'remote'` daria 404).

Por isso o pacote **pina por default** o build `2.3000.1037753511-alpha`,
cujo HTML fica em `wa-web/2.3000.1037753511-alpha.html` dentro do próprio
pacote. Comportamento:

- `webVersion` **não informado** → pin default (recomendado enquanto o bug
  estiver aberto);
- `webVersion: null` → sem pin, usa o WA Web mais recente (volta ao
  comportamento nativo da lib — útil para testar se o bug foi corrigido);
- `webVersion: '<versao>'` → pin custom; exige `<versao>.html` em
  `webVersionCacheDir` (default: `wa-web/` do pacote).

`resolveWebVersionOptions({ webVersion, webVersionCacheDir })` é exportada
para que `clientFactory` customizadas apliquem o mesmo pin:

```js
const { resolveWebVersionOptions } = require('@results/whatsapp-qr-bridge');
const client = new Client({
  authStrategy: new LocalAuth({ clientId, dataPath }),
  ...resolveWebVersionOptions({ webVersion, webVersionCacheDir }),
});
```

## API

`createBridge(options)` → bridge (EventEmitter + métodos):

- `addConnection({ id, sessionPath? })` → registra e inicia o cliente.
  `sessionPath` sobrescreve o `authDataPath` do bridge para esta conexão.
- `removeConnection(id)` → destrói o cliente e remove o registro.
- `listConnections()` → `[{ id, clientId, status, ready, sessionPath, createdAt, updatedAt }]`.
- `getStatus(id)` → `{ ok, connectionId, status, ready, updatedAt }` ou `{ ok: false, error: 'not_found' }`.
- `requestQr(id)` → destrói o cliente atual e inicia um novo (novo QR via evento).
- `sendText(id, to, text)` → `to` é normalizado para `<digits>@c.us`
  (JIDs com `@` são preservados). Rejeita com `client_not_ready` se a conexão
  não está `ready`.
- `sendMedia(id, to, { data, mimeType, fileName, caption? })` → idem.
- `disconnect(id)` → `logout()` + `destroy()`; a conexão fica registrada mas
  inativa (o sync não a reinicia).
- `stop()` → para o sync periódico e destrói todos os clientes.

Eventos (`bridge.on(...)`):

| Evento    | Payload                                                        |
|-----------|----------------------------------------------------------------|
| `qr`      | `{ connectionId, qrText, qrDataUrl, expiresAt }`               |
| `status`  | `{ connectionId, status, reason? }`                            |
| `ready`   | `{ connectionId }`                                             |
| `message` | `{ connectionId, from, body, hasMedia, raw }`                  |
| `error`   | `{ connectionId, error }`                                      |

Notas:

- O `clientId` do LocalAuth é sanitizado (`waqr_<id>`, apenas `[a-zA-Z0-9_-]`).
- Locks do Chrome (`SingletonLock`, `SingletonSocket`, `SingletonCookie`,
  `DevToolsActivePort`) são removidos do diretório de sessão antes de cada
  `initialize()`.
- `syncIntervalMs` (default 30000, `0` desliga) reconcilia clientes ativos com
  as conexões registradas, reiniciando clientes de conexões ativas que ficaram
  sem cliente.
- Com `clientFactory` injetado, `sendMedia` usa um objeto simples
  `{ mimetype, data, filename }` em vez de `MessageMedia` (que exige a lib real).

## Testes

```bash
npm install
npm test   # node --test tests/*.test.js — usa FakeClient, sem Chrome/rede
```
