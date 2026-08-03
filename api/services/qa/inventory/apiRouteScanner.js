'use strict';

/**
 * apiRouteScanner — inventário estático das rotas HTTP da API.
 *
 * Estratégia (100% estática, sem require de código da aplicação):
 *
 * 1. Mounts: `api/app/routeRegistry.js` declara `{ path?, router: routers.X }`.
 *    `api/app/registerRoutes.js` instancia `const X = createY(...)` e importa
 *    as factories via require. O scanner resolve factory → arquivo fonte do
 *    router:
 *      - `../modules/<mod>/routes`      → api/modules/<mod>/routes.js
 *      - `../routes/<file>`             → api/routes/<file>.js
 *      - `../composition/<name>`        → requires `modules/<mod>/routes`
 *                                         dentro de api/composition/<name>/;
 *                                         se nenhum, o próprio index.js é o
 *                                         router (rotas inline, ex.: tenant).
 * 2. Em cada arquivo de router, chamadas `router|app.(get|post|put|patch|
 *    delete)('<path>', ...middlewares, handler)` são extraídas por matching
 *    de parênteses. Também são reconhecidos helpers locais do tipo
 *    `registerJsonPost(pathname, handler)` que delegam a `router.<method>(
 *    pathname, ...)` (padrão usado por qa-waves e outros módulos).
 * 3. Autenticação/autorização: detectadas tanto na cadeia de middlewares
 *    (requireAuth, requirePermission, requireClassification,
 *    ensureAuthenticated, validateTenant, ...) quanto no corpo do handler
 *    (`deps.requireAuth(req)`, helpers locais como `resolveAuth`/
 *    `checkPermission` que internamente chamam requireAuth/requirePermission).
 *
 * Classification (regra documentada):
 *   - módulo qa-waves|qa-mesh|rpa-tests|qa|operationalStatus|ops
 *     ou token dev|engineering|seeds                          → DEVELOPMENT
 *   - módulo execution-ledger|test-executions
 *     ou token support|diagnostics|audit                      → SUPPORT
 *   - demais                                                  → PRODUCTION
 *
 * Limitações conhecidas: rotas registradas dinamicamente (path não literal)
 * e sub-routers montados via `router.use(handler)` sem path literal ficam
 * fora do inventário.
 */

const fs = require('fs');
const path = require('path');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const AUTH_MIDDLEWARE_NAMES = new Set([
  'requireAuth',
  'ensureAuthenticated',
  'ensureSupportAccess',
  'authenticate',
  'requireAuthentication',
]);

const AUTHORIZATION_MIDDLEWARE_NAMES = new Set([
  'requirePermission',
  'requireClassification',
  'requireRole',
  'validateTenant',
  'requireSuperAdmin',
]);

const DEVELOPMENT_MODULES = new Set(['qa-waves', 'qa-mesh', 'rpa-tests', 'qa', 'operationalStatus', 'ops']);
const DEVELOPMENT_MODULE_TOKENS = new Set(['dev', 'engineering', 'seeds']);
const SUPPORT_MODULES = new Set(['execution-ledger', 'test-executions']);
const SUPPORT_MODULE_TOKENS = new Set(['support', 'diagnostics', 'audit']);

/**
 * Overrides de classificação por módulo (justificativa auditável). Prevalecem
 * sobre a heurística por tokens.
 * - support-debug: o nome é histórico — o módulo serve rotas OPERACIONAIS:
 *   CRUD de /api/schedules (consumido por frontend/src/api/scheduling.js) e
 *   sugestões de IA da inbox (frontend/src/api/tickets.js). Runtime confirma:
 *   papel operacional acessa com 200 (API Surface Wave, 2026-07-28).
 */
const MODULE_CLASSIFICATION_OVERRIDES = new Map([
  ['support-debug', 'PRODUCTION'],
]);

