// Endpoints REST para controle de sessões QR
const whatsappQrRunner = require('./services/whatsappQrRunner');
const runner = new whatsappQrRunner({ sessionsDir: __dirname + '/../data/wa_sessions' });

// ...no handler do server.js:
// POST /whatsapp/connections/:id/start
// GET  /whatsapp/connections/:id/status
// POST /whatsapp/connections/:id/stop

// Exemplo de uso:
// runner.startSession(tenantId, channelAccountId, (qr) => {/* emitir evento ou salvar para frontend */});
// runner.getStatus(tenantId, channelAccountId);
// runner.stopSession(tenantId, channelAccountId);
