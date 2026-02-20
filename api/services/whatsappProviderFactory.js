const WhatsAppProviderCloud = require('./whatsappProviderCloud');
const WhatsAppProviderQr = require('./whatsappProviderQr');
const tenantSettingsService = require('./tenantSettingsService');

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
        const conn = settings.value.connections.find(c => c.status === 'connected');
        if (conn && conn.provider) providerType = conn.provider;
      }
    }

    // Normaliza providerType para evitar incompatibilidades (ex.: 'whatsapp-qr')
    const normalized = String(providerType || '').toLowerCase().trim();
    if (!normalized) providerType = 'cloud';
    else if (normalized === 'qr' || normalized.includes('qr')) providerType = 'qr';
    else if (normalized === 'cloud' || normalized.includes('cloud')) providerType = 'cloud';
    else providerType = normalized;

    if (providerType === 'qr') return new WhatsAppProviderQr();
    return new WhatsAppProviderCloud();
  }
}

module.exports = WhatsAppProviderFactory;
