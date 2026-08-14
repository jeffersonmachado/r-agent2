'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonAtomic } = require('../../api/utils/atomicJsonFile');

describe('atomicJsonFile', () => {
  test('substitui JSON por rename no mesmo diretório e não deixa arquivo temporário', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-json-'));
    const target = path.join(directory, 'store.json');
    fs.writeFileSync(target, '{"old":true}\n', 'utf8');
    const rename = jest.spyOn(fs, 'renameSync');

    writeJsonAtomic(target, { current: true, items: [1, 2] });

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ current: true, items: [1, 2] });
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), target);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    rename.mockRestore();
  });
});
