'use strict';

/**
 * ER-V1-FINAL-001 — Execution Sandbox.
 *
 * Antes desta correção, `testRunnerService.runOneCommand` executava testCommands via
 * `child_process.spawn` puro do host — isolamento só em nível de aplicação (allowlist de
 * comando estrutural + env allowlist + redação de output), zero em nível de SO/kernel. Achado
 * real reproduzido (ver ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md, ER-V1-FINAL-001): um
 * `testCommand` malicioso (`node scripts/**|tests/**`, permitido pela allowlist estrutural)
 * conseguia ler /etc/passwd, abrir conexão TCP para rede externa, acessar o socket do Docker
 * do host, escrever arquivo fora do workspace, corromper fisicamente o `node_modules` real do
 * repositório (via o symlink gravável criado por patchApplyService.materializeWorktree) e
 * spawnar processos filho sem qualquer limite de PIDs/CPU/memória.
 *
 * Este módulo executa o mesmo contrato de `runOneCommand` dentro de um container Docker
 * descartável, non-root, sem rede, sem docker socket, com filesystem raiz read-only e limites
 * explícitos de CPU/memória/PIDs — substituindo o `spawn` de host puro.
 */

const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

// ER-V1-SEALFIX-002 (Real Container Deployment) — achado real: este módulo roda DENTRO do
// Engineering Runner (container separado, único com o Docker socket do host montado — ER-V1-
// SEAL-003) e monta `ROOT/node_modules`/`ROOT/.git` via `docker run -v` executado pelo Docker
// daemon do HOST. Um `ROOT` calculado por `__dirname` (caminho relativo a ONDE este arquivo foi
// copiado dentro da imagem do runner, ex. `/app`) NUNCA é um caminho válido para o HOST montar —
// o daemon procuraria `/app/.git` no filesystem do HOST, não do container, e falharia (ou,
// pior, montaria algo coincidentalmente presente ali). Só é seguro por acidente quando o runner roda
// como processo bare no mesmo host que o repositório real (dev, Jest — nunca o caso em
// produção containerizada). `ENGINEERING_ROUTER_HOST_REPO_ROOT`, quando definida (produção:
// aponta para o bind mount do checkout real do host, montado no MESMO caminho absoluto dentro
// do container do runner), tem precedência — mesma env var e mesma convenção de
// `contextBuilderService.js` (API), nunca uma segunda variável divergente.
const ROOT = process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT
  ? path.resolve(process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT)
  : path.resolve(__dirname, '..', '..', '..');
const SANDBOX_IMAGE = process.env.ENGINEERING_ROUTER_SANDBOX_IMAGE || 'r-agent2-engineering-router-sandbox:latest';
const DEFAULT_MEMORY = process.env.ENGINEERING_ROUTER_SANDBOX_MEMORY || '512m';
const DEFAULT_PIDS_LIMIT = process.env.ENGINEERING_ROUTER_SANDBOX_PIDS_LIMIT || '64';
const DEFAULT_CPUS = process.env.ENGINEERING_ROUTER_SANDBOX_CPUS || '1';
const DEFAULT_TMPFS_SIZE = process.env.ENGINEERING_ROUTER_SANDBOX_TMPFS_SIZE || '64m';
// UID/GID SEMPRE não-privilegiado e fixo — nunca o UID do processo host (que em produção real
// roda como root; usar `--user=0:0` no sandbox violaria a exigência non-root). Achado real: um
// UID fixo não tem, por padrão, permissão de leitura sobre o workspace (git worktree/mkdtemp
// criam com permissões restritas ao dono) — resolvido em `ensureWorkspaceReadableBySandbox`
// abaixo, nunca afrouxando o UID do container.
const SANDBOX_UID_GID = process.env.ENGINEERING_ROUTER_SANDBOX_UIDGID || '10001:10001';

let dockerAvailabilityCache = null;

/**
 * Verifica, uma única vez por processo, se o Docker CLI consegue falar com um daemon — nunca
 * assume disponibilidade: um ambiente sem Docker deve falhar de forma explícita
 * (SANDBOX_UNAVAILABLE), nunca silenciosamente cair de volta para execução sem sandbox.
 */
function isSandboxAvailable() {
  if (dockerAvailabilityCache !== null) return dockerAvailabilityCache;
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: 5000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    dockerAvailabilityCache = true;
  } catch (_) {
    dockerAvailabilityCache = false;
  }
  return dockerAvailabilityCache;
}

/** Uso interno de teste: força reavaliação da disponibilidade do Docker. */
function resetSandboxAvailabilityCache() {
  dockerAvailabilityCache = null;
}

