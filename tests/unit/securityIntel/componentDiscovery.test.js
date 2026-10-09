'use strict';

/**
 * Testes da descoberta de componentes.
 *
 * Dois eixos:
 *   1. REPOSITÓRIO REAL — prova que o inventário lê as fontes reais do RAP
 *      (lockfiles, requirements, compose) e devolve versões efetivamente
 *      instaladas, com integridade e origem.
 *   2. FIXTURES CONTROLADAS — provam os caminhos que o repo real não exercita
 *      hoje: drift declarado×resolvido, dependência declarada sem instalação,
 *      pacote instalado fora do manifesto e divergência resolved×running.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  discoverComponents,
  computeDrift,
} = require('../../../api/services/securityIntel/componentDiscoveryService');

const {
  parseRequirementsTxt,
  parseComposeImages,
  readNpmProject,
  buildNpmDependencyEdges,
  computeReachability,
  splitImageReference,
} = require('../../../api/services/securityIntel/manifestReaders');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const NOW = '2026-10-08T12:00:00.000Z';

function makeTempProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-secintel-'));
  for (const [relative, content] of Object.entries(files)) {
    const abs = path.join(dir, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return dir;
}

/**
 * Oráculo INDEPENDENTE para os serviços do compose: leitura de TEXTO (indentação de 2 espaços
 * sob `services:`), deliberadamente sem reusar `parseComposeImages` do código de produção — um
 * oráculo que chama o parser sob teste não provaria nada.
 *
 * Por que não uma lista fixa (medido em 2026-10-09): a expectativa anterior enumerava 7 serviços e
 * quebrou quando o compose ganhou/perdeu `engineering-runner` (o serviço dedicado do Router V1, em
 * descomissionamento por outra frente). O nome do teste é "todas as imagens do compose são
 * inventariadas" — a asserção tem de medir COBERTURA (nada omitido, nada fantasma), não congelar a
 * topologia. Derivar do compose mantém a força (igualdade nos dois sentidos) e para de acusar
 * mudança legítima de topologia.
 */
function servicosDoCompose(texto) {
  const linhas = String(texto).split(/\r?\n/);
  const inicio = linhas.findIndex((linha) => /^services:\s*$/.test(linha));
  const nomes = [];
  for (let i = inicio + 1; i >= 0 && i < linhas.length; i += 1) {
    const linha = linhas[i];
    if (/^[A-Za-z]/.test(linha)) break; // próxima seção de topo (`volumes:`, `networks:`)
    const achado = linha.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
    if (achado) nomes.push(achado[1]);
  }
  return nomes.sort();
}