function classifyModule(moduleName) {
  const name = String(moduleName || '');
  if (MODULE_CLASSIFICATION_OVERRIDES.has(name)) {
    return MODULE_CLASSIFICATION_OVERRIDES.get(name);
  }
  const tokens = name.split('-');
  if (DEVELOPMENT_MODULES.has(name) || tokens.some((t) => DEVELOPMENT_MODULE_TOKENS.has(t))) {
    return 'DEVELOPMENT';
  }
  if (SUPPORT_MODULES.has(name) || tokens.some((t) => SUPPORT_MODULE_TOKENS.has(t))) {
    return 'SUPPORT';
  }
  return 'PRODUCTION';
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Retorna o índice do caractere de fechamento que casa com a abertura em `openIndex`. */
function matchDelimiter(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Divide argumentos de uma chamada em vírgulas de nível superior. */
function splitTopLevelArgs(argsText) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < argsText.length; i += 1) {
    const ch = argsText[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(argsText.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(argsText.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function extractStringLiteral(text) {
  const match = /^\s*'([^']*)'\s*$/.exec(text) || /^\s*"([^"]*)"\s*$/.exec(text);
  return match ? match[1] : null;
}

/** Encontra definições `function name(params) { body }` no arquivo. */
function findFunctionDefinitions(source) {
  const defs = [];
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const openBrace = source.indexOf('{', match.index + match[0].length - 1);
    const closeBrace = matchDelimiter(source, openBrace, '{', '}');
    if (closeBrace === -1) continue;
    defs.push({
      name: match[1],
      params: match[2].split(',').map((p) => p.trim()).filter(Boolean),
      body: source.slice(openBrace + 1, closeBrace),
      end: closeBrace,
    });
  }
  return defs;
}

/**
 * Encontra métodos de objeto `(async )?name(params) { body }` — formato dos
 * controllers retornados pelas factories (ex.: `async restartServer(req, res)`
 * no objeto literal de createConfigController).
 */
function findObjectMethodDefinitions(source) {
  const defs = [];
  const re = /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const openBrace = source.indexOf('{', match.index + match[0].length - 1);
    const closeBrace = matchDelimiter(source, openBrace, '{', '}');
    if (closeBrace === -1) continue;
    defs.push({
      name: match[1],
      params: match[2].split(',').map((p) => p.trim()).filter(Boolean),
      body: source.slice(openBrace + 1, closeBrace),
      end: closeBrace,
    });
  }
  return defs;
}

/**
 * Encontra propriedades arrow de objeto `name: (async )?(params) => body` —
 * formato dos controllers retornados como objeto literal (ex.:
 * `createTimesheet: (req, res) => run(req, res, 'write', ...)` no controller
 * do workspace). O corpo pode ser bloco `{ ... }` ou expressão única
 * (capturada até a vírgula/fecha-objeto de nível zero).
 */
function findArrowPropertyDefinitions(source) {
  const defs = [];
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const bodyStart = match.index + match[0].length;
    if (source[bodyStart] === '{') {
      const closeBrace = matchDelimiter(source, bodyStart, '{', '}');
      if (closeBrace === -1) continue;
      defs.push({
        name: match[1],
        params: match[2].split(',').map((p) => p.trim()).filter(Boolean),
        body: source.slice(bodyStart + 1, closeBrace),
        end: closeBrace,
      });
      continue;
    }
    // Expressão: até `,` ou `}` de nível zero (respeitando strings).
    let i = bodyStart;
    let depth = 0;
    let quote = null;
    while (i < source.length) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depth += 1;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break; // '}' que fecha o objeto literal
        depth -= 1;
      } else if (ch === ',' && depth === 0) {
        break;
      }
      i += 1;
    }
    defs.push({
      name: match[1],
      params: match[2].split(',').map((p) => p.trim()).filter(Boolean),
      body: source.slice(bodyStart, i),
      end: i,
    });
  }
  return defs;
}

/**
 * Overrides declarados e auditáveis de authRequired por rota. Usado quando a
 * análise estática não consegue expressar a semântica real do handler — cada
 * entrada exige justificativa ancorada no comportamento observado ao vivo.
 */
const AUTH_REQUIRED_OVERRIDES = {
  // GET /config: o controller tenta requireAuth, mas serve 200 com a visão
  // pública sanitizada quando anônimo (onboarding pré-login) — o payload
  // completo exige auth + config:read. Probe ao vivo da API Surface Wave:
  // anônimo → 200. Sem o override, a presença do requireAuth condicional
  // marcaria a rota como protegida (falso positivo).
  'api:GET:/config': false,

  // --- Auth centralizada fora do alcance da análise estática (2026-08-03) ---
  // As rotas abaixo respondem 401 ao probe anônimo ao vivo, mas a proteção
  // vive em handler pai/guard central (nunca dentro da janela de análise da
  // rota). Cada entrada foi ancorada em probe real antes de ser declarada.

  // intelligence: requireAuth no topo do handler pai
  // (handleIntelligenceRoutes.js) antes de delegar aos sub-handlers.
  // Probe ao vivo: POST /api/intelligence/goals anônimo → 401.
  'api:POST:/api/intelligence/goals': true,
  'api:PUT:/api/intelligence/goals/:id': true,
  'api:POST:/api/intelligence/metrics/snapshots': true,
  'api:POST:/api/intelligence/operational-state': true,

  // physical (kiosk/station/access): guard de token central em
  // handlePhysicalPublicRouteUtils.js ("Token obrigatório", 401).
  // Probe ao vivo: POST /physical/kiosk/tickets anônimo → 401.
  'api:POST:/physical/kiosk/tickets': true,
  'api:POST:/physical/station/call-next': true,
  'api:POST:/physical/station/transfer': true,
  'api:POST:/physical/access/ack': true,
  'api:POST:/physical/access/events': true,
  'api:POST:/physical/access/resolve': true,

  // qa/operational-status: requireAuth central no router do módulo
  // (api/modules/qa/routes.js). Probe ao vivo: anônimo → 401.
  'api:POST:/qa/operational-status/check-operation': true,
  'api:POST:/qa/operational-status/update-governance': true,

  // flows: auth condicional (STRICT_TENANT_MODE) — a análise estática não
  // expressa a semântica "401 em produção, tenant explícito em DEV".
  // Probes ao vivo (strict): POST /flows → 401, POST /flows/generate → 401,
  // POST /flows/generate/dry-run → 401, PUT /flows/:id → 401.
  'api:POST:/flows': true,
  'api:POST:/flows/generate': true,
  'api:POST:/flows/generate/dry-run': true,
  'api:PUT:/flows/:id': true,
};

