const { shouldAutoLoginForTarget, replaceTemplateVariables } = require('../rpa/utils/autoLoginFlow');

describe('RPA autoLoginFlow', () => {
  test('mantém auto-login para rotas internas', () => {
    expect(shouldAutoLoginForTarget('http://localhost:5173/editor', 'http://localhost:5173')).toBe(true);
  });

  test('desabilita auto-login para URLs externas', () => {
    expect(shouldAutoLoginForTarget('https://example.com', 'http://localhost:5173')).toBe(false);
  });

  test('mantém auto-login quando não há target explícito', () => {
    expect(shouldAutoLoginForTarget(null, 'http://localhost:5173')).toBe(true);
  });

  test('resolve placeholders do target antes do auto-login', () => {
    expect(
      replaceTemplateVariables('{{urls.frontend}}/editor', {
        urls: { frontend: 'http://localhost:5173' },
      }),
    ).toBe('http://localhost:5173/editor');
  });

  test('aplica fallback de frontendBaseUrl quando urls.frontend não existe', () => {
    expect(
      replaceTemplateVariables('{{urls.frontend}}/support', {}, {
        frontendBaseUrl: 'http://localhost:5173',
      }),
    ).toBe('http://localhost:5173/support');
  });
});
