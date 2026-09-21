'use strict';

const { isBlockedFilename, redactContent, applySecretPolicy } = require('../../engine/engineeringRouter/secretRedaction');

describe('engineeringRouter/secretRedaction', () => {
  test('bloqueia arquivos .env e credentials.json inteiros por nome', () => {
    expect(isBlockedFilename('.env')).toBe(true);
    expect(isBlockedFilename('config/.env.production')).toBe(true);
    expect(isBlockedFilename('.token.env')).toBe(true);
    expect(isBlockedFilename('api/credentials.json')).toBe(true);
    expect(isBlockedFilename('src/index.js')).toBe(false);
  });

  test('redige valor de chave de API estilo OpenAI/Anthropic inline em qualquer arquivo', () => {
    const { content, redactedLineCount } = redactContent('const key = "sk-ant-abc123def456ghi789jkl0";');
    expect(content).toContain('[REDACTED:ANTHROPIC_STYLE_KEY]');
    expect(content).not.toContain('sk-ant-abc123def456ghi789jkl0');
    expect(redactedLineCount).toBe(1);
  });

  test('redige atribuição de PASSWORD/SECRET/TOKEN com valor real, mas não placeholder', () => {
    const real = redactContent('SSH_PASSWORD=SenhaSuperSecreta123');
    expect(real.content).toContain('[REDACTED:possible_secret]');

    const placeholder = redactContent('SSH_PASSWORD=$SSH_PASSWORD');
    expect(placeholder.content).toBe('SSH_PASSWORD=$SSH_PASSWORD');
    expect(placeholder.redactedLineCount).toBe(0);
  });

  test('não redige código legítimo sem segredo', () => {
    const { content, redactedLineCount } = redactContent('function apiKeyLookup(tenantId) { return getKey(tenantId); }');
    expect(content).toBe('function apiKeyLookup(tenantId) { return getKey(tenantId); }');
    expect(redactedLineCount).toBe(0);
  });

  test('applySecretPolicy bloqueia arquivo inteiro e redige o restante', () => {
    const { files, blocked } = applySecretPolicy([
      { path: '.env', content: 'API_KEY=abc' },
      { path: 'src/foo.js', content: 'const x = 1;\nconst token = "ghp_' + 'a'.repeat(36) + '";' },
    ]);
    expect(blocked).toEqual([{ path: '.env', reason: 'BLOCKED_FILENAME' }]);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('[REDACTED:GITHUB_TOKEN]');
  });
});
