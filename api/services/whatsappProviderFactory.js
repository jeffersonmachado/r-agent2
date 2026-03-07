const WhatsAppProviderCloud = require('./whatsappProviderCloud');
const WhatsAppProviderQr = require('./whatsappProviderQr');
const tenantSettingsService = require('./tenantSettingsService');

function normalizeProviderType(raw) {
  const normalized = String(raw || '').toLowerCase().trim();
  if (!normalized) return 'cloud';
  if (normalized === 'qr' || normalized.includes('qr')) return 'qr';
  if (normalized === 'cloud' || normalized.includes('cloud')) return 'cloud';
  return normalized;
}

function hasAnyQrConfigured(connections) {
  return (connections || []).some((c) => normalizeProviderType(c?.provider) === 'qr');
}

// Factory para obter o provider correto por tenant/channel
class WhatsAppProviderFactory {
  static async get(tenantId, channelAccount) {
    // channelAccount pode ter provider: 'cloud' ou 'qr'
    let providerType = 'cloud';
    if (channelAccount && channelAccount.provider) {
      providerType = channelAccount.provider;
    } else {
      // fallback: buscar do tenantSettings
      const settings = await tenantSettingsService.getSetting({ tenantId, key: 'whatsapp_connections' });
      if (settings.ok && Array.isArray(settings.value?.connections)) {
        const conns = settings.value.connections;
        const connected = conns.find((c) => String(c?.status || '').toLowerCase() === 'connected');
        if (connected?.provider) {
          providerType = connected.provider;
        } else if (hasAnyQrConfigured(conns)) {
          // Não cair em Cloud por padrão quando o tenant usa QR,
          // mesmo que temporariamente não haja sessão conectada.
          providerType = 'qr';
        }
      }
    }

    providerType = normalizeProviderType(providerType);

    if (providerType === 'qr') return new WhatsAppProviderQr();
    return new WhatsAppProviderCloud();
  }
}

module.exports = WhatsAppProviderFactory;
