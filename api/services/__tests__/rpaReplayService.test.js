'use strict';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

describe('rpaReplayService', () => {
  beforeEach(() => {
    jest.resetModules();
    const fs = require('fs');
    fs.existsSync.mockReset();
    fs.unlinkSync.mockReset();
  });

  test('rejeita filename inválido', () => {
    const { deleteReplayFile } = require('../rpaReplayService');
    const out = deleteReplayFile('../bad.json');
    expect(out.success).toBe(false);
    expect(out.error).toBe('invalid_filename');
  });

  test('remove replay existente', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    const { deleteReplayFile } = require('../rpaReplayService');
    const out = deleteReplayFile('replay-ok.json');
    expect(out.success).toBe(true);
    expect(out.deletedFilename).toBe('replay-ok.json');
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});
