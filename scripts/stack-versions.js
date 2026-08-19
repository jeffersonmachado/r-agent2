'use strict';

/**
 * Stack Versions — fonte declarada + validação de fiação do recurso.
 *
 * Mantém a página "Versões da Stack" (/dev/stack-versions) rastreável e
 * íntegra em duas frentes:
 *
 * 1. `sync`     — lê as versões DECLARADAS nas fontes canônicas
 *                 (package.json, rag-service/requirements.txt,
 *                  rag-service/config/settings.py, docker-compose.prod.yml)
 *                 e regenera o bloco gerenciado em `AI_MEMORY/stack-versions.md`
 *                 + `reports/stack-versions-report.json`.
 *
 * 2. `validate` — recalcula o fingerprint das fontes declaradas e o compara com
 *                 o gravado no doc; também valida a fiação frontend/backend da
 *                 feature (página, rota, item de menu, handler /version).
 *                 Sai com código 1 se algo estiver fora de sincronia.
 *
 * Uso:
 *   node scripts/stack-versions.js sync
 *   node scripts/stack-versions.js validate
 *
 * Regra para agentes: SEMPRE que a stack mudar (Node, npm, versão do pacote,
 * pins do RAG, modelo de embeddings, imagens do compose), rode
 * `npm run stack:versions:sync` e commit o doc atualizado.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const DOC_PATH = path.join(ROOT, 'AI_MEMORY', 'stack-versions.md');
const REPORT_PATH = path.join(ROOT, 'reports', 'stack-versions-report.json');

const MARKER_START = '<!-- STACK_VERSIONS_AUTO_START -->';
const MARKER_END = '<!-- STACK_VERSIONS_AUTO_END -->';

// --- Parsers das fontes declaradas --------------------------------------

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** Extrai `name==version` de um requirements.txt (ignora comentários/flags). */
function parseRequirements(relPath) {
  const text = readText(relPath);
  const pins = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('--')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==([^\s;]+)/);
    if (match) pins[match[1]] = match[2];
  }
  return pins;
}

/** Extrai o modelo de embeddings default de rag-service/config/settings.py. */
function parseEmbeddingModel(relPath) {
  const text = readText(relPath);
  const match = text.match(/sentence-transformers\/[A-Za-z0-9._/-]+/);
  return match ? match[0] : 'unknown';
}

