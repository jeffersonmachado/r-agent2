'use strict';

const path = require('path');
const WhatsAppQrRunner = require('./whatsappQrRunner');

const qrRunner = new WhatsAppQrRunner({
  sessionsDir: path.join(__dirname, '../data/wa_sessions'),
});

module.exports = qrRunner;
