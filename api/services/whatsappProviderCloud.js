const WhatsAppProvider = require('./whatsappProvider');
const whatsappService = require('./whatsappService');

class WhatsAppProviderCloud extends WhatsAppProvider {
  async sendText(tenantId, to, text, context) {
    return whatsappService.sendText(tenantId, to, text, context);
  }
  async sendMedia(tenantId, to, mediaType, mediaUrlOrPath, caption, context) {
    return whatsappService.sendMedia(tenantId, to, mediaType, mediaUrlOrPath, caption, context);
  }
  async sendTemplate(tenantId, to, templateName, language, components, context) {
    return whatsappService.sendTemplate(tenantId, to, templateName, language, components, context);
  }
}

module.exports = WhatsAppProviderCloud;
