#!/usr/bin/env node
'use strict';

/**
 * BOOTSTRAP CANÔNICO DO AMBIENTE DE CI — `npm run ci:bootstrap`.
 *
 * MISSÃO: um clone limpo, sem nenhum estado prévio do computador do desenvolvedor, precisa
 * conseguir executar a suíte obrigatória. Este script prepara esse ambiente em ordem de
 * dependência, registra o veredito REAL de cada passo e reprova quando um artefato exigido
 * não existe.
 *
 * Regras que este arquivo respeita (missão CI DEFINITIVO, §1):
 *  - NUNCA engole falha (`|| true`, `continue-on-error`): cada passo tem exit code registrado;
 *  - NUNCA gera artefato falso para satisfazer asserção de existência: cada artefato é escrito
 *    pelo seu produtor canônico;
 *  - distingue FALHA DE GERAÇÃO (artefato ausente ⇒ exit != 0) de VEREDITO DO PRODUTOR
 *    (ex.: `impact:validate` ESCALATE, `timeout-architecture` NO_GO): o veredito é registrado
 *    como está no relatório do bootstrap — jamais convertido em "PASS" e jamais escondido.
 *
 * Etapas (ordem derivada do código, não inventada):
 *   1. pré-requisitos (node, Postgres, Redis, Docker)
 *   2. system:bootstrap  → .env, api/data/config.json, deps, migrações, invariantes, build do
 *      frontend, probes de runtime (API + preview + DB + Redis)
 *   3. seed sintético     → tenant `system` + superadmin (dados sintéticos mínimos)
 *   4. registro do mesh   → `qa-mesh/meshRegistry.json` (índice; sem execução de cenário)
 *   5. grafo de impacto   → precisa ser construído DEPOIS de qualquer alteração de fonte
 *   6. geradores/validadores de artefato
 *   7. prova de existência dos artefatos exigidos pela suíte obrigatória
 *
 * MODO `--artifacts-only` (`npm run ci:artifacts`).
 *
 * Existe porque `jest tests/unit` NÃO é autossuficiente: ~20 asserções leem artefatos ignorados
 * pelo git (`reports/*.json`, `governance/*.json`, `qa-mesh/meshRegistry.json`) que nenhum
 * checkout contém. Medido em 2026-10-24 em duas árvores idênticas (mesmo Node, mesmo lockfile,
 * mesmo `.env`): sem os artefatos o L0 reprovava 20-23 testes com `ENOENT`/`GRAPH_ABSENT`; com os
 * artefatos produzidos pelos mesmos produtores canônicos, sobrava apenas
 * `tests/unit/governance/modelDrivenE2e.test.js`, cuja prova (`qa/smoke/prod-like/*.json`) só
 * existe depois de um smoke prod-like contra stack viva (job `prod-like-smoke` do CI).
 *
 * Este modo NÃO substitui o ambiente completo: ele só executa os passos 4-7 (índice do mesh,
 * grafo de impacto, produtores de artefato e prova de existência), sem `system:bootstrap`, sem
 * seed e sem Docker. Nada é fabricado: cada artefato é escrito pelo seu produtor canônico, o
 * veredito de cada produtor (PASS/NO_GO/ESCALATE) fica registrado como está e o veredito do
 * relatório continua sendo sobre o AMBIENTE (`READY`/`INCOMPLETE`), nunca sobre um gate.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = resolverRoot();

/**
 * Raiz do bootstrap. O override existe para TESTE de comportamento (montar uma raiz descartável
 * com produtores falsos e provar a ordem/ausência de passos pesados) e é recusado em produção;
 * quando usado, a raiz efetiva é registrada no relatório para ficar auditável.
 */
function resolverRoot() {
  const override = process.env.CI_BOOTSTRAP_ROOT;
  if (!override) return path.join(__dirname, '..', '..');
  if (process.env.NODE_ENV === 'production') {
    console.error('[ci:bootstrap] CI_BOOTSTRAP_ROOT recusado em NODE_ENV=production');
    process.exit(2);
  }
  return path.resolve(override);
}

const REPORT_PATH = path.join(ROOT, 'reports', 'ci-bootstrap-report.json');

const NODE_MIN = [20, 19];

/**
 * Artefatos que a suíte obrigatória (tests/unit) consome e que ESTE bootstrap se compromete a
 * produzir sem intervenção humana. Cada entrada nomeia o consumidor que reprova sem ele —
 * o vínculo foi medido em checkout limpo (2026-10-21), não deduzido.
 */
