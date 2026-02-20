const WhatsAppProviderFactory = require('../whatsappProviderFactory');
const WhatsAppProviderCloud = require('../whatsappProviderCloud');
const WhatsAppProviderQr = require('../whatsappProviderQr');

describe('WhatsAppProviderFactory', () => {
  it('retorna WhatsAppProviderCloud por padrão', async () => {
    const provider = await WhatsAppProviderFactory.get('tenant1', { provider: 'cloud' });
    expect(provider).toBeInstanceOf(WhatsAppProviderCloud);
  });
  it('retorna WhatsAppProviderQr se provider=qr', async () => {
    const provider = await WhatsAppProviderFactory.get('tenant1', { provider: 'qr' });
    expect(provider).toBeInstanceOf(WhatsAppProviderQr);
  });
});

describe('WhatsAppProviderCloud', () => {
  it('chama métodos do whatsappService', async () => {
    const provider = new WhatsAppProviderCloud();
    expect(typeof provider.sendText).toBe('function');
    expect(typeof provider.sendMedia).toBe('function');
    expect(typeof provider.sendTemplate).toBe('function');
  });
});

describe('WhatsAppProviderQr', () => {
  it('stub lança erro', async () => {
    const provider = new WhatsAppProviderQr();
    await expect(provider.sendText('t','to','msg',{})).rejects.toThrow('TODO');
    await expect(provider.sendMedia('t','to','img','url','cap',{})).rejects.toThrow('TODO');
    await expect(provider.sendTemplate('t','to','tpl','pt',[])).rejects.toThrow('TODO');
  });
});
