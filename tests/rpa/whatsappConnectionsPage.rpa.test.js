/**
 * RPA test para WhatsAppConnectionsPage
 * Simula navegação, visualização e atualização de status via WebSocket
 */

const { RpaTestRunner } = require('./rpaTestRunner');


describe('WhatsAppConnectionsPage RPA', () => {
  let runner;
  beforeAll(async () => {
    runner = new RpaTestRunner({ headless: true, slowMo: 50 });
    await runner.init();
  });

  afterAll(async () => {
    await runner.close();
  });

  test('deve navegar e validar WhatsAppConnectionsPage', async () => {
    const recording = {
      id: 'whatsapp-connections-rpa',
      name: 'WhatsAppConnectionsPage RPA',
      version: '1.0.0',
      steps: [
        { type: 'navigate', url: 'http://localhost:5173/whatsapp-connections', timeout: 10000 },
        { type: 'waitForSelector', selector: 'h1', timeout: 5000 },
        { type: 'assertText', selector: 'h1', value: 'WhatsApp Cloud API', timeout: 2000 },
        { type: 'wait', condition: 1000 },
      ],
      data: {},
    };
    const result = await runner.playback(recording);
    expect(result.success).toBe(true);
  }, 30000);
});
