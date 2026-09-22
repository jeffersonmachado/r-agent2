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

const ROOT = path.resolve(__dirname, '..', '..', '..');
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
  execFileSync('find', [
    cwd,
    '-not', '-path', `${cwd}/node_modules`,
    '-not', '-path', `${cwd}/node_modules/*`,
    '-exec', 'chmod', 'go+rX', '{}', '+',
  ]);
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
async function runInSandbox({ executable, args, cwd, env, timeoutMs, network = 'none' }) {
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
  const containerName = `er-sandbox-${crypto.randomBytes(8).toString('hex')}`;
  const dockerArgs = buildDockerArgs({ executable, args, cwd, env, containerName, network });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn('docker', dockerArgs, { shell: false });

    const timer = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        // Mata o CONTAINER explicitamente (não só o processo cliente `docker run`): o cliente
        // morrer não garante que o container remoto pare — achado real de design, não teórico
        // (um `docker run` cujo cliente é sinalizado não propaga o sinal ao container por
        // padrão).
        try {
          execFileSync('docker', ['kill', containerName], { stdio: 'ignore', timeout: 5000 });
        } catch (_) {
          // container já pode ter terminado sozinho — sem problema.
        }
      }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: timedOut ? null : exitCode,
        stdout,
        stderr,
        timedOut,
        signal: timedOut ? 'SIGKILL' : signal,
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
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
  SANDBOX_IMAGE,
};
