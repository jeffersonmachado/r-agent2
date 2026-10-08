'use strict';

/**
 * Testes de identidade de componente (PURL) e do gerador/validador de SBOM.
 *
 * Provas exigidas:
 *   - PURL conforme spec e round-trip.
 *   - Deduplicação NÃO esconde conflito de identidade (lança).
 *   - SBOM determinístico (mesma entrada ⇒ mesmo documento).
 *   - Validador reprova SBOM estruturalmente inválido (refs duplicadas,
 *     dependency não resolvida, purl inválido, licença vazia, hash inválido).
 */

const {
  buildPurl,
  parsePurl,
  componentKey,
  bomRef,
  dedupeComponents,
  deterministicUuid,
  normalizeName,
} = require('../../../engine/securityIntel/componentIdentity');

const {
  buildSbom,
  validateSbom,
  serializeSbom,
} = require('../../../engine/securityIntel/sbomBuilder');

const NOW = '2026-10-08T12:00:00.000Z';

function lodashComponent(overrides = {}) {
  return {
    ecosystem: 'npm',
    name: 'lodash',
    version: '4.17.21',
    versionClass: 'RESOLVED',
    service: 'api',
    source: 'package-lock.json',
    ...overrides,
  };
}

describe('componentIdentity — PURL', () => {
  test('npm simples, escopado e com versão', () => {
    expect(buildPurl({ ecosystem: 'npm', name: 'Lodash', version: '4.17.21' })).toBe('pkg:npm/lodash@4.17.21');
    expect(buildPurl({ ecosystem: 'npm', name: '@babel/core', version: '7.24.0' })).toBe('pkg:npm/%40babel/core@7.24.0');
    expect(buildPurl({ ecosystem: 'npm', name: '@babel/core' })).toBe('pkg:npm/%40babel/core');
  });

  test('pypi normaliza por PEP 503', () => {
    expect(normalizeName('Sentence_Transformers', 'pypi')).toBe('sentence-transformers');
    expect(buildPurl({ ecosystem: 'pypi', name: 'onnxruntime', version: '1.28.0' })).toBe('pkg:pypi/onnxruntime@1.28.0');
  });

  test('docker preserva o namespace e a caixa', () => {
    expect(buildPurl({ ecosystem: 'docker', name: 'pgvector/pgvector', version: 'pg16' })).toBe('pkg:docker/pgvector/pgvector@pg16');
  });

  test('sem nome não gera purl inventada', () => {
    expect(buildPurl({ ecosystem: 'npm', version: '1.0.0' })).toBeNull();
    expect(componentKey({ ecosystem: 'npm' })).toBeNull();
    expect(bomRef({ ecosystem: 'npm' })).toBeNull();
  });

  test('round-trip: parsePurl(buildPurl(x)) preserva o essencial', () => {
    const purl = buildPurl({ ecosystem: 'npm', name: '@babel/core', version: '7.24.0' });
    expect(parsePurl(purl)).toMatchObject({ type: 'npm', namespace: '%40babel', name: 'core', version: '7.24.0' });
  });

  test('bomRef distingue o mesmo pacote em serviços diferentes', () => {
    const api = bomRef(lodashComponent({ service: 'api' }));
    const frontend = bomRef(lodashComponent({ service: 'frontend' }));
    expect(api).not.toBe(frontend);
    expect(api).toContain('npm:lodash@4.17.21');
  });

  test('dedupe preserva idênticos e LANÇA em conflito de identidade', () => {
    expect(dedupeComponents([lodashComponent(), lodashComponent()])).toHaveLength(1);
    // Duas cópias em caminhos diferentes são componentes DIFERENTES (não conflito).
    expect(dedupeComponents([
      lodashComponent(),
      lodashComponent({ installPath: 'node_modules/a/node_modules/lodash' }),
    ])).toHaveLength(2);
    // Mesma instalação com declaração de identidade contraditória (purl divergente)
    // é conflito: não pode ser resolvido em silêncio.
    expect(() => dedupeComponents([
      lodashComponent(),
      lodashComponent({ purl: 'pkg:generic/lodash@4.17.21' }),
    ])).toThrow(/component_identity_conflict/);
  });

  test('deterministicUuid é estável e tem formato de UUID', () => {
    const first = deterministicUuid('seed');
    expect(first).toBe(deterministicUuid('seed'));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('sbomBuilder — geração', () => {
  const root = { name: 'r-agent2', version: '1.0.0' };

  test('documento determinístico e válido', () => {
    const components = [
      lodashComponent(),
      { ecosystem: 'pypi', name: 'fastapi', version: '0.141.1', service: 'rag-service', source: 'requirements.txt' },
      { ecosystem: 'docker', name: 'pgvector/pgvector', version: 'pg16', service: 'postgres', source: 'docker-compose.prod.yml' },
    ];
    const first = buildSbom({ components, root, now: NOW });
    const second = buildSbom({ components: [...components].reverse(), root, now: NOW });

    expect(serializeSbom(first)).toBe(serializeSbom(second));
    expect(first.serialNumber).toMatch(/^urn:uuid:/);
    expect(first.components.map((c) => c['bom-ref'])).toEqual(
      [...first.components.map((c) => c['bom-ref'])].sort()
    );
    expect(validateSbom(first)).toEqual({ valid: true, issues: [] });
    const lodashEntry = first.components.find((c) => c.name === 'lodash');
    expect(lodashEntry.properties.some((p) => p.name === 'rap:versionClass')).toBe(true);
  });

  test('hash só quando há digest real (integrity do lockfile)', () => {
    const digest = Buffer.alloc(32, 1); // 32 bytes = digest SHA-256 legítimo
    const sbom = buildSbom({
      components: [lodashComponent({ integrity: `sha256-${digest.toString('base64')}` })],
      root,
      now: NOW,
    });
    expect(sbom.components[0].hashes).toEqual([{ alg: 'SHA-256', content: '01'.repeat(32) }]);
  });

  test('integrity com digest de tamanho errado é descartada (não vira hash falso)', () => {
    const sbom = buildSbom({
      components: [lodashComponent({ integrity: 'sha256-aGVsbG8=' })],
      root,
      now: NOW,
    });
    expect(sbom.components[0].hashes).toBeUndefined();
  });

  test('sem licença conhecida o campo é omitido (não inventa NOASSERTION)', () => {
    const sbom = buildSbom({ components: [lodashComponent()], root, now: NOW });
    expect(sbom.components[0].licenses).toBeUndefined();
  });

  test('exige now e root (nada de relógio implícito)', () => {
    expect(() => buildSbom({ components: [], root })).toThrow(/sbom_builder_now_required/);
    expect(() => buildSbom({ components: [], now: NOW })).toThrow(/sbom_builder_root_required/);
  });
});

describe('sbomBuilder — validação', () => {
  const root = { name: 'r-agent2', version: '1.0.0' };
  const baseSbom = () => buildSbom({ components: [lodashComponent()], root, now: NOW });

  test('SBOM válido passa', () => {
    expect(validateSbom(baseSbom()).valid).toBe(true);
  });

  test('reprova bom-ref duplicado e purl inválida', () => {
    const sbom = baseSbom();
    sbom.components.push({ ...sbom.components[0] });
    sbom.components[0].purl = 'nao-e-purl';
    const result = validateSbom(sbom);
    expect(result.valid).toBe(false);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('sbom_component_ref_duplicate');
    expect(codes).toContain('sbom_component_purl_invalid');
  });

  test('reprova dependency não resolvida e auto-referência', () => {
    const sbom = baseSbom();
    sbom.dependencies = [{ ref: sbom.components[0]['bom-ref'], dependsOn: ['inexistente', sbom.components[0]['bom-ref']] }];
    const codes = validateSbom(sbom).issues.map((issue) => issue.code);
    expect(codes).toContain('sbom_dependency_target_unresolved');
    expect(codes).toContain('sbom_dependency_self_reference');
  });

  test('reprova licença vazia e hash inválido', () => {
    const sbom = baseSbom();
    sbom.components[0].licenses = [{ license: {} }];
    sbom.components[0].hashes = [{ alg: 'SHA-256', content: 'abc' }];
    const codes = validateSbom(sbom).issues.map((issue) => issue.code);
    expect(codes).toContain('sbom_component_license_empty');
    expect(codes).toContain('sbom_component_hash_invalid');
  });

  test('reprova doc sem components e serialNumber inválido', () => {
    expect(validateSbom({ bomFormat: 'CycloneDX', specVersion: '1.5', components: [] }).valid).toBe(false);
    const sbom = baseSbom();
    sbom.serialNumber = 'nao-e-urn';
    expect(validateSbom(sbom).issues.map((i) => i.code)).toContain('sbom_serial_number_invalid');
  });
});
