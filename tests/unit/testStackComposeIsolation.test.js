'use strict';

const fs = require('fs');
const path = require('path');

describe('test stack compose isolation', () => {
  test('uses a project name distinct from production', () => {
    const composePath = path.resolve(__dirname, '../../docker-compose.test.yml');
    const compose = fs.readFileSync(composePath, 'utf8');

    expect(compose).toMatch(/^name:\s*r-agent2-test\s*$/m);
    expect(compose).not.toMatch(/^name:\s*r-agent2\s*$/m);
  });
});