describe('descoberta — repositório real', () => {
  let discovery;

  beforeAll(async () => {
    discovery = await discoverComponents({ rootDir: REPO_ROOT, now: NOW });
  }, 60000);

  test('lê os lockfiles reais e traz dependências transitivas', () => {
    const lockSources = discovery.sources.filter((source) => source.kind === 'npm-lock' && source.status === 'READ');
    expect(lockSources.map((source) => source.path).sort()).toEqual([
      'frontend/package-lock.json',
      'package-lock.json',
    ]);
    const transitive = discovery.components.filter((component) => component.direct === false);
    expect(transitive.length).toBeGreaterThan(100);
    expect(discovery.counts.byVersionClass.RESOLVED).toBeGreaterThan(1000);
  });

  test('versão vem do lockfile com integridade e serviço consumidor', () => {
    const express = discovery.components.find(
      (component) => component.ecosystem === 'npm' && component.name === 'express' && component.service === 'api'
    );
    expect(express).toBeDefined();
    expect(express.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(express.versionClass).toBe('RESOLVED');
    expect(express.source).toBe('package-lock.json');
    expect(express.integrity).toMatch(/^sha(256|512)-/);
    expect(express.direct).toBe(true);
    expect(express.purl).toMatch(/^pkg:npm\/express@/);
  });

  test('requirements do RAG: pin exato é RESOLVED, range é DECLARED', () => {
    const pinned = discovery.components.find(
      (component) => component.ecosystem === 'pypi' && component.name === 'fastapi'
    );
    expect(pinned).toBeDefined();
    expect(pinned.versionClass).toBe('RESOLVED');
    expect(pinned.version).toMatch(/^\d+\.\d+/);
    const floating = discovery.requirements.find(
      (requirement) => requirement.ecosystem === 'pypi' && requirement.range !== '*' && !requirement.range.startsWith('==')
    );
    // O arquivo real pode não ter ranges; o contrato é: se houver, não vira componente.
    if (floating) {
      expect(discovery.components.some((component) => component.name === floating.name && component.ecosystem === 'pypi')).toBe(false);
    }
  });

  test('todas as imagens do compose de produção são inventariadas (inclui mcp-research)', () => {
    const services = discovery.components
      .filter((component) => component.ecosystem === 'docker' && component.source === 'docker-compose.prod.yml')
      .map((component) => component.service)
      .sort();
    const declarados = servicosDoCompose(fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.prod.yml'), 'utf8'));
    // Igualdade nos DOIS sentidos: serviço do compose fora do inventário (omissão) e componente do
    // inventário que o compose não declara (fantasma) quebram aqui.
    expect(declarados.length).toBeGreaterThan(5);
    expect(services).toEqual(declarados);
    expect(services).toContain('mcp-research');
    const postgres = discovery.components.find((component) => component.service === 'postgres' && component.source === 'docker-compose.prod.yml');
    expect(postgres.name).toBe('pgvector/pgvector');
    expect(postgres.version).toBe('pg16');
    expect(postgres.builtLocally).toBe(false);
    expect(postgres.pinnedByDigest).toBe(false);
    const api = discovery.components.find((component) => component.service === 'api' && component.source === 'docker-compose.prod.yml');
    expect(api.versionClass).toBe('BUILT');
    expect(api.builtLocally).toBe(true);
  });

  test('runtime do host é inventariado como RUNNING', () => {
    const node = discovery.components.find((component) => component.name === 'node' && component.versionClass === 'RUNNING');
    expect(node).toBeDefined();
    expect(node.version).toMatch(/^\d+\.\d+/);
    const openssl = discovery.components.find((component) => component.name === 'openssl');
    expect(openssl).toBeDefined();
    expect(openssl.versionClass).toBe('RUNNING');
    expect(process.versions.openssl).toContain(openssl.version.split('-')[0]);
  });

  test('probes ausentes viram indisponibilidade explícita (nunca componente inventado)', () => {
    const sources = discovery.unavailable.map((entry) => entry.source);
    expect(sources).toContain('pg:SELECT version()');
    expect(sources).toContain('redis:INFO server');
    expect(sources.some((source) => source.startsWith('rag:'))).toBe(true);
    expect(discovery.components.some((component) => component.service === 'postgres' && component.versionClass === 'RUNNING')).toBe(false);
  });

  test('cobertura declara limites — nada de cobertura inventada', () => {
    expect(discovery.coverage.outOfScope.length).toBeGreaterThan(0);
    expect(discovery.coverage.outOfScope.map((entry) => entry.id)).toContain('hardware-firmware');
    expect(discovery.coverage.coveragePercent).toBeGreaterThan(50);
    expect(discovery.coverage.coveragePercent).toBeLessThanOrEqual(100);
  });

  test('grafo de dependências resolvido existe e não aponta para refs inexistentes', () => {
    const known = new Set(discovery.components.map((component) => component.bomRef));
    expect(discovery.dependencyEdges.length).toBeGreaterThan(100);
    for (const edge of discovery.dependencyEdges.slice(0, 200)) {
      expect(known.has(edge.from)).toBe(true);
      for (const target of edge.targets) expect(known.has(target)).toBe(true);
    }
  });

  test('identidade é canônica e única', () => {
    const refs = discovery.components.map((component) => component.bomRef);
    expect(new Set(refs).size).toBe(refs.length);
    expect(discovery.identityConflicts).toEqual([]);
  });
});

describe('descoberta — fixtures controladas', () => {
  test('drift: resolvido fora da faixa declarada é reportado, não escondido', async () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0', dependencies: { left: '^1.0.0' } },
      'package-lock.json': {
        name: 'x',
        lockfileVersion: 3,
        packages: {
          '': { name: 'x', version: '1.0.0', dependencies: { left: '^1.0.0' } },
          'node_modules/left': { version: '2.0.0', integrity: 'sha512-AAAA' },
        },
      },
    });
    const discovery = await discoverComponents({ rootDir: dir, now: NOW });
    const drift = discovery.drift.find((entry) => entry.kind === 'declared_vs_resolved');
    expect(drift).toMatchObject({ key: 'npm:left', verdict: 'drift', declared: '^1.0.0', resolved: '2.0.0' });
  });

  test('declarado sem instalação e instalado fora do manifesto são achados', async () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0', dependencies: { ausente: '^1.0.0' } },
      'package-lock.json': {
        name: 'x',
        lockfileVersion: 3,
        packages: {
          '': { name: 'x', version: '1.0.0' },
          'node_modules/solto': { version: '3.0.0' },
        },
      },
    });
    const discovery = await discoverComponents({ rootDir: dir, now: NOW });
    const codes = discovery.warnings.map((warning) => warning.code);
    expect(codes).toContain('npm_declared_not_installed');
    // `solto` está instalado mas não é alcançável por nenhuma dependência declarada.
    expect(codes).toContain('npm_installed_not_declared');
    const warning = discovery.warnings.find((item) => item.code === 'npm_installed_not_declared');
    expect(warning.items).toEqual(['node_modules/solto']);
    const missing = discovery.warnings.find((item) => item.code === 'npm_declared_not_installed');
    expect(missing.items).toEqual(['ausente']);
  });

  test('probe de serviço injetado produz RUNNING e drift resolved×running', async () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0' },
      'package-lock.json': { name: 'x', lockfileVersion: 3, packages: { '': { name: 'x', version: '1.0.0' } } },
    });
    const discovery = await discoverComponents({
      rootDir: dir,
      now: NOW,
      probes: {
        postgres: () => ({ version: '16.4', extensions: { vector: '0.8.1' } }),
        redis: () => ({ version: '7.4.1' }),
      },
    });
    const postgres = discovery.components.find((component) => component.name === 'postgresql');
    expect(postgres).toMatchObject({ version: '16.4', versionClass: 'RUNNING' });
    const vector = discovery.components.find((component) => component.name === 'vector');
    expect(vector).toMatchObject({ version: '0.8.1', kind: 'database-extension' });
    expect(discovery.unavailable.map((entry) => entry.source)).not.toContain('pg:SELECT version()');
  });

  test('probe que falha é indisponibilidade, não inventa componente', async () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0' },
      'package-lock.json': { name: 'x', lockfileVersion: 3, packages: { '': { name: 'x', version: '1.0.0' } } },
    });
    const discovery = await discoverComponents({
      rootDir: dir,
      now: NOW,
      probes: {
        redis: () => {
          throw new Error('connection refused');
        },
      },
    });
    const entry = discovery.unavailable.find((item) => item.source === 'redis:INFO server');
    expect(entry.reason).toMatch(/probe_failed:connection refused/);
    expect(discovery.components.some((component) => component.name === 'redis')).toBe(false);
  });

  test('lockfile ausente é reportado e reduz cobertura (não finge inventário completo)', async () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0', dependencies: { left: '^1.0.0' } },
    });
    const discovery = await discoverComponents({ rootDir: dir, now: NOW });
    expect(discovery.warnings.map((warning) => warning.code)).toContain('npm_lock_missing');
    expect(discovery.coverage.failed.map((entry) => entry.path)).toContain('package-lock.json');
    expect(discovery.counts.byVersionClass.RESOLVED).toBe(0);
  });

  test('mesma identidade com conteúdo diferente é conflito (não é deduplicado em silêncio)', async () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0' },
      'package-lock.json': {
        name: 'x',
        lockfileVersion: 3,
        packages: {
          '': { name: 'x', version: '1.0.0' },
          'node_modules/dup': { version: '1.0.0', integrity: 'sha512-AAAA' },
          'node_modules/a/node_modules/dup': { version: '1.0.0', integrity: 'sha512-BBBB' },
        },
      },
    });
    const discovery = await discoverComponents({ rootDir: dir, now: NOW });
    // Dois caminhos distintos, mesma purl+versão: ambos são legítimos e contados.
    const dups = discovery.components.filter((component) => component.name === 'dup');
    expect(dups).toHaveLength(2);
  });
});