const ARTEFATOS_OBRIGATORIOS = [
  { caminho: 'reports/coverage-completeness-report.json', consumidor: 'tests/unit/governance/coverageCompletenessCanonicalDomains.test.js' },
  { caminho: 'reports/benchmark-sufficiency-report.json', consumidor: 'tests/unit/readinessCertificationSeparation.test.js' },
  { caminho: 'reports/evo-contract-report.json', consumidor: 'tests/unit/readinessCertificationSeparation.test.js' },
  { caminho: 'reports/layer-conventions-report.json', consumidor: 'tests/unit/engine/enginePurityPorts.test.js' },
  { caminho: 'reports/business-journey-projections.json', consumidor: 'tests/unit/businessJourneyProjection.test.js' },
  { caminho: 'reports/impact-validation-report.json', consumidor: 'tests/unit/coverage/impactRunner.test.js' },
  { caminho: 'governance/json-persistence-audit.json', consumidor: 'tests/unit/governance/jsonPersistenceNoPhantomWrite.test.js' },
  // Produtor IDEMPOTENTE: `qa:mesh:refresh` só reescreve o índice quando ele muda de fato, então
  // mtime antigo aqui significa "índice já estava atualizado" — frescor não se aplica.
  { caminho: 'qa-mesh/meshRegistry.json', consumidor: 'scripts/governance/validate-coverage-completeness.js (cobertura de cenários)', produzidoAqui: false },
  { caminho: 'reports/TIMEOUT_ARCHITECTURE_REPORT.json', consumidor: 'tests/unit/governance/v2TimeoutGateDependency.test.js' },
  // NÃO é produzido por este bootstrap: é evidência VERSIONADA, atualizada semanalmente pelo
  // workflow `wave-reports.yml`. Frescor não se aplica — a prova aqui é de existência (e o gate de
  // cobertura trata staleness por conta própria, com `applyWaveReportStaleness`).
  { caminho: 'reports/api-surface-report.json', consumidor: 'validate:coverage-gate / api surface wave (quando exigido)', produzidoAqui: false },
];

const passos = [];

const nowIso = () => new Date().toISOString();

function registrar(passo) {
  passos.push(passo);
  const marca = passo.ok ? '  ok  ' : ' FAIL ';
  const extra = passo.veredito ? ` veredito=${passo.veredito}` : '';
  const dur = passo.duracaoMs === undefined ? '' : ` (${Math.round(passo.duracaoMs / 1000)}s)`;
  console.log(`[ci:bootstrap]${marca} ${passo.id}${extra}${dur}`);
  if (!passo.ok && passo.saida && passo.saida.trim()) {
    for (const linha of passo.saida.trim().split('\n').slice(-12)) console.log(`           ${linha}`);
  }
}

