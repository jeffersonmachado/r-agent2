const path = require('path');
const fs = require('fs');
const os = require('os');

function makeXmlDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-legacy-xml-'));
}

function loadService() {
  // eslint-disable-next-line global-require
  return require('../../api/services/pbxLegacy/xmlEntities');
}

describe('pbxLegacy xmlEntities', () => {
  let xmlDir;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.PBX_LEGACY_ROOT;
    delete process.env.PBX_LEGACY_XML_DIR;
    xmlDir = makeXmlDir();
  });

  afterEach(() => {
    fs.rmSync(xmlDir, { recursive: true, force: true });
  });

  test('lança pbx_xml_dir_not_configured sem diretório configurado', () => {
    // api/data/config.json do ambiente define pbx.legacy.xmlDir; simulamos
    // um servidor sem configuração mockando o resolvedor de paths.
    jest.doMock('../../api/services/pbxLegacy/paths', () => ({ getXmlDir: () => null }));
    const svc = loadService();
    expect(() => svc.listXmlEntities('ddr')).toThrow(
      expect.objectContaining({ code: 'pbx_xml_dir_not_configured' })
    );
    jest.dontMock('../../api/services/pbxLegacy/paths');
  });

  test('lança unknown_entity para entidade fora da whitelist', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    expect(() => svc.listXmlEntities('foo')).toThrow(
      expect.objectContaining({ code: 'unknown_entity' })
    );
    // path traversal não passa pela whitelist
    expect(() => svc.listXmlEntities('../ramal')).toThrow(
      expect.objectContaining({ code: 'unknown_entity' })
    );
  });

  test('listXmlEntities faz parse do formato legado do ddr.xml', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    fs.writeFileSync(
      path.join(xmlDir, 'ddr.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<ddrs>\n  <ramal num="1101">\n    <origem>0800 123 456</origem>\n    <operadora>21</operadora>\n  </ramal>\n  <ramal num="1102">\n    <origem>0800 999 000</origem>\n    <operadora>15</operadora>\n  </ramal>\n</ddrs>\n`,
      'utf8'
    );
    const svc = loadService();
    const result = svc.listXmlEntities('ddr');
    expect(result.entity).toBe('ddr');
    expect(result.file).toBe('ddr.xml');
    expect(result.rootTag).toBe('ddrs');
    expect(result.itemTag).toBe('ramal');
    expect(result.supported).toContain('ddr');
    expect(result.supported).toContain('transferencia');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('1101');
    expect(result.items[0].origem).toBe('0800 123 456');
    expect(result.items[0].operadora).toBe('21');
    expect(result.items[0]._attrs).toEqual({ num: '1101' });
  });

  test('listXmlEntities retorna items vazio quando o arquivo não existe', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    const result = svc.listXmlEntities('grupo');
    expect(result.items).toEqual([]);
    expect(result.itemTag).toBe('numero');
  });

  test('upsertXmlEntity cria arquivo novo com convenção de root/item/idAttr', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    const saved = svc.upsertXmlEntity('ddr', { id: '1101', origem: '0800 123 456', operadora: '21' });
    expect(saved.id).toBe('1101');

    const xml = fs.readFileSync(path.join(xmlDir, 'ddr.xml'), 'utf8');
    expect(xml).toContain('<ramal num="1101">');
    expect(xml).toContain('<origem>0800 123 456</origem>');

    const round = svc.listXmlEntities('ddr');
    expect(round.items).toHaveLength(1);
    expect(round.items[0].operadora).toBe('21');
  });

  test('upsertXmlEntity mescla preservando campos e atributos desconhecidos', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    fs.writeFileSync(
      path.join(xmlDir, 'ddr.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<ddrs>\n  <ramal num="1101" extra="keep">\n    <origem>0800 123 456</origem>\n    <operadora>21</operadora>\n    <custom>x</custom>\n  </ramal>\n</ddrs>\n`,
      'utf8'
    );
    const svc = loadService();
    svc.upsertXmlEntity('ddr', { id: '1101', operadora: '15' });

    const round = svc.listXmlEntities('ddr');
    expect(round.items).toHaveLength(1);
    expect(round.items[0].origem).toBe('0800 123 456');
    expect(round.items[0].operadora).toBe('15');
    expect(round.items[0].custom).toBe('x');

    const xml = fs.readFileSync(path.join(xmlDir, 'ddr.xml'), 'utf8');
    expect(xml).toContain('extra="keep"');
    expect(xml).toContain('<custom>x</custom>');
  });

  test('upsertXmlEntity exige id', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    expect(() => svc.upsertXmlEntity('ddr', { origem: 'x' })).toThrow(
      expect.objectContaining({ code: 'id_required' })
    );
  });

  test('upsertXmlEntity escapa XML nos valores', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    svc.upsertXmlEntity('grupo', { id: '7', nome: 'A&B <Corp> "Q"' });
    const xml = fs.readFileSync(path.join(xmlDir, 'grupo.xml'), 'utf8');
    expect(xml).toContain('A&amp;B &lt;Corp&gt; &quot;Q&quot;');
    const round = svc.listXmlEntities('grupo');
    expect(round.items[0].nome).toBe('A&amp;B &lt;Corp&gt; &quot;Q&quot;'.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  });

  test('removeXmlEntity remove item existente e falha com not_found para ausente', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    svc.upsertXmlEntity('feriado', { id: '2026-12-25', nome: 'Natal' });
    svc.upsertXmlEntity('feriado', { id: '2026-01-01', nome: 'Confraternização' });

    const removed = svc.removeXmlEntity('feriado', '2026-12-25');
    expect(removed.removed).toBe('2026-12-25');
    const round = svc.listXmlEntities('feriado');
    expect(round.items).toHaveLength(1);
    expect(round.items[0].id).toBe('2026-01-01');

    expect(() => svc.removeXmlEntity('feriado', '2026-12-25')).toThrow(
      expect.objectContaining({ code: 'not_found' })
    );
  });

  test('entidades usam itemTag/idAttr fiéis ao legado C', () => {
    process.env.PBX_LEGACY_XML_DIR = xmlDir;
    const svc = loadService();
    const expected = {
      ddr: ['ramal', 'num'],
      grupo: ['numero', 'num'],
      desvio: ['ramal', 'num'],
      transbordo: ['id', 'num'],
      bloqueio: ['ramal', 'num'],
      retorno: ['ramal', 'num'],
      recusa: ['telefone', 'num'],
      feriado: ['data', 'dat'],
      transferencia: ['ramal', 'num'],
    };
    for (const [entity, [itemTag, idAttr]] of Object.entries(expected)) {
      const schema = svc.getEntitySchema(entity);
      expect(schema.file).toBe(`${entity}.xml`);
      expect(schema.itemTag).toBe(itemTag);
      expect(schema.idAttr).toBe(idAttr);
    }
  });
});