describe('manifestReaders — unidades', () => {
  test('parseRequirementsTxt separa pin de range e preserva marcador', () => {
    const parsed = parseRequirementsTxt(
      ['fastapi==0.141.1', 'torch>=2.0.0', 'uvicorn~=0.52.0  # web', 'pywin32==1.0 ; sys_platform == "win32"', '-r extra.txt', 'lixo !!!'].join('\n'),
      { service: 'rag-service', source: 'requirements.txt' }
    );
    expect(parsed.components.map((component) => component.name)).toEqual(['fastapi', 'pywin32']);
    expect(parsed.requirements.map((requirement) => `${requirement.name}${requirement.range}`)).toEqual(['torch>=2.0.0', 'uvicorn~=0.52.0']);
    expect(parsed.components[1].environmentMarker).toBe('sys_platform == "win32"');
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['requirements_directive_skipped', 'requirements_line_unparsed'])
    );
  });

  test('parseComposeImages ignora volumes/networks e marca build local', () => {
    const parsed = parseComposeImages(
      [
        'services:',
        '  api:',
        '    build:',
        '      context: .',
        '    image: r-agent2-api:latest',
        '  db:',
        '    image: pgvector/pgvector:pg16',
        'volumes:',
        '  data:',
        '  other:',
        '    image: nao-e-servico:1',
      ].join('\n'),
      { source: 'docker-compose.prod.yml', service: 'docker-compose.prod.yml' }
    );
    expect(parsed.images.map((image) => image.service)).toEqual(['api', 'db']);
    expect(parsed.images[0]).toMatchObject({ name: 'r-agent2-api', tag: 'latest', builtLocally: true });
    expect(parsed.images[1]).toMatchObject({ name: 'pgvector/pgvector', tag: 'pg16', builtLocally: false });
  });

  test('splitImageReference distingue tag de digest', () => {
    expect(splitImageReference('pgvector/pgvector:pg16')).toEqual(['pgvector/pgvector', 'pg16']);
    expect(splitImageReference('localhost:5000/x/y:1.0')).toEqual(['localhost:5000/x/y', '1.0']);
    expect(splitImageReference('node@sha256:abc')).toEqual(['node', '@sha256:abc']);
    expect(splitImageReference('node')).toEqual(['node', null]);
  });

  test('readNpmProject lê lockfileVersion 3 e resolve arestas aninhadas', () => {
    const dir = makeTempProject({
      'package.json': { name: 'x', version: '1.0.0', dependencies: { a: '^1.0.0' } },
      'package-lock.json': {
        name: 'x',
        lockfileVersion: 3,
        packages: {
          '': { name: 'x', version: '1.0.0' },
          'node_modules/a': { version: '1.0.0', dependencies: { b: '^1.0.0' } },
          'node_modules/a/node_modules/b': { version: '1.0.0' },
          'node_modules/b': { version: '2.0.0' },
          'node_modules/c': { version: '2.0.0', dependencies: { b: '^1.0.0' } },
        },
      },
    });
    const result = readNpmProject({ rootDir: dir, dir: '', service: 'api' });
    expect(result.components).toHaveLength(4);
    const edges = buildNpmDependencyEdges({ dependencyEdges: result.dependencyEdges, components: result.components });
    const fromA = edges.find((edge) => edge.from.name === 'a');
    const fromC = edges.find((edge) => edge.from.name === 'c');
    // Resolução do Node: aninhado primeiro, hoisted como fallback.
    expect(fromA.targets[0].lockPath).toBe('node_modules/a/node_modules/b');
    expect(fromC.targets[0].lockPath).toBe('node_modules/b');
    const gaps = computeReachability({
      packages: {
        'node_modules/a': { version: '1.0.0' },
        'node_modules/a/node_modules/b': { version: '1.0.0' },
        'node_modules/b': { version: '2.0.0' },
        'node_modules/c': { version: '2.0.0' },
      },
      dependencyEdges: [
        { lockPath: 'node_modules/a', deps: ['b'] },
        { lockPath: 'node_modules/c', deps: ['b'] },
      ],
      manifestNames: ['a'],
      components: result.components,
    });
    expect(gaps.missingDeclared).toEqual([]);
    // `c` é inalcançável e o `b` hoisted também: ninguém os alcança pelo manifesto.
    expect(gaps.extraneous).toEqual(['node_modules/b', 'node_modules/c']);
  });

  test('computeDrift não classifica como drift o que não é comparável', () => {
    const drift = computeDrift({
      requirements: [{ ecosystem: 'npm', name: 'x', range: '>=1.0.0', service: 'api', source: 'package.json' }],
      components: [
        { ecosystem: 'npm', name: 'x', version: 'not-a-version', versionClass: 'RESOLVED', service: 'api', source: 'package-lock.json' },
      ],
    });
    expect(drift).toHaveLength(1);
    expect(drift[0].verdict).toBe('unverifiable');
  });
});
