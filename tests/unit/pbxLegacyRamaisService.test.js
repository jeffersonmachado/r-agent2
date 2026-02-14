const path = require('path');
const fs = require('fs');

describe('pbxLegacy ramaisService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.PBX_LEGACY_ROOT;
    delete process.env.PBX_LEGACY_XML_DIR;
  });

  test('listRamais lê ramal.xml da fixture', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'ripabx-min');
    process.env.PBX_LEGACY_ROOT = root;
    // eslint-disable-next-line global-require
    const { listRamais } = require('../../api/services/pbxLegacy/ramaisService');
    const items = listRamais();
    expect(items).toHaveLength(1);
    expect(items[0].ramal).toBe('1101');
  });

  test('upsertRamal cria/atualiza e persiste XML', () => {
    const root = path.join(__dirname, '..', 'fixtures', 'ripabx-min');
    const xmlDir = path.join(root, 'dados', 'xml');
    process.env.PBX_LEGACY_ROOT = root;
    process.env.PBX_LEGACY_XML_DIR = xmlDir;

    const target = path.join(xmlDir, 'ramal.xml');
    const original = fs.readFileSync(target, 'utf8');

    try {
      // eslint-disable-next-line global-require
      const { upsertRamal, listRamais } = require('../../api/services/pbxLegacy/ramaisService');
      upsertRamal({ ramal: '1101', nome: 'Maria Atualizada' });
      const items = listRamais();
      expect(items.find(r => r.ramal === '1101')?.nome).toBe('Maria Atualizada');
      const xml = fs.readFileSync(target, 'utf8');
      expect(xml).toContain('Maria Atualizada');
    } finally {
      fs.writeFileSync(target, original, 'utf8');
    }
  });
});

