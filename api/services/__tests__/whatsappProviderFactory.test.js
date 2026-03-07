'use strict';

const WhatsAppProviderCloud = require('../whatsappProviderCloud');
const WhatsAppProviderQr = require('../whatsappProviderQr');

const mockGetSetting = jest.fn();

jest.mock('../tenantSettingsService', () => ({
  getSetting: (...args) => mockGetSetting(...args),
}));

const WhatsAppProviderFactory = require('../whatsappProviderFactory');

describe('WhatsAppProviderFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSetting.mockResolvedValue({ ok: true, value: { connections: [] } });
  });

  test('retorna Cloud por padrão quando não há conexão configurada', async () => {
    const provider = await WhatsAppProviderFactory.get('tenant-1', null);
    expect(provider).toBeInstanceOf(WhatsAppProviderCloud);
  });

  test('retorna QR quando channelAccount.provider=qr', async () => {
    const provider = await WhatsAppProviderFactory.get('tenant-1', { provider: 'qr' });
    expect(provider).toBeInstanceOf(WhatsAppProviderQr);
  });

  test('retorna QR quando há conexão QR conectada no tenant settings', async () => {
    mockGetSetting.mockResolvedValueOnce({
      ok: true,
      value: {
        connections: [
          { id: 'wa-1', provider: 'whatsapp-qr', status: 'connected' },
        ],
      },
    });

    const provider = await WhatsAppProviderFactory.get('tenant-1', null);
    expect(provider).toBeInstanceOf(WhatsAppProviderQr);
  });

  test('prioriza QR (sem fallback cloud) quando há configuração QR mesmo desconectada', async () => {
    mockGetSetting.mockResolvedValueOnce({
      ok: true,
      value: {
        connections: [
          { id: 'wa-1', provider: 'whatsapp-qr', status: 'disconnected' },
        ],
      },
    });

    const provider = await WhatsAppProviderFactory.get('tenant-1', null);
    expect(provider).toBeInstanceOf(WhatsAppProviderQr);
  });
});
