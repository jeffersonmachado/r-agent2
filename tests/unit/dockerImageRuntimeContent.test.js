'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Regressão de defeito de produção verificado (2026-09-11):
 *
 * A imagem Docker da API não continha `docs/` (excluído no `.dockerignore` e
 * nunca copiado no Dockerfile), mas a rota viva `GET /api/qa-waves/docs/:type`
 * serve `docs/roteiros` e `docs/diagrams/qa-waves` em runtime. Resultado: 404 na
 * imagem, erros de console em `/dev/qa-waves` e cenários de fitness falhando no
 * mesh. O mesmo valia para `dev Documentos/`, lido pela API viva de
 * dev-management.
 *
 * Este teste trava o contrato: todo conteúdo de repositório consumido por rota
 * viva precisa (1) existir, (2) não estar excluído do contexto de build e
 * (3) ser copiado para o estágio runtime da imagem.
 */

const REQUIRED_RUNTIME_CONTENT = [
  {
    root: 'docs/roteiros',
    route: 'GET /api/qa-waves/docs/roteiros',
    consumer: 'api/modules/qa-waves/routes.js',
  },
  {
    root: 'docs/diagrams/qa-waves',
    route: 'GET /api/qa-waves/docs/diagrams',
    consumer: 'api/modules/qa-waves/routes.js',
  },
  {
    root: 'dev Documentos',
    route: 'GET /api/dev-management/*',
    consumer: 'api/modules/dev-management/handleDevManagementRoutes.js',
  },
];

function readDockerignorePatterns() {
  return fs
    .readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Avaliação no espírito do .dockerignore: o ÚLTIMO padrão que casa (com o
 * arquivo ou com qualquer diretório ancestral) decide. `*` não atravessa `/`.
 */
function isExcludedFromBuild(relPath, patterns = readDockerignorePatterns()) {
  const segments = relPath.split('/');
  const candidates = segments.map((_, index) => segments.slice(0, index + 1).join('/'));

  let excluded = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith('!');
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    const normalizedPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;

    const matches = candidates.some((candidate) => {
      const regex = new RegExp(
        `^${normalizedPattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*')}$`,
      );
      return regex.test(candidate);
    });

    if (matches) excluded = !negated;
  }

  return excluded;
}

function readDockerfile() {
  return fs.readFileSync(path.join(ROOT, 'api', 'Dockerfile'), 'utf8');
}

/** Normaliza escapes de espaço (`dev\ Documentos`) para comparação. */
function normalizeDockerPath(value) {
  return value.replace(/\\ /g, ' ');
}

function runtimeStageCopiesRoot(dockerfile, root) {
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('AS runtime'));
  // O BuildKit não aceita espaços em COPY (origem ou destino), então diretórios
  // com espaço no nome entram por um caminho temporário e são renomeados com
  // `RUN mv` no estágio runtime. Ambos contam como materialização do conteúdo.
  return runtimeStage
    .split('\n')
    .filter((line) => /^(COPY|RUN\s+mv)\b/.test(line.trim()))
    .some((line) => normalizeDockerPath(line).includes(root));
}

/** `docs/roteiros` é coberto por `COPY docs/ ./docs/` + repasse do builder. */
function dockerfileCoversRoot(dockerfile, root) {
  const candidates = [root];
  const segments = root.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    candidates.push(segments.slice(0, index).join('/'));
  }
  return candidates.some((candidate) => runtimeStageCopiesRoot(dockerfile, candidate));
}

describe('imagem Docker — conteúdo de runtime de APIs vivas', () => {
  const dockerfile = readDockerfile();
  const patterns = readDockerignorePatterns();

  it.each(REQUIRED_RUNTIME_CONTENT)('$root existe e não está vazio', ({ root }) => {
    const absolute = path.join(ROOT, root);
    expect(fs.existsSync(absolute)).toBe(true);
    expect(fs.statSync(absolute).isDirectory()).toBe(true);
    expect(fs.readdirSync(absolute).length).toBeGreaterThan(0);
  });

  it.each(REQUIRED_RUNTIME_CONTENT)(
    '$root não é excluído do contexto de build (consumido por $route)',
    ({ root }) => {
      expect(isExcludedFromBuild(root, patterns)).toBe(false);
    },
  );

  it.each(REQUIRED_RUNTIME_CONTENT)('$root é materializado no estágio runtime da imagem', ({ root }) => {
    expect(dockerfileCoversRoot(dockerfile, root)).toBe(true);
  });

  it('mantém o restante de docs/ fora da imagem (não empacotar documentação inteira)', () => {
    expect(isExcludedFromBuild('docs/architecture/RAP_MASTER_SCORECARD.md', patterns)).toBe(true);
    expect(isExcludedFromBuild('docs/governance/PLATFORM_STATUS.md', patterns)).toBe(true);
    expect(isExcludedFromBuild('docs/roteiros/jornada-beauty-beauty_booking.md', patterns)).toBe(false);
  });
});
