// Interface para providers WhatsApp
class WhatsAppProvider {
  async sendText(tenantId, to, text, context) {
    throw new Error('Not implemented');
  }
  async sendMedia(tenantId, to, mediaType, mediaUrlOrPath, caption, context) {
    throw new Error('Not implemented');
  }
  async sendTemplate(tenantId, to, templateName, language, components, context) {
    throw new Error('Not implemented');
  }
}

module.exports = WhatsAppProvider;