/**
 * Carrega controllers irmãos referenciados pelo router (require('./controller'))
 * para resolver delegações `controllerFor(req, res).metodo(req, res)`: a
 * proteção (ensureAuth/ensurePermission) vive no controller, não no router.
 * Módulos irmãos de utilidades de rota (ex.: ragRouteUtils.js) também são
 * carregados — helpers como ensureRagPermission concentram requireAuth +
 * requirePermission fora de arquivos com "controller" no nome.
 * @returns {{ methodBodies: Map<string, string>, authHelpers: string[], permissionHelpers: string[], authImplyingHelpers: string[] }}
 */
function loadDelegatedControllerIndex(sourceFile, routerSource, rootDir) {
  const methodBodies = new Map();
  const authHelpers = new Set();
  const permissionHelpers = new Set();

  const requireRe = /require\(\s*'(\.{1,2}\/[^']*(?:controller|utils|helpers)[^']*)'\s*\)/gi;
  const controllerFiles = new Set();
  let match;
  while ((match = requireRe.exec(routerSource)) !== null) {
    const resolved = path.resolve(path.dirname(sourceFile), match[1]);
    controllerFiles.add(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
  }

  // Idioma de injeção por parâmetro: createTenantRoutes({ controller }) usa
  // `controller.metodo` sem require local — o controller é o arquivo irmão
  // convencional `controller.js` do módulo (api/modules/*/controller.js).
  if (/\bcontroller\s*\./.test(routerSource)) {
    const siblingController = path.join(path.dirname(sourceFile), 'controller.js');
    if (fs.existsSync(siblingController)) controllerFiles.add(siblingController);
  }

  for (const controllerFile of controllerFiles) {
    const raw = readFileSafe(controllerFile);
    if (raw === null) continue;
    const source = stripComments(raw);

    const defs = [
      ...findFunctionDefinitions(source),
      ...findObjectMethodDefinitions(source),
      ...findArrowPropertyDefinitions(source),
    ];
    for (const def of defs) {
      if (!methodBodies.has(def.name)) methodBodies.set(def.name, def.body);
      if (/\brequireAuth\s*\(/.test(def.body)) authHelpers.add(def.name);
      if (/\brequirePermission\s*\(/.test(def.body)) permissionHelpers.add(def.name);
    }
  }

  const authImplyingHelpers = computeAuthImplyingHelpers(
    [...methodBodies.entries()].map(([name, body]) => ({ name, body })),
    [...authHelpers],
  );

  return {
    methodBodies,
    authHelpers: [...authHelpers],
    permissionHelpers: [...permissionHelpers],
    authImplyingHelpers,
  };
}

/**
 * Fechamento transitivo de "implica auth": um helper implica autenticação
 * quando seu corpo chama requireAuth(...) diretamente OU chama outro helper
 * que implica auth (ex.: ensurePermission → ensureAuth no controller de
 * project-management). Uma rota que chama apenas o helper de permissão é
 * protegida na prática — sem o fechamento, o inventário reportava
 * authRequired=false e a API Surface Wave pulava o probe P1 (rota mutável),
 * deixando a rota eternamente VISITED.
 * Retorna os nomes que implicam auth SEM estarem em directAuthHelpers.
 */
function computeAuthImplyingHelpers(defs, directAuthHelpers) {
  const implying = new Set(directAuthHelpers);
  const indirect = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of defs) {
      if (implying.has(def.name)) continue;
      const callsImplying = [...implying].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(def.body));
      if (callsImplying || /\brequireAuth\s*\(/.test(def.body)) {
        implying.add(def.name);
        indirect.add(def.name);
        changed = true;
      }
    }
  }
  return [...indirect].filter((name) => !directAuthHelpers.includes(name));
}

/**
 * Chave canônica de identidade da rota: mesmo método + mesmo shape de path,
 * com parâmetros normalizados. O scan direto registra o nome real do parâmetro
 * (router.delete('/webhooks/:webhookId', ...)) e o scan de handler irmão
 * descobre o mesmo endpoint via startsWith como ':id' — sem a normalização,
 * o inventário tinha DOIS itens para a mesma rota real, um com auth e outro
 * sem. O primeiro id encontrado (scan direto, com o nome real do parâmetro)
 * é preservado; as evidências de auth são mescladas.
 */
function normalizedRouteKey(method, fullPath) {
  const shape = String(fullPath).split('/').map((seg) => (seg.startsWith(':') ? ':' : seg)).join('/');
  return `${String(method).toUpperCase()}:${shape}`;
}

/** Extrai corpos dos métodos de controller delegados no handler do router. */
function resolveDelegatedBodies(chainAndBody, methodBodies) {
  const bodies = [];
  const seenBodies = new Set();
  const collect = (name) => {
    const body = methodBodies.get(name);
    if (body && !seenBodies.has(body)) {
      seenBodies.add(body);
      bodies.push(body);
    }
  };
  // Idioma de chamada inline: controllerFor(req, res).metodo(req, res)
  const callRe = /\.([A-Za-z_$][\w$]*)\s*\(\s*req\s*,\s*res\s*\)/g;
  let match;
  while ((match = callRe.exec(chainAndBody)) !== null) collect(match[1]);
  // Idioma de referência: router.delete('/x', controller.deleteTenant) — o
  // handler é passado por referência (sem chamada), mas seu corpo é onde a
  // proteção vive. O $ cobre o handler como último argumento (argsText não
  // inclui o ')' de fechamento).
  const refRe = /\.([A-Za-z_$][\w$]*)\s*(?=[,)\]]|$)/gm;
  while ((match = refRe.exec(chainAndBody)) !== null) collect(match[1]);
  return bodies;
}

