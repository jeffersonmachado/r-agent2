'use strict';

/**
 * Regressão: credenciais WhatsApp com placeholder `REPLACE_WITH_*` (valores de
 * fábrica do config.example.json) passavam pelo areCredentialsValid — a lista
 * de patterns só cobria o phoneNumberId e não incluía REPLACE_WITH — e a
 * plataforma fazia a chamada real à Meta, recebendo 401 OAuthException
 * ("Malformed access token REPLACE_WITH_WHATSAPP_ACCESS_TOKEN") em vez do
 * erro local explícito de configuração pendente.
 */

describe('whatsappService.areCredentialsValid — placeholders REPLACE_WITH_*', () => {
  function loadService(configValues) {
    let service;
    jest.isolateModules(() => {
      jest.doMock('../../api/utils/config', () => ({
        getFromFile: (key) => configValues[key],
        get: (key) => configValues[key],
      }));
      service = require('../../api/services/whatsappService');
    });
    return service;
  }

  afterEach(() => {
    jest.dontMock('../../api/utils/config');
  });

  test('phoneNumberId REPLACE_WITH_PHONE_NUMBER_ID é detectado como placeholder', () => {
    const service = loadService({
      'whatsapp.apiUrl': 'https://graph.facebook.com/v18.0',
      'whatsapp.phoneNumberId': 'REPLACE_WITH_PHONE_NUMBER_ID',
      'whatsapp.accessToken': 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'whatsapp.verifyToken': 'verify-token-real-123',
    });

    expect(service.areCredentialsValid()).toBe(false);
  });

  test('accessToken REPLACE_WITH_WHATSAPP_ACCESS_TOKEN é detectado como placeholder', () => {
    const service = loadService({
      'whatsapp.apiUrl': 'https://graph.facebook.com/v18.0',
      'whatsapp.phoneNumberId': '123456789012345',
      'whatsapp.accessToken': 'REPLACE_WITH_WHATSAPP_ACCESS_TOKEN',
      'whatsapp.verifyToken': 'verify-token-real-123',
    });

    expect(service.areCredentialsValid()).toBe(false);
  });

  test('verifyToken REPLACE_WITH_WHATSAPP_VERIFY_TOKEN é detectado como placeholder', () => {
    const service = loadService({
      'whatsapp.apiUrl': 'https://graph.facebook.com/v18.0',
      'whatsapp.phoneNumberId': '123456789012345',
      'whatsapp.accessToken': 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'whatsapp.verifyToken': 'REPLACE_WITH_WHATSAPP_VERIFY_TOKEN',
    });

    expect(service.areCredentialsValid()).toBe(false);
  });

  test('credenciais com formato real são aceitas', () => {
    const service = loadService({
      'whatsapp.apiUrl': 'https://graph.facebook.com/v18.0',
      'whatsapp.phoneNumberId': '123456789012345',
      'whatsapp.accessToken': 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'whatsapp.verifyToken': 'verify-token-real-123',
    });

    expect(service.areCredentialsValid()).toBe(true);
  });

  test('token curto demais continua rejeitado', () => {
    const service = loadService({
      'whatsapp.apiUrl': 'https://graph.facebook.com/v18.0',
      'whatsapp.phoneNumberId': '123456789012345',
      'whatsapp.accessToken': 'curto',
      'whatsapp.verifyToken': 'verify-token-real-123',
    });

    expect(service.areCredentialsValid()).toBe(false);
  });
});
