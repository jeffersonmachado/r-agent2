'use strict';

const { synthesizeText } = require('../voiceAdapters/ttsAdapter');

describe('ttsAdapter', () => {
  test('retorna tts_text com fallback quando tts desabilitado', async () => {
    const out = await synthesizeText({
      tenant_id: 'tenant-x',
      metadata: {},
    }, 'Resposta curta');

    expect(out.tts_text).toBe('Resposta curta');
    expect(out.skipped).toBe(true);
  });
});
