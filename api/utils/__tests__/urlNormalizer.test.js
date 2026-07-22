'use strict';

const { normalizeRpaTestUrls } = require('../urlNormalizer');

describe('urlNormalizer.normalizeRpaTestUrls', () => {
  it('preserva URLs com template Handlebars (ex.: {{urls.frontend}}/dev/qa-waves)', () => {
    const test = {
      steps: [
        { type: 'navigate', url: '{{urls.frontend}}/dev/qa-waves' },
        { type: 'navigate', url: '{{urls.frontend}}/dev/rpa-replays' },
      ],
    };

    normalizeRpaTestUrls(test);

    // Sem a guarda, virava "http://localhost:5173/{{urls.frontend}}/..." e a
    // navegação caía em rota desconhecida (redirect para /workspace).
    expect(test.steps[0].url).toBe('{{urls.frontend}}/dev/qa-waves');
    expect(test.steps[1].url).toBe('{{urls.frontend}}/dev/rpa-replays');
  });

  it('continua reescrevendo URLs absolutas localhost:5173 para a base ativa', () => {
    const test = {
      steps: [
        { type: 'navigate', url: 'http://localhost:5173/dev/qa-waves' },
      ],
    };

    normalizeRpaTestUrls(test);

    expect(test.steps[0].url).toMatch(/^https?:\/\//);
    expect(test.steps[0].url).toContain('/dev/qa-waves');
  });

  it('continua convertendo URLs relativas em absolutas', () => {
    const test = {
      steps: [
        { type: 'navigate', url: '/dev/qa-waves' },
      ],
    };

    normalizeRpaTestUrls(test);

    expect(test.steps[0].url).toMatch(/^https?:\/\/.*\/dev\/qa-waves$/);
  });
});
