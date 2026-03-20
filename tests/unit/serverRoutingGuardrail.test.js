'use strict';

const fs = require('fs');
const path = require('path');

describe('server routing guardrail', () => {
  test('server.js nao deve manter pipeline paralela fora do Express', () => {
    const serverPath = path.join(process.cwd(), 'api', 'server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    expect(source.includes('function createStageMiddleware')).toBe(false);
    expect(source.includes('async function runExpressRoutingPipeline')).toBe(false);
    expect(source.includes('async function requestHandler')).toBe(false);
  });
});