// ---------------------------------------------------------------------------
// Resolução de mounts (routeRegistry + registerRoutes)
// ---------------------------------------------------------------------------

function parseRegistryMounts(registrySource) {
  const mounts = [];
  const re = /\{\s*(?:path:\s*'([^']+)'\s*,\s*)?router:\s*routers\.([A-Za-z_$][\w$]*)\s*\}/g;
  let match;
  while ((match = re.exec(registrySource)) !== null) {
    mounts.push({ prefix: match[1] || '', routerVar: match[2] });
  }
  return mounts;
}

function parseFactoryRequires(registerSource, appDir) {
  const factories = new Map(); // factoryName -> absolute require target (sem extensão)
  const re = /const\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\('([^']+)'\)/g;
  let match;
  while ((match = re.exec(registerSource)) !== null) {
    const declared = match[1];
    const target = path.resolve(appDir, match[2]);
    if (declared.startsWith('{')) {
      for (const name of declared.slice(1, -1).split(',')) {
        const clean = name.trim();
        if (clean) factories.set(clean, target);
      }
    } else {
      factories.set(declared, target);
    }
  }
  return factories;
}

function parseRouterInstantiations(registerSource) {
  const instances = new Map(); // routerVar -> factoryName
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = re.exec(registerSource)) !== null) {
    instances.set(match[1], match[2]);
  }
  return instances;
}

/**
 * Resolve o alvo do require de uma factory para uma lista de
 * { sourceFile, module }. Retorna lista vazia quando não resolve.
 */
