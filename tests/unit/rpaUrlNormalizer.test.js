const { normalizeRpaTestUrls } = require('../rpa/utils/urlNormalizer');
const config = require('../../api/utils/config');

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

    const expectedBaseUrl = (
      process.env.TEST_FRONTEND_URL
      || process.env.FRONTEND_URL
      || config.get('tests.rpa.frontendUrl')
      || config.get('frontend.url')
      || 'http://localhost:5173'
    ).replace(/\/$/, '');

    expect(testCase.steps[0].url).toBe(`${expectedBaseUrl}/editor`);
  });
});
