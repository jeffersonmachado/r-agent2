'use strict';

function isWhitelistedWhatsAppMediaHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (host === 'mmg.whatsapp.net') return true;
  return host.endsWith('.whatsapp.net');
}

function inferMediaTypeFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

module.exports = {
  isWhitelistedWhatsAppMediaHost,
  inferMediaTypeFromMime,
};