/**
 * Torna o workspace legível/gravável pelo UID fixo do sandbox (10001), sem tocar em
 * node_modules (symlink para o node_modules real do repositório — um `chmod -R` ali
 * alteraria permissões do node_modules REAL do host). `git worktree add`/`fs.mkdtempSync`
 * criam o workspace com permissões restritas ao UID do processo host; como o container roda
 * sob um UID fixo diferente por design (nunca root, nunca o UID do host), o workspace precisa
 * ser explicitamente aberto para esse UID antes de montar.
 *
 * Achado real: um primeiro rascunho usava `chmod 777` (modo completo) — isso ALTERA o bit
 * executável do dono em qualquer arquivo que não o tivesse, e git rastreia exatamente esse bit
 * (modo 100644 vs 100755 no índice); o efeito colateral observado foi `git status` dentro do
 * worktree reportando TODOS os arquivos como modificados, o que corromperia a comparação de
 * tree hash do ER-V1-FINAL-002 (Exact Promotion). `go+rX` só ADICIONA leitura (e execução
 * condicional a diretórios/arquivos que já eram executáveis) para group/others — o bit do
 * dono, único que o git rastreia, nunca é tocado.
 */
function ensureWorkspaceReadableBySandbox(cwd) {
  // `-user <uid do host>`: só tenta `chmod` no que ESTE processo materializou.
  //
  // DEFEITO REAL medido 2026-10-09: comandos sandboxed criam artefatos DENTRO do
  // workspace sob o UID fixo do container (10001) — `.npm/`, `.npm/_logs/…`,
  // `.cache/`. Na execução SEGUINTE (o mesmo workspace roda patch e depois
  // regressão) o `chmod go+rX` batia nesses arquivos, recebia EPERM ("Operação não
  // permitida": não se altera modo de arquivo alheio) e o `execFileSync` lançava —
  // abortando a execução INTEIRA. Efeito medido: `exitCode: null` →
  // `INFRA_ERROR` → `BLOCKED_INFRA` em todas as suítes E2E do Router e nos workers
  // da própria API (bug-loop), de forma sistemática neste ambiente.
  //
  // Arquivo criado pelo UID do sandbox NÃO precisa deste passo: quem o criou
  // (uid 10001) é exatamente quem vai lê-lo. Pular o que não é nosso mantém o
  // invariante (nada do host fica ilegível para o sandbox) sem transformar um
  // artefato de cache alheio em falha de infraestrutura.
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : null;
  execFileSync('find', [
    cwd,
    ...(uid ? ['-user', uid] : []),
    '-not', '-path', `${cwd}/node_modules`,
    '-not', '-path', `${cwd}/node_modules/*`,
    '-exec', 'chmod', 'go+rX', '{}', '+',
  ]);
}

/**
 * Torna o workspace GRAVÁVEL pelo UID fixo do sandbox (10001).
 *
 * Achado real (2026-10-09, missão brace-expansion): `ensureWorkspaceReadableBySandbox` dava
 * apenas LEITURA, mas este docstring já afirmava "legível/gravável" — divergência entre o
 * documentado e o implementado. Comandos de teste que GRAVAM no workspace (ex.:
 * `engine/__tests__/functionalFlows.test.js` cria `replays/simulation`, qualquer build que gere
 * artefato) morriam com `EACCES: permission denied, mkdir '<workspace>/replays/simulation'`,
 * derrubando `npm run test:flow` (medido: 2 testes falhando no workspace isolado e 264 passando
 * na MESMA árvore fora dele — a diferença era só o sandbox).
 *
 * Mecanismo: ACL (setfacl) concede `rwX` EXATAMENTE ao UID do sandbox — nunca a "others", porque
 * o workspace carrega uma cópia do `.env`. A default ACL faz arquivos e diretórios criados
 * DEPOIS (pelos próprios testes) nascerem graváveis, que é o caso que falhava.
 * Fallback (fs sem ACL): `go+rwX` nos bits de modo; como `+X`, nunca altera o bit de execução do
 * DONO — o único que o git rastreia (modo 100644 vs 100755), preservando a comparação de tree
 * hash.
 *
 * @returns {{mechanism:'acl'|'chmod', uid:string}} para o relatório de execução.
 */
function ensureWorkspaceWritableBySandbox(cwd, uidGid = SANDBOX_UID_GID) {
  const uid = String(uidGid || '').split(':')[0].trim();
  const excluirNodeModules = ['-not', '-path', `${cwd}/node_modules`, '-not', '-path', `${cwd}/node_modules/*`];
  if (uid) {
    try {
      execFileSync('setfacl', ['-R', '-m', `u:${uid}:rwX`, cwd], { stdio: 'ignore' });
      execFileSync('setfacl', ['-R', '-d', '-m', `u:${uid}:rwX`, cwd], { stdio: 'ignore' });
      return { mechanism: 'acl', uid };
    } catch {
      // Sem ACL no filesystem: cai para os bits de modo abaixo.
    }
  }
  execFileSync('find', [
    cwd,
    ...(typeof process.getuid === 'function' ? ['-user', String(process.getuid())] : []),
    ...excluirNodeModules,
    '-exec', 'chmod', 'go+rwX', '{}', '+',
  ]);
  return { mechanism: 'chmod', uid };
}

