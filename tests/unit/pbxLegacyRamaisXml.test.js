describe('pbxLegacy ramaisXml', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('parseRamaisXml extrai campos principais', () => {
    // eslint-disable-next-line global-require
    const { parseRamaisXml } = require('../../api/services/pbxLegacy/ramaisXml');
    const xml = `<?xml version="1.0"?>
<ramais>
  <ramal ramal="1101"><nome> Maria </nome><usuario> U </usuario><protocolo>PJSIP</protocolo></ramal>
</ramais>`;
    const items = parseRamaisXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ramal: '1101', nome: 'Maria', usuario: 'U', protocolo: 'PJSIP' });
  });

  test('serializeRamaisXml gera XML com blocos ramal', () => {
    // eslint-disable-next-line global-require
    const { serializeRamaisXml } = require('../../api/services/pbxLegacy/ramaisXml');
    const out = serializeRamaisXml([{ ramal: '1101', nome: 'Maria', usuario: 'U' }]);
    expect(out).toContain('<ramal ramal="1101">');
    expect(out).toContain('<nome>Maria</nome>');
    expect(out).toContain('<usuario>U</usuario>');
    expect(out).toContain('</ramais>');
  });
});

