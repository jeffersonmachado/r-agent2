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

describe('express handler bridge allowlist', () => {
  test('mount/create usage no longer appears in api/modules', () => {
    const files = walk(path.join(process.cwd(), 'api', 'modules'));
    const mountUsers = [];
    const createUsers = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('mountExpressHandler(')) {
        mountUsers.push(file);
      }
      if (source.includes('createExpressHandlerMiddleware(')) {
        createUsers.push(file);
      }
    }

    expect(mountUsers).toEqual([]);
    expect(createUsers).toEqual([]);
  });
});