/**
 * Monta os argumentos do `docker run` para uma execução sandboxed de um único comando.
 *
 * `cwd` é montado no MESMO caminho absoluto dentro do container (não remapeado para
 * `/workspace`): um git worktree real referencia o `.git` do repositório principal por
 * caminho absoluto (`gitdir: <ROOT>/.git/worktrees/<label>`, confirmado por inspeção real —
 * ver ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md), então `git status/diff/apply --check` dentro do
 * worktree só resolve se `<ROOT>/.git` estiver acessível no MESMO path absoluto. `<ROOT>/.git`
 * entra read-only (histórico/objetos — nunca escrita); é o mesmo conteúdo que o LLM já viu no
 * patch, não uma escalada de privilégio.
 *
 * `node_modules` do workspace: NUNCA o symlink gravável de patchApplyService.js sobrevive aqui
 * — este módulo monta `<ROOT>/node_modules` como bind read-only por cima do que estiver em
 * `<cwd>/node_modules`, fechando a superfície de escrita real que corrompia o node_modules do
 * repositório.
 */
function buildDockerArgs({ executable, args, cwd, env, containerName, network }) {
  const dockerArgs = [
    'run',
    '--rm',
    `--name=${containerName}`,
    `--network=${network || 'none'}`,
    '--read-only',
    // Achado real: workspaces reais (patchApplyService.WORKSPACE_ROOT) ficam por padrão sob
    // os.tmpdir() do HOST, ou seja, sob /tmp. Montar o tmpfs interno do sandbox em /tmp
    // colidiria/obscureceria o bind mount do workspace quando ele também está sob /tmp
    // (confirmado: "Permission denied" ao listar o workspace montado dentro de /tmp com um
    // tmpfs também em /tmp). Path dedicado que nunca coincide com o workspace real.
    `--tmpfs=/sandbox-tmp:rw,noexec,nosuid,size=${DEFAULT_TMPFS_SIZE}`,
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--pids-limit=${DEFAULT_PIDS_LIMIT}`,
    `--memory=${DEFAULT_MEMORY}`,
    `--cpus=${DEFAULT_CPUS}`,
    `--user=${SANDBOX_UID_GID}`,
    '-v', `${cwd}:${cwd}`,
    '-v', `${path.join(ROOT, 'node_modules')}:${path.join(cwd, 'node_modules')}:ro`,
    '-v', `${path.join(ROOT, '.git')}:${path.join(ROOT, '.git')}:ro`,
    '-w', cwd,
    // /tmp do container fica read-only (rootfs --read-only, sem tmpfs lá — ver comentário
    // acima); ferramentas que precisem de scratch space (git, npm) usam TMPDIR/TMP/TEMP.
    '-e', 'TMPDIR=/sandbox-tmp',
    '-e', 'TMP=/sandbox-tmp',
    '-e', 'TEMP=/sandbox-tmp',
    // git: o UID do sandbox (10001) nunca é dono dos arquivos do workspace (pertencem ao
    // usuário do host) — sem isto, qualquer comando git dentro do sandbox falha com
    // "detected dubious ownership" (achado real). "*" é seguro aqui porque o único conteúdo
    // acessível ao container já é o workspace + .git montados explicitamente por este módulo.
    '-e', 'GIT_CONFIG_COUNT=1',
    '-e', 'GIT_CONFIG_KEY_0=safe.directory',
    '-e', 'GIT_CONFIG_VALUE_0=*',
  ];
  for (const [key, value] of Object.entries(env || {})) {
    dockerArgs.push('-e', `${key}=${value}`);
  }
  dockerArgs.push(SANDBOX_IMAGE, executable, ...args);
  return dockerArgs;
}

/**
 * Executa `executable args...` dentro do sandbox Docker. Contrato de retorno compatível com o
 * `runOneCommand` anterior (exitCode/stdout/stderr/timedOut/signal), para que
 * testRunnerService.js troque a chamada sem mudar o resto do pipeline (redaction, evidence,
 * excerpting continuam no chamador).
 */
/**
 * Terminação GRACIOSA do container (§23): `docker kill --signal=SIGTERM` → janela de grace →
 * `docker kill` (SIGKILL) somente se o container ainda estiver de pé. Antes era `docker kill`
 * direto (SIGKILL imediato): o processo de teste nunca tinha chance de fechar handles, gravar
 * relatório parcial ou liberar recursos. Só o CONTAINER (child) é sinalizado — nunca o Engineer
 * Worker nem o runner.
 */
function terminateContainerGracefully(containerName, graceMs, steps, onSigkill) {
  try {
    execFileSync('docker', ['kill', '--signal=SIGTERM', containerName], { stdio: 'ignore', timeout: 5000 });
    steps.push({ action: 'sigterm', at: Date.now() });
  } catch (_) {
    // container já pode ter terminado sozinho — sem problema.
  }
  const graceTimer = setTimeout(() => {
    try {
      execFileSync('docker', ['kill', containerName], { stdio: 'ignore', timeout: 5000 });
      steps.push({ action: 'sigkill', at: Date.now() });
      onSigkill();
    } catch (_) {
      // saiu dentro do grace: SIGKILL não foi necessário.
    }
  }, graceMs);
  if (typeof graceTimer.unref === 'function') graceTimer.unref();
  return graceTimer;
}

function resolveGraceMs(graceMs) {
  if (Number.isFinite(graceMs) && graceMs > 0) return graceMs;
  try {
    // eslint-disable-next-line global-require
    return require('../../utils/operationDeadline').policyMs('REGRESSION_CHILD_TERMINATION_GRACE');
  } catch (_) {
    return 10000;
  }
}

async function runInSandbox({ executable, args, cwd, env, timeoutMs, network = 'none', graceMs = null, signal = null }) {
  if (!isSandboxAvailable()) {
    const error = new Error('SANDBOX_UNAVAILABLE: Docker daemon inacessível — execução recusada (fail-closed, nunca cai de volta para spawn sem sandbox)');
    error.code = 'SANDBOX_UNAVAILABLE';
    throw error;
  }

  // Achado real (reprodução ao vivo): um `cwd` igual ao repositório principal (ou um
  // ancestral dele) faz `ensureWorkspaceReadableBySandbox` tentar `chmod` recursivo sobre TODO
  // o código-fonte real do projeto (inclusive node_modules aninhados de outros workspaces, ex.
  // frontend/node_modules) — e o mount `-v ${cwd}:${cwd}` montaria o repositório inteiro
  // dentro do sandbox. `cwd` só pode ser um workspace efêmero e descartável, nunca o próprio
  // ROOT nem um caminho que o contenha — fail-closed explícito, nunca silencioso.
  const resolvedCwd = path.resolve(cwd || '');
  const isRootItself = resolvedCwd === ROOT;
  const isRootAncestorOfCwd = ROOT.startsWith(`${resolvedCwd}${path.sep}`);
  if (isRootItself || isRootAncestorOfCwd) {
    const error = new Error(`SANDBOX_INVALID_WORKSPACE: cwd "${cwd}" é o repositório principal (ou um ancestral dele) — recusado para nunca operar sobre o código-fonte real fora de um workspace isolado`);
    error.code = 'SANDBOX_INVALID_WORKSPACE';
    throw error;
  }

  ensureWorkspaceReadableBySandbox(cwd);
  // Leitura não basta: comandos de teste que gravam no workspace falhavam com EACCES (medido).
  ensureWorkspaceWritableBySandbox(cwd);
  const containerName = `er-sandbox-${crypto.randomBytes(8).toString('hex')}`;
  const dockerArgs = buildDockerArgs({ executable, args, cwd, env, containerName, network });

  const effectiveGraceMs = resolveGraceMs(graceMs);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let terminatedBy = null;
    let settled = false;
    let graceTimer = null;
    const terminationSteps = [];

    const child = spawn('docker', dockerArgs, { shell: false });

    // Mata o CONTAINER explicitamente (não só o processo cliente `docker run`): o cliente
    // morrer não garante que o container remoto pare — um `docker run` cujo cliente é sinalizado
    // não propaga o sinal ao container por padrão.
    const terminate = () => {
      terminatedBy = 'SIGTERM';
      graceTimer = terminateContainerGracefully(containerName, effectiveGraceMs, terminationSteps, () => { terminatedBy = 'SIGKILL'; });
    };

    const timer = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs)
      : null;

    const onAbort = () => {
      if (timedOut || cancelled || settled) return;
      cancelled = true;
      terminate();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('close', (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        exitCode: timedOut || cancelled ? null : exitCode,
        stdout,
        stderr,
        timedOut,
        cancelled,
        terminatedBy,
        terminationSteps,
        graceMs: effectiveGraceMs,
        signal: terminatedBy || exitSignal,
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err.message}`,
        timedOut: false,
        signal: null,
      });
    });
  });
}

module.exports = {
  runInSandbox,
  isSandboxAvailable,
  resetSandboxAvailabilityCache,
  ensureWorkspaceReadableBySandbox,
  ensureWorkspaceWritableBySandbox,
  SANDBOX_IMAGE,
  SANDBOX_UID_GID,
};
