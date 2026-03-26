const { normalizeRpaTestUrls } = require('../rpa/utils/urlNormalizer');

describe('normalizeRpaTestUrls', () => {
  test('preserva placeholders Handlebars em navigate.url', () => {
    const testCase = {
      id: 'seed-platform-create-flow',
      steps: [
        { type: 'navigate', url: '{{urls.frontend}}/editor' },
      ],
    };

    normalizeRpaTestUrls(testCase);

    expect(testCase.steps[0].url).toBe('{{urls.frontend}}/editor');
  });

  test('continua normalizando URLs locais absolutas sem placeholder', () => {
    const testCase = {
      id: 'seed-platform-create-flow',
      steps: [
        { type: 'navigate', url: 'http://localhost:3000/editor' },
      ],
    };

    normalizeRpaTestUrls(testCase);

    expect(testCase.steps[0].url).toBe('http://localhost:5173/editor');
  });
});
