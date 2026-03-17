const fs = require('fs');
const path = require('path');
const { deleteRecording } = require('../../api/services/rpaService');

describe('rpaService deleteRecording - defensive coercions', () => {
  const seedsDir = path.join(process.cwd(), 'tests/rpa/seeds');
  const createdFiles = [];

  beforeAll(() => {
    fs.mkdirSync(seedsDir, { recursive: true });
  });

  afterEach(() => {
    for (const f of createdFiles.splice(0)) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (_) {
        // best effort cleanup
      }
    }
  });

  it('deletes by internal recording.id using case-insensitive safe normalization', () => {
    const fileNameId = `tmp-hardening-${Date.now()}`;
    const filePath = path.join(seedsDir, `${fileNameId}.json`);

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        id: '  REC-ABC-123  ',
        name: 'Teste Hardening',
        steps: [],
      }),
      'utf8'
    );
    createdFiles.push(filePath);

    const result = deleteRecording('rec-abc-123');

    expect(result.success).toBe(true);
    expect(result.deletedId).toBe(fileNameId);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not throw when receiving hostile non-string recordingId', () => {
    const hostileId = {
      toString() {
        throw new Error('boom');
      },
    };

    expect(() => deleteRecording(hostileId)).not.toThrow();
    const result = deleteRecording(hostileId);
    expect(result.success).toBe(false);
    expect(result.message).toBe('ID da gravação é obrigatório');
  });
});
