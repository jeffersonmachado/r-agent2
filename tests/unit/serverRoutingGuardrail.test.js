'use strict';

const fs = require('fs');
const path = require('path');

describe('server routing guardrail', () => {
  test('requestHandler nao deve conter checks inline por method', () => {
    const serverPath = path.join(process.cwd(), 'api', 'server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    const requestHandlerStart = source.indexOf('async function requestHandler');
    const createServerStart = source.indexOf('function createServer()', requestHandlerStart);

    expect(requestHandlerStart).toBeGreaterThan(-1);
    expect(createServerStart).toBeGreaterThan(requestHandlerStart);

    const requestHandlerBlock = source.slice(requestHandlerStart, createServerStart);

    // Remove comments to avoid false positives from documentation text.
    const withoutComments = requestHandlerBlock
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const inlineMethodChecks = withoutComments.match(/if\s*\(\s*method\s*===/g) || [];
    expect(inlineMethodChecks).toHaveLength(0);
  });
});