/** Extrai pares `serviço -> imagem` de um docker-compose. */
function parseComposeImages(relPath) {
  const text = readText(relPath);
  const images = {};
  const serviceRe = /^  ([A-Za-z0-9_.-]+):\s*$/m;
  const imageRe = /^\s{4}image:\s*([^\s#]+)/;
  const lines = text.split('\n');
  let currentService = null;
  for (const line of lines) {
    const serviceMatch = line.match(serviceRe);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      continue;
    }
    if (currentService) {
      const imageMatch = line.match(imageRe);
      if (imageMatch) {
        images[currentService] = imageMatch[1];
        currentService = null;
      }
    }
  }
  return images;
}

/** Monta a matriz de versões declaradas a partir das fontes canônicas. */
function collectDeclaredStack() {
  const pkg = readJson('package.json');
  const ragPins = parseRequirements('rag-service/requirements.txt');
  const embeddingModel = parseEmbeddingModel('rag-service/config/settings.py');
  const composeImages = parseComposeImages('docker-compose.prod.yml');

  const stack = {
    api: {
      name: pkg.name || 'RAP',
      version: pkg.version || 'unknown',
    },
    runtime: {
      node: (pkg.engines && pkg.engines.node) || 'unknown',
      npm: (pkg.engines && pkg.engines.npm) || 'unknown',
    },
    rag: {
      fastapi: ragPins.fastapi || 'unknown',
      uvicorn: ragPins.uvicorn || 'unknown',
      sentenceTransformers: ragPins['sentence-transformers'] || 'unknown',
      transformers: ragPins.transformers || 'unknown',
      torch: ragPins.torch || 'unknown',
      numpy: ragPins.numpy || 'unknown',
      onnxruntime: ragPins.onnxruntime || 'unknown',
      embeddingModel,
    },
    compose: {
      api: composeImages.api || 'r-agent2-api:latest',
      frontend: composeImages.frontend || 'r-agent2-frontend:latest',
      rag: composeImages['r-agent2-rag-service'] || composeImages['rag-service'] || 'r-agent2-rag-service:latest',
      postgres: composeImages.postgres || 'pgvector/pgvector:pg16',
      redis: composeImages.redis || 'r-agent2-redis:latest',
      asterisk: composeImages.asterisk || 'r-agent2-asterisk:latest',
    },
  };

  return stack;
}

function computeFingerprint(stack) {
  return crypto.createHash('sha256').update(JSON.stringify(stack)).digest('hex');
}

// --- Renderização do bloco gerenciado -----------------------------------

function renderManagedBlock(stack, fingerprint) {
  const rows = [
    ['API (RAP)', stack.api.version, 'package.json'],
    ['Runtime Node.js', stack.runtime.node, 'package.json → engines'],
    ['npm', stack.runtime.npm, 'package.json → engines'],
    ['RAG — FastAPI', stack.rag.fastapi, 'rag-service/requirements.txt'],
    ['RAG — Uvicorn', stack.rag.uvicorn, 'rag-service/requirements.txt'],
    ['RAG — sentence-transformers', stack.rag.sentenceTransformers, 'rag-service/requirements.txt'],
    ['RAG — transformers', stack.rag.transformers, 'rag-service/requirements.txt'],
    ['RAG — torch (CPU)', stack.rag.torch, 'rag-service/requirements.txt'],
    ['RAG — numpy', stack.rag.numpy, 'rag-service/requirements.txt'],
    ['RAG — onnxruntime', stack.rag.onnxruntime, 'rag-service/requirements.txt'],
    ['RAG — modelo de embeddings', stack.rag.embeddingModel, 'rag-service/config/settings.py'],
    ['PostgreSQL (imagem)', stack.compose.postgres, 'docker-compose.prod.yml'],
    ['Redis (imagem)', stack.compose.redis, 'docker-compose.prod.yml'],
    ['Imagem API', stack.compose.api, 'docker-compose.prod.yml'],
    ['Imagem Frontend', stack.compose.frontend, 'docker-compose.prod.yml'],
    ['Imagem RAG Service', stack.compose.rag, 'docker-compose.prod.yml'],
  ];

  const table = rows
    .map(([component, version, source]) => `| ${component} | \`${version}\` | ${source} |`)
    .join('\n');

  return [
    MARKER_START,
    '',
    '> Gerado automaticamente por `npm run stack:versions:sync`. Não edite este bloco:',
    '> atualize a fonte declarada (package.json, requirements.txt, settings.py,',
    '> docker-compose.prod.yml) e rode o sync.',
    '',
    '| Componente | Versão declarada | Fonte |',
    '| --- | --- | --- |',
    table,
    '',
    `Fingerprint: \`${fingerprint}\``,
    '',
    MARKER_END,
  ].join('\n');
}

// --- Doc template (quando o arquivo ainda não existe) --------------------

function renderDocTemplate(block) {
  return [
    '# Stack Versions',
    '',
    'Versões **declaradas** da stack RAP/r-agent2. É a referência canônica do',
    'que a página "Versões da Stack" (`/dev/stack-versions`) espelha no frontend.',
    '',
    '## Como manter atualizada',
    '',
    '1. Quando a stack mudar (Node, npm, versão do pacote, pins do RAG, modelo de',
    '   embeddings, imagens do `docker-compose.prod.yml`), rode:',
    '   `npm run stack:versions:sync`',
    '2. O script regenera o bloco abaixo e `reports/stack-versions-report.json`.',
    '3. Valide antes de concluir: `npm run validate:stack-versions`.',
    '4. Commit o doc (`AI_MEMORY/stack-versions.md`) junto com a mudança.',
    '',
    '> As versões de **runtime** (processo Node, servidor PostgreSQL, Redis, RAG',
    '> em execução) são exibidas em tempo real pela página a partir dos endpoints',
    '> `/version` e `/system/status` — não precisam ser atualizadas aqui.',
    '',
    '## Versões declaradas (auto)',
    '',
    block,
    '',
  ].join('\n');
}

function syncDoc(stack) {
  const fingerprint = computeFingerprint(stack);
  const block = renderManagedBlock(stack, fingerprint);

  let doc;
  if (fs.existsSync(DOC_PATH)) {
    doc = fs.readFileSync(DOC_PATH, 'utf8');
    const start = doc.indexOf(MARKER_START);
    const end = doc.indexOf(MARKER_END);
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(
        `Marcadores ausentes em ${DOC_PATH}. Adicione ${MARKER_START} e ${MARKER_END} ao bloco gerenciado.`
      );
    }
    doc = doc.slice(0, start) + block + doc.slice(end + MARKER_END.length);
  } else {
    doc = renderDocTemplate(block);
  }

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, doc);
  return fingerprint;
}

// --- Validação de fiação (frontend/backend) -----------------------------