function rodar(id, comando, args, { env = {}, aceitaVeredito = null, cwd = ROOT } = {}) {
  const inicio = Date.now();
  const r = spawnSync(comando, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 45 * 60 * 1000,
    env: { ...process.env, ...env },
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const exitCode = typeof r.status === 'number' ? r.status : null;
  const veredito = /NO_GO/.test(saida) ? 'NO_GO'
    : /ESCALATE/.test(saida) ? 'ESCALATE'
      : /NOT_EXECUTED/.test(saida) ? 'NOT_EXECUTED'
        : (exitCode === 0 ? 'PASS' : 'FAIL');
  // `aceitaVeredito`: só para produtores cujo exit code codifica VEREDITO (não falha de geração).
  // Mesmo aceitando o veredito, ele fica registrado — nunca reescrito como PASS.
  const ok = exitCode === 0 || (typeof exitCode === 'number' && aceitaVeredito && aceitaVeredito.includes(exitCode));
  const passo = {
    id,
    comando: [comando, ...args].join(' '),
    exitCode,
    veredito,
    ok,
    duracaoMs: Date.now() - inicio,
    // Cauda curta: o relatório precisa ser auditável sem carregar megabytes.
    saida: saida.length > 4000 ? saida.slice(-4000) : saida,
  };
  registrar(passo);
  return passo;
}

function npmRun(id, script, opcoes = {}) {
  return rodar(id, 'npm', ['run', '-s', script], opcoes);
}

/**
 * Garante identidade git para os cenários REAIS que commitam (runner efêmero não tem nenhuma).
 *
 * Não sobrescreve configuração existente: só cria quando `user.email`/`user.name` estão ausentes,
 * e registra a identidade efetiva como passo auditável do bootstrap. Um teste que exige commit
 * real (`releaseTagPolicyBlock`, integridade de worktree, lineage de produtor) não pode reprovar
 * porque o host não tem identidade — isso é ambiente incompleto, não defeito de código.
 */
function registrarIdentidadeGit() {
  const ler = (chave) => {
    const r = spawnSync('git', ['config', '--get', chave], { encoding: 'utf8' });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
  };
  const ausentes = [];
  if (!ler('user.email')) ausentes.push(['user.email', 'ci-runner@r-agent2.invalid']);
  if (!ler('user.name')) ausentes.push(['user.name', 'RAP CI Runner']);
  const saidas = [];
  let ok = true;
  for (const [chave, valor] of ausentes) {
    const r = spawnSync('git', ['config', '--global', chave, valor], { encoding: 'utf8' });
    saidas.push(`git config --global ${chave} ${valor} (exit ${r.status})${r.stderr ? ` ${String(r.stderr).trim()}` : ''}`);
    if (r.status !== 0) ok = false;
  }
  const efetiva = `user.email=${ler('user.email') || '(ausente)'} user.name=${ler('user.name') || '(ausente)'}`;
  registrar({
    id: 'identidade-git',
    comando: 'git config --get user.email/user.name (cria --global só quando ausente)',
    exitCode: ok ? 0 : 1,
    veredito: ok ? 'PASS' : 'FAIL',
    ok,
    duracaoMs: 0,
    saida: [...saidas, `efetiva: ${efetiva}`].join('\n'),
    ambiente: { identidadeEfetiva: efetiva },
  });
  return ok;
}

function preflight() {
  const problemas = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > NODE_MIN[0] || (major === NODE_MIN[0] && minor >= NODE_MIN[1]);
  if (!nodeOk) problemas.push(`node ${process.versions.node} < ${NODE_MIN.join('.')}`);

  const versao = (bin, args = ['--version']) => {
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    return r.error || r.status !== 0 ? null : String(r.stdout || '').trim();
  };

  // DOCKER é obrigatório: a suíte de Execution Sandbox RECUSA pular (ambiente sem Docker não pode
  // alegar SANDBOX_RUNTIME=PASS), então o ambiente precisa dele de fato.
  if (!versao('docker', ['--version'])) problemas.push('docker ausente — a suíte de Execution Sandbox não roda');

  // Postgres/Redis NÃO são verificados aqui por CLI: medido no runner (2026-10-21) que
  // `redis-cli` não existe no ubuntu-latest, e exigir o BINÁRIO reprovava um ambiente onde o
  // serviço estava saudável. A conectividade real é verificada em `conectividade-infra`,
  // DEPOIS do bootstrap oficial (que cria o `.env`), usando os clientes do projeto (`pg` e
  // `ioredis`) — que é o que a aplicação usa.

  registrar({
    id: 'preflight',
    comando: '(verificação interna)',
    exitCode: problemas.length === 0 ? 0 : 1,
    veredito: problemas.length === 0 ? 'PASS' : 'FAIL',
    ok: problemas.length === 0,
    duracaoMs: 0,
    saida: problemas.join('\n'),
    ambiente: {
      node: process.versions.node,
      npm: versao('npm', ['-v']),
      /* eslint-disable-next-line global-require */
      jest: (() => { try { return require(path.join(ROOT, 'node_modules', 'jest', 'package.json')).version; } catch (_) { return null; } })(),
      docker: versao('docker', ['--version']),
      // Informativo (não bloqueia): presença dos CLIs de diagnóstico.
      psql: versao('psql'),
      redisCli: versao('redis-cli'),
    },
  });
  return problemas.length === 0;
}

/**
 * CONECTIVIDADE REAL de PostgreSQL e Redis, com os clientes do projeto.
 *
 * Roda DEPOIS do bootstrap oficial (o `.env` já existe) e usa `node --env-file=.env` para que a
 * sonda tenha exatamente as mesmas variáveis que a aplicação usará. Timeout curto e mensagem
 * explícita: infra indisponível é FALHA do bootstrap, nunca "pulado".
 */
function verificarInfra() {
  // A sonda usa os MESMOS clientes da aplicação: `api/db/sequelize` (config completa do Postgres,
  // incluindo POSTGRES_* do `.env`/config.json) e `infra/redis/rateLimitClient`. Uma sonda
  // paralela com `pg` crua reprovou por construir credenciais próprias
  // ('client password must be a string') enquanto a aplicação conectava normalmente.
  const sonda = `
const fim = (msg, code) => { process.stdout.write(msg); process.exit(code); };
(async () => {
  try {
    const { connect, close } = require('./api/db/sequelize');
    await connect(3, 500);
    await close();
  } catch (e) {
    return fim('postgres: ' + e.message, 1);
  }
  try {
    const { isRedisAvailable } = require('./infra/redis/rateLimitClient');
    const ok = await isRedisAvailable();
    if (!ok) return fim('redis: indisponível (isRedisAvailable=false)', 1);
  } catch (e) {
    return fim('redis: ' + e.message, 1);
  }
  return fim('postgres: conectado; redis: conectado', 0);
})();
`;
  const r = spawnSync(process.execPath, ['--env-file=.env', '-e', sonda], {
    cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 120000,
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const ok = r.status === 0;
  registrar({
    id: 'conectividade-infra',
    comando: 'node --env-file=.env -e <sonda sequelize + rateLimitClient>',
    exitCode: typeof r.status === 'number' ? r.status : null,
    veredito: ok ? 'PASS' : 'FAIL',
    ok,
    duracaoMs: 0,
    saida,
  });
  return ok;
}

/**
 * MATERIALIZA OS PACOTES IRMÃOS `@results/*` ANTES do `npm install`.
 *
 * Medido em 2026-10-21 num clone limpo: `npm install` criava
 * `node_modules/@results/whatsapp-qr-bridge -> <raiz>/../packages/whatsapp-qr-bridge` e
 * `@results/auth -> <raiz>/../../packages/auth` — symlinks APONTANDO PARA O NADA num clone novo
 * (o diretório irmão só existe na máquina de desenvolvimento). Resultado: duas suítes de
 * `whatsappQrBridgeService` reprovavam com `Cannot find module '@results/whatsapp-qr-bridge'`,
 * e o teste de `@results/auth` só passava por acaso em quem já tinha o pacote.
 *
 * As fontes versionadas são `vendor/auth` e `vendor/whatsapp-qr-bridge` (é o que o workflow de CI
 * copia). Os caminhos são DERIVADOS do `package.json` (`file:...`) — nunca fixados à mão, para
 * que o bootstrap funcione em qualquer profundidade de clone/runner.
 */
function materializarPacotesIrmaos() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const specs = Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
    .filter(([, spec]) => String(spec).startsWith('file:'));

  const acoes = [];
  let ok = true;

  for (const [nome, spec] of specs) {
    const alvo = path.resolve(ROOT, String(spec).slice('file:'.length));
    const origemVendor = path.join(ROOT, 'vendor', nome.split('/').pop());
    if (fs.existsSync(alvo)) {
      acoes.push(`${nome}: já presente em ${alvo}`);
      continue;
    }
    if (!fs.existsSync(origemVendor)) {
      acoes.push(`${nome}: FALHA — origem versionada ausente (${path.relative(ROOT, origemVendor)})`);
      ok = false;
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.cpSync(origemVendor, alvo, { recursive: true });
    } catch (erro) {
      acoes.push(`${nome}: FALHA ao copiar para ${alvo} (${erro.message}) — clone em caminho de profundidade diferente?`);
      ok = false;
      continue;
    }
    // O pacote tem dependências próprias resolvidas fora do node_modules da API (path real).
    if (fs.existsSync(path.join(alvo, 'package-lock.json'))) {
      const r = spawnSync('npm', ['--prefix', alvo, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
        stdio: 'pipe', encoding: 'utf8',
      });
      if (r.status !== 0) {
        acoes.push(`${nome}: npm ci no pacote falhou (${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')})`);
        ok = false;
        continue;
      }
    }
    acoes.push(`${nome}: materializado de vendor/ em ${alvo}`);
  }

  registrar({
    id: 'pacotes-irmaos',
    comando: '(materialização de vendor/ → irmãos declarados no package.json)',
    exitCode: ok ? 0 : 1,
    veredito: ok ? 'PASS' : 'FAIL',
    ok,
    duracaoMs: 0,
    saida: acoes.join('\n'),
  });
  return ok;
}

/**
 * Prova de existência **e de FRESCOR**.
 *
 * ACHADO 4 DA REVISÃO INDEPENDENTE (Fase 2): `existsSync && size > 0` aprovava artefato ANTIGO
 * deixado por outra execução/outro commit — medido com produtores que não escrevem nada
 * (`exit 0`) e 10 artefatos pré-existentes de outro commit: veredito `READY`. Um artefato
 * ignorado pelo git sobrevive no diretório do operador, então existência não é prova.
 *
 * Agora cada artefato obrigatório tem de ter sido ESCRITO nesta execução: `mtime` não anterior ao
 * início do passo que o produz. `inicioMs` é capturado antes do primeiro produtor.
 */
function verificarArtefatos(inicioMs = null) {
  const faltando = [];
  const vencidos = [];
  const presentes = [];
  for (const item of ARTEFATOS_OBRIGATORIOS) {
    const abs = path.join(ROOT, item.caminho);
    const existe = fs.existsSync(abs) && fs.statSync(abs).size > 0;
    if (!existe) {
      faltando.push(item);
      continue;
    }
    // FRESCOR só para artefato que ESTE bootstrap se compromete a reescrever. Artefato versionado
    // por outro produtor (ex.: `api-surface-report.json`, atualizado pelo workflow semanal) tem,
    // legitimamente, mtime do commit.
    if (typeof inicioMs === 'number' && item.produzidoAqui !== false) {
      const mtimeMs = fs.statSync(abs).mtimeMs;
      // Tolerância de 2 s absorve granularidade de filesystem sem aceitar artefato de outra run.
      if (mtimeMs < inicioMs - 2000) {
        vencidos.push({ caminho: item.caminho, consumidor: item.consumidor, mtime: new Date(mtimeMs).toISOString() });
        continue;
      }
    }
    presentes.push(item.caminho);
  }
  const artefatosOk = faltando.length === 0 && vencidos.length === 0;
  registrar({
    id: 'artefatos-obrigatorios',
    comando: '(verificação de existência e frescor)',
    exitCode: artefatosOk ? 0 : 1,
    veredito: artefatosOk ? 'PASS' : 'FAIL',
    ok: artefatosOk,
    duracaoMs: 0,
    saida: [
      ...faltando.map((f) => `ausente: ${f.caminho} (consumido por ${f.consumidor})`),
      ...vencidos.map((v) => `NAO REESCRITO nesta execucao: ${v.caminho} (mtime ${v.mtime}, consumido por ${v.consumidor})`),
    ].join('\n'),
    presentes,
    faltando: faltando.map((f) => f.caminho),
    naoReescritos: vencidos,
  });
  return artefatosOk;
}

/**
 * Passos 4-7 do bootstrap: índice do mesh, grafo de impacto, produtores de artefato e prova de
 * existência. Compartilhados entre o modo completo e o modo `--artifacts-only` para que exista
 * UMA definição da ordem e da lista de produtores.
 */
function produzirArtefatos() {
  // Instante de referência da prova de FRESCOR: todo artefato obrigatório tem de ser reescrito
  // a partir daqui (artefato anterior a este marco é evidência de outra execução).
  const inicioMs = Date.now();

  // 3) índice do QA Mesh (manutenção de índice: não executa cenário).
  npmRun('mesh-registry', 'qa:mesh:refresh');

  // 4) grafo de impacto — DEPOIS de qualquer alteração de fonte.
  rodar('impact-graph', 'node', ['scripts/governance/build-impact-graph.js']);

  // 5) artefatos consumidos pela suíte obrigatória. Os exit codes de VEREDITO são registrados
  //    como veredito (nunca como PASS) e a prova de existência é feita no passo 6.
  npmRun('coverage-completeness', 'validate:coverage-completeness');
  npmRun('benchmark-sufficiency', 'validate:benchmark-sufficiency');
  npmRun('evo-contract', 'validate:evo-contract');
  npmRun('layer-conventions', 'validate:layer-conventions');
  npmRun('journey-projections', 'journey:projections');
  npmRun('json-persistence-audit', 'audit:json-persistence');
  npmRun('timeout-architecture', 'validate:timeout-architecture', { aceitaVeredito: [1] });
  npmRun('engineering-router-v2', 'validate:engineering-router-v2', { aceitaVeredito: [1, 2] });
  npmRun('governance-summary', 'validate:governance-summary', { aceitaVeredito: [1] });
  npmRun('impact-validation', 'impact:validate', { aceitaVeredito: [2, 3] });

  // 6) prova de existência E FRESCOR dos artefatos exigidos pela suíte obrigatória.
  return verificarArtefatos(inicioMs);
}

function parseArgs(argv) {
  return {
    // `--artifacts-only`: prepara SÓ os artefatos consumidos por `tests/unit`. Não toca `.env`,
    // banco, seed, Docker ou build — pressupõe dependências instaladas e infra já disponível.
    artifactsOnly: argv.includes('--artifacts-only'),
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  console.log(`[ci:bootstrap] preparando ambiente reprodutível (clone limpo / runner efêmero)${args.artifactsOnly ? ' — modo artifacts-only' : ''}`);

  if (args.artifactsOnly) {
    const artefatosOk = produzirArtefatos();
    const veredito = artefatosOk && passos.every((p) => p.ok) ? 'READY' : 'INCOMPLETE';
    escreverRelatorio({ veredito, modo: 'artifacts-only' });
    console.log(`[ci:bootstrap] modo=artifacts-only veredito=${veredito} — relatório em reports/ci-bootstrap-report.json`);
    return veredito === 'READY' ? 0 : 1;
  }

  const preflightOk = preflight();
  if (!preflightOk) {
    escreverRelatorio({ veredito: 'FAIL_PREFLIGHT' });
    return 2;
  }

  // IDENTIDADE GIT DO RUNNER EFÊMERO (medido 2026-10-21, run 39670610339).
  //
  // `tests/unit/governance/releaseTagPolicyBlock.test.js` exercita
  // `scripts/create-release-tag.sh` contra um remote LOCAL de verdade: cria repositório, commita e
  // empurra. No runner efêmero do GitHub não existe `user.name`/`user.email`, então o `git commit`
  // do cenário morre com exit 128 e o teste reprova com 128 onde o contrato exige 3 (bloqueio de
  // política) ou 0 (caminho feliz). Localmente nunca aparecia porque a máquina do operador tem
  // identidade global — um defeito que só existia por AMBIENTE incompleto, não por código.
  //
  // A correção é preparar o ambiente (nunca afrouxar o teste): a identidade só é criada quando
  // AUSENTE, e a identidade usada é declarada e auditável no relatório do bootstrap.
  registrarIdentidadeGit();

  // 0) pacotes irmãos @results/* ANTES de instalar dependências (ver comentário da função).
  materializarPacotesIrmaos();

  // 1) ambiente base: .env, api/data, dependências, migrações, invariantes, build, probes.
  npmRun('system-bootstrap', 'system:bootstrap');

  // 1b) conectividade REAL de Postgres/Redis com os clientes do projeto (o `.env` já existe).
  verificarInfra();

  // 2) dados sintéticos mínimos (tenant `system` + superadmin) — sem clientes reais.
  rodar('seed-sintetico', 'node', ['api/db/seed.js']);

  // 3-6) artefatos (mesh, grafo de impacto, produtores, prova de existência).
  const artefatosOk = produzirArtefatos();

  const veredito = artefatosOk && passos.every((p) => p.ok) ? 'READY' : 'INCOMPLETE';
  escreverRelatorio({ veredito, modo: 'completo' });
  console.log(`[ci:bootstrap] veredito=${veredito} — relatório em reports/ci-bootstrap-report.json`);
  return veredito === 'READY' ? 0 : 1;
}

function escreverRelatorio({ veredito, modo = 'completo' }) {
  const relatorio = {
    artifactType: 'ci-bootstrap-report',
    artifactVersion: 1,
    generatedAt: nowIso(),
    veredito,
    modo,
    /**
     * Veredito do bootstrap NÃO é veredito de gate: `READY` significa "ambiente preparado e
     * artefatos exigidos existentes". Os gates continuam sendo os validadores canônicos.
     */
    fonteDeVerdadeDeGate: 'reports/governance-score.json / validadores canônicos — nunca este arquivo',
    raiz: ROOT,
    raizOverride: Boolean(process.env.CI_BOOTSTRAP_ROOT),
    nodeVersion: process.versions.node,
    passos,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, parseArgs, ARTEFATOS_OBRIGATORIOS };