function resolveRouterSource(targetNoExt, rootDir) {
  const candidates = [`${targetNoExt}.js`, path.join(targetNoExt, 'index.js')];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) continue;

    const modulesMatch = /api[/\\]modules[/\\]([\w-]+)[/\\][\w.-]*routes\.js$/.exec(candidate);
    if (modulesMatch) {
      return [{ sourceFile: candidate, module: modulesMatch[1] }];
    }

    // Diretório de composition: procurar requires de modules/* dentro dele.
    if (/api[/\\]composition[/\\][\w-]+$/.test(targetNoExt) || candidate.endsWith('index.js')) {
      const dir = path.dirname(candidate);
      const compositionName = /api[/\\]composition[/\\]([\w-]+)$/.exec(dir)?.[1] || path.basename(dir);
      const moduleTargets = new Map(); // moduleName -> sourceFile
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.js')) continue;
        const content = readFileSafe(path.join(dir, entry)) || '';
        const re = /require\('\.\.\/\.\.\/modules\/([\w-]+)(?:\/([\w.-]+))?'\)/g;
        let m;
        while ((m = re.exec(content)) !== null) {
          const moduleName = m[1];
          const filePart = m[2] || 'routes';
          const sourceFile = path.join(rootDir, 'api', 'modules', moduleName, `${filePart}.js`);
          const fallback = path.join(rootDir, 'api', 'modules', moduleName, 'index.js');
          moduleTargets.set(moduleName, fs.existsSync(sourceFile) ? sourceFile : fallback);
        }
      }
      if (moduleTargets.size > 0) {
        return [...moduleTargets.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([moduleName, sourceFile]) => ({ sourceFile, module: moduleName }));
      }
      // Rotas inline no próprio composition (ex.: tenant).
      return [{ sourceFile: candidate, module: compositionName }];
    }

    // api/routes/<file>.js ou outro arquivo direto.
    const routesMatch = /api[/\\]routes[/\\]([\w-]+)\.js$/.exec(candidate);
    if (routesMatch) {
      return [{ sourceFile: candidate, module: routesMatch[1].replace(/Routes$/, '') }];
    }
    return [{ sourceFile: candidate, module: path.basename(candidate, '.js') }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Scan de um arquivo de router
// ---------------------------------------------------------------------------

function analyzeAuthAndAuthorization(chainAndBody, localAuthHelpers, localPermissionHelpers, authImplyingHelpers = []) {
  const authorization = new Set();
  let authRequired = false;

  for (const name of localAuthHelpers) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(chainAndBody)) {
      authRequired = true;
      authorization.add(name);
    }
  }
  // Helpers que implicam auth transitivamente (ex.: ensurePermission → ensureAuth)
  // marcam a rota como protegida; a autorização específica já é registrada
  // pelo loop de permission helpers abaixo.
  for (const name of authImplyingHelpers) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(chainAndBody)) {
      authRequired = true;
    }
  }
  if (/\brequireAuth\s*\(/.test(chainAndBody) || /\bensureAuthenticated\s*\(/.test(chainAndBody) || /\bensureSupportAccess\s*\(/.test(chainAndBody) || /\bensureAuth\s*\(/.test(chainAndBody)) {
    authRequired = true;
    authorization.add('requireAuth');
  }

  const permRe = /\brequirePermission\s*\(\s*(?:req\s*,\s*)?'([^']+)'(?:\s*,\s*'([^']+)')?/g;
  let m;
  while ((m = permRe.exec(chainAndBody)) !== null) {
    authorization.add(`requirePermission:${m[1]}${m[2] ? `:${m[2]}` : ''}`);
  }
  for (const name of localPermissionHelpers) {
    const helperRe = new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, 'g');
    while ((m = helperRe.exec(chainAndBody)) !== null) {
      const literals = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      authorization.add(literals.length > 0 ? `${name}:${literals.join(':')}` : name);
    }
  }

  return { authRequired, authorization: [...authorization].sort() };
}

/**
 * Remove comentários de bloco e de linha preservando strings e a contagem de
 * linhas (cada caractere de comentário vira espaço, exceto \n). Comentários
 * NUNCA podem gerar itens de inventário — um exemplo em docstring (ex.:
 * `router.get('/rota', ...)` na documentação de um middleware) não é rota.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function scanRouterFile(sourceFile, { prefix, module: moduleName, rootDir, classification }, _depth = 0) {
  const rawSource = readFileSafe(sourceFile);
  if (rawSource === null) return { items: [], warnings: [`router não legível: ${sourceFile}`] };
  const source = stripComments(rawSource);

  const warnings = [];
  const functionDefs = findFunctionDefinitions(source);

  // Helpers locais que embrulham requireAuth/requirePermission (ex.: resolveAuth, checkPermission).
  const localAuthHelpers = functionDefs
    .filter((def) => /\brequireAuth\s*\(/.test(def.body))
    .map((def) => def.name);
  const localPermissionHelpers = functionDefs
    .filter((def) => /\brequirePermission\s*\(/.test(def.body))
    .map((def) => def.name);

  // Controllers irmãos (require('./controller')) para resolver delegações
  // `controllerFor(req, res).metodo(req, res)` — a proteção vive lá.
  const controllerIndex = loadDelegatedControllerIndex(sourceFile, source, rootDir);

  // Helpers locais que implicam auth transitivamente (ex.: ensurePermission
  // que chama ensureAuth) — chamadas a eles também marcam a rota protegida.
  const localAuthImplyingHelpers = computeAuthImplyingHelpers(functionDefs, localAuthHelpers);

  // Helpers que registram rotas com path dinâmico (ex.: registerJsonPost(pathname, handler)).
  const routeHelpers = new Map(); // name -> { method, body }
  for (const def of functionDefs) {
    if (def.params.length === 0) continue;
    const re = new RegExp(`router\\.(${HTTP_METHODS.join('|')})\\(\\s*${def.params[0]}\\b`);
    const m = re.exec(def.body);
    if (m) routeHelpers.set(def.name, { method: m[1].toUpperCase(), body: def.body });
  }

  const relativeSource = path.relative(rootDir, sourceFile);
  const items = [];
  // Duplicatas por id são MESCLADAS (não descartadas): o mesmo id pode ser
  // descoberto pelo scan direto (router.delete('/x', runHandled(...)) — sem
  // auth visível) e pelo scan do handler irmão (com requireAuth na janela).
  // A evidência mais forte vence: auth detectada em qualquer caminho marca a
  // rota como protegida; autorizações são unidas. Overrides continuam
  // soberanos sobre o resultado mesclado.
  const itemsById = new Map();

  function mergeItem(existing, detectedAuth, authorization) {
    existing.detectedAuth = existing.detectedAuth || detectedAuth;
    for (const entry of authorization) {
      if (!existing.authorization.includes(entry)) existing.authorization.push(entry);
    }
    existing.authorization.sort();
    existing.authRequired = Object.prototype.hasOwnProperty.call(AUTH_REQUIRED_OVERRIDES, existing.id)
      ? AUTH_REQUIRED_OVERRIDES[existing.id]
      : existing.detectedAuth;
  }

  function joinPath(routePath) {
    if (!prefix) return routePath;
    if (routePath === '/') return prefix;
    return `${prefix}${routePath.startsWith('/') ? '' : '/'}${routePath}`.replace(/\/+/g, '/');
  }

  function pushItem(method, routePath, chainAndBody, extraMiddlewares) {
    const fullPath = joinPath(routePath);
    const delegatedBodies = resolveDelegatedBodies(chainAndBody, controllerIndex.methodBodies);
    const analysisText = [chainAndBody, ...delegatedBodies].join('\n');
    const { authRequired: detectedAuthRequired, authorization } = analyzeAuthAndAuthorization(
      analysisText,
      [...localAuthHelpers, ...controllerIndex.authHelpers],
      [...localPermissionHelpers, ...controllerIndex.permissionHelpers],
      [...localAuthImplyingHelpers, ...controllerIndex.authImplyingHelpers],
    );
    const middlewares = extraMiddlewares || [];
    for (const mw of middlewares) {
      if (AUTH_MIDDLEWARE_NAMES.has(mw) && !authorization.includes('requireAuth')) {
        authorization.push('requireAuth');
        authorization.sort();
      }
      if (AUTHORIZATION_MIDDLEWARE_NAMES.has(mw) && !authorization.includes(mw)) {
        authorization.push(mw);
        authorization.sort();
      }
    }
    const id = `api:${method}:${fullPath}`;
    const detectedAuth = detectedAuthRequired || middlewares.some((mw) => AUTH_MIDDLEWARE_NAMES.has(mw));
    const existing = itemsById.get(normalizedRouteKey(method, fullPath));
    if (existing) {
      mergeItem(existing, detectedAuth, authorization);
      return;
    }
    const item = {
      id,
      kind: 'api',
      method,
      path: fullPath,
      module: moduleName,
      source: relativeSource,
      authRequired: detectedAuth,
      authorization,
      classification,
      detectedAuth,
    };
    if (Object.prototype.hasOwnProperty.call(AUTH_REQUIRED_OVERRIDES, id)) {
      item.authRequired = AUTH_REQUIRED_OVERRIDES[id];
    }
    itemsById.set(normalizedRouteKey(method, fullPath), item);
    items.push(item);
  }

  // 1. Chamadas diretas router|app.<method>('<path>', ...) ou com array de paths.
  const directRe = new RegExp(`\\b(?:router|app)\\.(${HTTP_METHODS.join('|')})\\s*\\(`, 'g');
  let match;
  while ((match = directRe.exec(source)) !== null) {
    const openParen = source.indexOf('(', match.index + match[0].length - 1);
    const closeParen = matchDelimiter(source, openParen, '(', ')');
    if (closeParen === -1) continue;
    const argsText = source.slice(openParen + 1, closeParen);
    const args = splitTopLevelArgs(argsText);
    if (args.length === 0) continue;
    let routePaths = [];
    if (args[0].startsWith('[')) {
      routePaths = [...args[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    } else {
      const literal = extractStringLiteral(args[0]);
      if (literal !== null) routePaths = [literal];
    }
    if (routePaths.length === 0) continue; // path dinâmico — limitação documentada
    const middlewares = args.slice(1, -1)
      .map((part) => /^([A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec(part)?.[1])
      .filter(Boolean);
    for (const routePath of routePaths) {
      pushItem(match[1].toUpperCase(), routePath, argsText, middlewares);
    }
  }

  // 2. Dispatch manual: `method === 'POST' && pathname === '/x'` (domain-* handlers).
  const dispatchPatterns = [
    /\bmethod\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'\s*&&\s*pathname\s*===\s*'([^']+)'/g,
    /\bpathname\s*===\s*'([^']+)'\s*&&\s*method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'/g,
  ];
  for (const pattern of dispatchPatterns) {
    while ((match = pattern.exec(source)) !== null) {
      const [method, routePath] = pattern === dispatchPatterns[0]
        ? [match[1], match[2]]
        : [match[2], match[1]];
      pushItem(method, routePath, source.slice(Math.max(0, match.index - 400), match.index + 400), []);
    }
  }

  // 2b. Helpers de dispatch do projeto: `isRouteMatch(method, pathname, 'GET', '/x')`
  // e `canHandlePrefix(method, pathname, 'GET', '/x/')` (prefixo → ':id').
  // Sufixo `&& pathname.endsWith('/suffix')` na mesma condição entra no path
  // (ex.: reindex) — sem isso o scanner emite a rota nua fantasma (:id puro),
  // que não existe no runtime e falha como 404 de fallback na API Surface Wave.
  const helperCallRe = /\b\w+\s*\(\s*method\s*,\s*pathname\s*,\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*'([^']+)'\s*\)/g;
  while ((match = helperCallRe.exec(source)) !== null) {
    const basePath = match[2].endsWith('/') ? `${match[2]}:id` : match[2];
    // Sufixo só conta se estiver na MESMA condição — delimitada pelo `{` que
    // abre o bloco ou pelo `;` que encerra o statement (sem isso, o endsWith
    // do if seguinte vazava para a rota anterior).
    const window = source.slice(match.index, match.index + 200);
    const stopAt = ['{', ';'].reduce((acc, ch) => {
      const idx = window.indexOf(ch);
      return idx === -1 ? acc : Math.min(acc, idx);
    }, window.length);
    const tail = window.slice(0, stopAt);
    const suffixMatch = /[^!]\bpathname\.endsWith\('([^']+)'\)/.exec(tail);
    const suffix = match[2].endsWith('/') && suffixMatch ? suffixMatch[1] : '';
    pushItem(match[1], `${basePath}${suffix}`, source.slice(Math.max(0, match.index - 400), match.index + 400), []);
  }

  // 2c. Rotas parametrizadas via startsWith:
  //   `method === 'GET' && pathname.startsWith('/x/')`            → GET:/x/:id
  //   `method !== 'DELETE' || !pathname.startsWith('/x/')`        → DELETE:/x/:id
  //   `!(method === 'PUT' && pathname.startsWith('/x/') && …)`    → PUT:/x/:id
  //   com `pathname.endsWith('/suffix')` na mesma condição        → /x/:id/suffix
  const startsWithPatterns = [
    /\bmethod\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'\s*&&\s*pathname\.startsWith\('([^']+\/)'\)/g,
    /\bpathname\.startsWith\('([^']+\/)'\)\s*&&\s*method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'/g,
    /\bmethod\s*!==\s*'(GET|POST|PUT|PATCH|DELETE)'\s*\|\|\s*!pathname\.startsWith\('([^']+\/)'\)/g,
    /!\(\s*method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'\s*&&\s*pathname\.startsWith\('([^']+\/)'\)/g,
  ];
  for (let p = 0; p < startsWithPatterns.length; p += 1) {
    const pattern = startsWithPatterns[p];
    while ((match = pattern.exec(source)) !== null) {
      const method = (p === 1) ? match[2] : match[1];
      const prefix = (p === 1) ? match[1] : match[2];
      const tail = source.slice(match.index, match.index + 200);
      // endsWith só entra no path quando NÃO está negado (ex.: o environment
      // route usa `&& pathname.endsWith('/environment')`; o read route usa
      // `&& !pathname.endsWith('/environment')` para excluir esse sufixo).
      const suffixMatch = /[^!]\bpathname\.endsWith\('([^']+)'\)/.exec(tail);
      const suffix = suffixMatch ? suffixMatch[1] : '';
      pushItem(method, `${prefix}:id${suffix}`, source.slice(Math.max(0, match.index - 400), match.index + 400), []);
    }
  }

  // 2d. Guarda negada com par método+rota (ex.: backup):
  //   `method === 'GET' && pathname !== '/api/backup/export'` → GET:/api/backup/export
  const negatedPairRe = /\bmethod\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'\s*&&\s*pathname\s*!==\s*'([^']+)'/g;
  while ((match = negatedPairRe.exec(source)) !== null) {
    pushItem(match[1], match[2], source.slice(Math.max(0, match.index - 400), match.index + 400), []);
  }

  // 2e. Guarda de prefixo + allow-list de métodos (ex.: tenant-settings):
  //   `if (!pathname.startsWith('/x/')) return false;` + `method !== 'A' && method !== 'B'`
  const prefixGuardRe = /!\s*pathname\.startsWith\('([^']+\/)'\)/g;
  while ((match = prefixGuardRe.exec(source)) !== null) {
    const prefix = match[1];
    // Só emitir quando houver allow-list explícita de métodos na vizinhança —
    // evita confundir guards compostos (já cobertos por 2c) com este idioma.
    const window = source.slice(match.index, match.index + 400);
    if (!/method\s*===|method\s*!==/.test(window)) continue;
    if (/\bmethod\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'\s*&&\s*pathname\.startsWith/.test(window)) continue;
    const allowList = new Set();
    const allowRe = /method\s*!==\s*'(GET|POST|PUT|PATCH|DELETE)'/g;
    let m2;
    while ((m2 = allowRe.exec(window)) !== null) allowList.add(m2[1]);
    for (const method of allowList) {
      pushItem(method, `${prefix}:id`, source.slice(Math.max(0, match.index - 200), match.index + 200), []);
    }
  }

  // 3. Chamadas via helper local: helperName('<path>', handler).
  for (const [helperName, helper] of routeHelpers) {
    const callRe = new RegExp(`(?<![.\\w$])${helperName}\\s*\\(\\s*'([^']+)'`, 'g');
    while ((match = callRe.exec(source)) !== null) {
      pushItem(helper.method, match[1], helper.body, []);
    }
  }

  // 4. Handlers irmãos (ex.: domain-admin → ./handleSystemAdminRoutes → sub-handlers).
  if (_depth < 4) {
    const siblingRe = /require\('(\.[\w./-]+)'\)/g;
    while ((match = siblingRe.exec(source)) !== null) {
      const siblingFile = path.resolve(path.dirname(sourceFile), `${match[1]}.js`);
      if (!fs.existsSync(siblingFile)) continue;
      const sibling = scanRouterFile(
        siblingFile,
        { prefix, module: moduleName, rootDir, classification },
        _depth + 1,
      );
      for (const item of sibling.items) {
        const existing = itemsById.get(normalizedRouteKey(item.method, item.path));
        if (existing) {
          mergeItem(existing, item.detectedAuth === true, item.authorization || []);
        } else {
          itemsById.set(normalizedRouteKey(item.method, item.path), item);
          items.push(item);
        }
      }
    }
  }

  if (items.length === 0) {
    warnings.push(`nenhuma rota literal encontrada em ${relativeSource}`);
  }
  // detectedAuth é estado interno do merge — removido na saída de scanApiRoutes.
  return { items, warnings };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Escaneia estaticamente as rotas da API.
 *
 * @param {{ rootDir: string, registryFile?: string, registerFile?: string }} options
 * @returns {{ items: object[], mounts: object[], unresolvedMounts: object[], warnings: string[] }}
 */
function scanApiRoutes({ rootDir, registryFile, registerFile }) {
  const registryPath = registryFile || path.join(rootDir, 'api', 'app', 'routeRegistry.js');
  const registerPath = registerFile || path.join(rootDir, 'api', 'app', 'registerRoutes.js');
  const registrySource = readFileSafe(registryPath);
  const registerSource = readFileSafe(registerPath);
  if (registrySource === null || registerSource === null) {
    throw new Error(`arquivos de composição de rotas não encontrados em ${path.join(rootDir, 'api', 'app')}`);
  }

  const mounts = parseRegistryMounts(registrySource);
  const factories = parseFactoryRequires(registerSource, path.dirname(registerPath));
  const instances = parseRouterInstantiations(registerSource);

  const items = [];
  const warnings = [];
  const unresolvedMounts = [];
  // Mesma regra de merge do scan por arquivo: ids duplicados entre arquivos
  // (ex.: rota descoberta pelo mount e por um handler irmão) mantêm a
  // evidência mais forte de auth e a união das autorizações.
  const itemsById = new Map();

  for (const mount of mounts) {
    const factoryName = instances.get(mount.routerVar);
    const target = factoryName ? factories.get(factoryName) : null;
    const resolved = target ? resolveRouterSource(target, rootDir) : [];
    const readable = resolved.filter((r) => fs.existsSync(r.sourceFile));
    if (readable.length === 0) {
      unresolvedMounts.push({ ...mount, factoryName: factoryName || null });
      continue;
    }
    for (const source of readable) {
      const classification = classifyModule(source.module);
      const result = scanRouterFile(source.sourceFile, {
        prefix: mount.prefix,
        module: source.module,
        rootDir,
        classification,
      });
      warnings.push(...result.warnings);
      for (const item of result.items) {
        const existing = itemsById.get(normalizedRouteKey(item.method, item.path));
        if (existing) {
          existing.detectedAuth = existing.detectedAuth || item.detectedAuth === true;
          for (const entry of item.authorization || []) {
            if (!existing.authorization.includes(entry)) existing.authorization.push(entry);
          }
          existing.authorization.sort();
          existing.authRequired = Object.prototype.hasOwnProperty.call(AUTH_REQUIRED_OVERRIDES, existing.id)
            ? AUTH_REQUIRED_OVERRIDES[existing.id]
            : existing.detectedAuth;
        } else {
          itemsById.set(normalizedRouteKey(item.method, item.path), item);
          items.push(item);
        }
      }
    }
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    items: items.map(({ detectedAuth, ...rest }) => rest),
    mounts,
    unresolvedMounts,
    warnings,
  };
}

module.exports = { scanApiRoutes, classifyModule };