function checkWiring() {
  const checks = [];
  const add = (check, status, detail) => checks.push({ check, status, detail });

  // Página
  const pageExists = fs.existsSync(path.join(ROOT, 'frontend/src/pages/StackVersionsPage.jsx'));
  add('frontend.pagina', pageExists ? 'PASS' : 'FAIL', pageExists
    ? 'frontend/src/pages/StackVersionsPage.jsx existe'
    : 'frontend/src/pages/StackVersionsPage.jsx ausente');

  // Item de menu
  try {
    const menu = readText('frontend/src/navigation/menu.js');
    const hasMenuItem = menu.includes("id: 'stack-versions'") && menu.includes('/dev/stack-versions');
    add('frontend.menu', hasMenuItem ? 'PASS' : 'FAIL', hasMenuItem
      ? 'item "Versões da Stack" presente em navigation/menu.js'
      : 'item de menu stack-versions ausente em navigation/menu.js');
  } catch (err) {
    add('frontend.menu', 'FAIL', `erro ao ler menu.js: ${err.message}`);
  }

  // Rota no main.jsx
  try {
    const main = readText('frontend/src/main.jsx');
    const hasImport = main.includes("lazyPage(() => import('./pages/StackVersionsPage')");
    const hasFlag = main.includes('isStackVersions');
    const hasRender = main.includes('<StackVersionsPage />');
    const hasRoute = main.includes("isRoute('/dev/stack-versions')");
    const hasTitle = main.includes("'/dev/stack-versions':");
    const ok = hasImport && hasFlag && hasRender && hasRoute && hasTitle;
    add('frontend.rota', ok ? 'PASS' : 'FAIL', ok
      ? 'rota /dev/stack-versions registrada em main.jsx (import, flag, render, título)'
      : `fiação incompleta em main.jsx (import=${hasImport} flag=${hasFlag} render=${hasRender} route=${hasRoute} title=${hasTitle})`);
  } catch (err) {
    add('frontend.rota', 'FAIL', `erro ao ler main.jsx: ${err.message}`);
  }

  // Handler /version enriquecido
  try {
    const route = readText('api/modules/public-system/publicHealthRoutes.js');
    const hasVersionRoute = route.includes("pathname === '/version'");
    const hasVersionField = route.includes('version: packageVersion');
    // Aceita tanto objeto literal `runtime: {` quanto atribuição
    // `payload.runtime = {` — o handler enriquece o payload só para
    // principal privilegiado (super_admin) por segurança.
    const hasRuntime = route.includes('runtime: {') || route.includes('.runtime = {');
    add('backend.version', hasVersionRoute && hasVersionField && hasRuntime ? 'PASS' : 'FAIL', hasVersionRoute && hasVersionField && hasRuntime
      ? 'handler GET /version enriquecido (version + runtime) em publicHealthRoutes.js'
      : `handler /version incompleto (route=${hasVersionRoute} version=${hasVersionField} runtime=${hasRuntime})`);
  } catch (err) {
    add('backend.version', 'FAIL', `erro ao ler publicHealthRoutes.js: ${err.message}`);
  }

  return checks;
}

// --- Modo validate ------------------------------------------------------

function validate() {
  const stack = collectDeclaredStack();
  const currentFingerprint = computeFingerprint(stack);
  const wiring = checkWiring();

  let docFingerprint = null;
  let docStatus = 'FAIL';
  let docDetail = `${DOC_PATH} ausente`;
  if (fs.existsSync(DOC_PATH)) {
    const doc = fs.readFileSync(DOC_PATH, 'utf8');
    const match = doc.match(/Fingerprint: `([a-f0-9]{64})`/);
    if (match) {
      docFingerprint = match[1];
      if (docFingerprint === currentFingerprint) {
        docStatus = 'PASS';
        docDetail = 'doc de stack-versions sincronizado com as fontes declaradas';
      } else {
        docDetail = 'doc de stack-versions desatualizado — rode npm run stack:versions:sync';
      }
    } else {
      docDetail = 'fingerprint ausente no doc — rode npm run stack:versions:sync';
    }
  }

  const wiringStatus = wiring.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  const overall = docStatus === 'PASS' && wiringStatus === 'PASS' ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    status: overall,
    fingerprint: currentFingerprint,
    doc: { status: docStatus, fingerprint: docFingerprint, detail: docDetail },
    wiring,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`[validate:stack-versions] Status: ${overall}`);
  console.log(`  ${docStatus === 'PASS' ? '✅' : '🔴'} doc: ${docDetail}`);
  for (const c of wiring) {
    const icon = c.status === 'PASS' ? '✅' : '🔴';
    console.log(`  ${icon} ${c.check}: ${c.detail}`);
  }

  if (overall === 'FAIL') process.exit(1);
}

// --- Modo sync ----------------------------------------------------------

function sync() {
  const stack = collectDeclaredStack();
  const fingerprint = syncDoc(stack);

  const report = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    fingerprint,
    stack,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`[stack:versions:sync] Doc atualizado: ${path.relative(ROOT, DOC_PATH)}`);
  console.log(`[stack:versions:sync] Fingerprint: ${fingerprint}`);
}

// --- Entry --------------------------------------------------------------

const mode = process.argv[2] || 'sync';

if (mode === 'sync') {
  sync();
} else if (mode === 'validate') {
  validate();
} else {
  console.error(`Modo desconhecido: ${mode}. Use "sync" ou "validate".`);
  process.exit(2);
}
