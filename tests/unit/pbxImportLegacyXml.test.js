describe('pbx-import legacy XML helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('parseXmlBlocks extrai múltiplos blocos do mesmo tipo', () => {
    // eslint-disable-next-line global-require
    const { parseXmlBlocks } = require('../../scripts/pbxImportLegacyXml');
    const xml = `<?xml version="1.0"?>
<root>
  <interconexao><nome>A</nome></interconexao>
  <interconexao><nome>B</nome></interconexao>
</root>`;
    const blocks = parseXmlBlocks(xml, 'interconexao');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('<nome>A</nome>');
    expect(blocks[1]).toContain('<nome>B</nome>');
  });

  test('extractTag extrai conteúdo de tag com trim', () => {
    // eslint-disable-next-line global-require
    const { extractTag } = require('../../scripts/pbxImportLegacyXml');
    const block = '<fila><nome>  suporte  </nome><estrategia>ringall</estrategia></fila>';
    expect(extractTag(block, 'nome')).toBe('suporte');
    expect(extractTag(block, 'estrategia')).toBe('ringall');
    expect(extractTag(block, 'inexistente')).toBe(null);
  });

  test('normalizeName usa fallback quando vazio', () => {
    // eslint-disable-next-line global-require
    const { normalizeName } = require('../../scripts/pbxImportLegacyXml');
    const n1 = normalizeName('  tronco-1  ', 'trunk');
    expect(n1).toBe('tronco-1');
    const n2 = normalizeName('', 'trunk');
    expect(n2.startsWith('trunk_')).toBe(true);
    expect(n2.length).toBeGreaterThan('trunk_'.length);
  });
});

