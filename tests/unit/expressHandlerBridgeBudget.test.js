'use strict';

const fs = require('fs');
const path = require('path');

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(target));
      continue;
    }
    if (target.endsWith('.js')) {
      out.push(target);
    }
  }
  return out;
}

describe('express handler bridge budget', () => {
  test('serverHandlers imports in modules stay within the current explicit budget', () => {
    const files = walk(path.join(process.cwd(), 'api', 'modules'));
    const bridgeFiles = files.filter((file) => fs.readFileSync(file, 'utf8').includes('serverHandlers'));

    expect(bridgeFiles).toHaveLength(0);
  });
});
