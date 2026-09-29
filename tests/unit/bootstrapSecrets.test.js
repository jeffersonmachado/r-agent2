'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ensureLocalSecrets,
  isValidEncryptionKey,
  isValidInternalToken,
  readEnvValue,
} = require('../../scripts/bootstrap/ensure-local-secrets');

describe('bootstrap local secrets', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-bootstrap-secrets-'));
    fs.mkdirSync(path.join(root, 'rag-service'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('gera chaves fortes e sincroniza o token do rag-service sem expor valores', () => {
    fs.writeFileSync(path.join(root, '.env'), 'ENCRYPTION_KEY=\n# RAG_INTERNAL_TOKEN=placeholder\n');

    const result = ensureLocalSecrets(root);
    const rootContent = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const ragContent = fs.readFileSync(path.join(root, 'rag-service', '.env'), 'utf8');
    const encryptionKey = readEnvValue(rootContent, 'ENCRYPTION_KEY');
    const ragToken = readEnvValue(rootContent, 'RAG_INTERNAL_TOKEN');
    const replaySigningKey = readEnvValue(rootContent, 'REPLAY_SIGNING_KEY');
    const amiSecret = readEnvValue(rootContent, 'AMI_SECRET');
    const postgresPassword = readEnvValue(rootContent, 'POSTGRES_PASSWORD');
    const runnerToken = readEnvValue(rootContent, 'ENGINEERING_RUNNER_TOKEN');
    const hostRepoRoot = readEnvValue(rootContent, 'ENGINEERING_ROUTER_HOST_REPO_ROOT');
    const workspaceRoot = readEnvValue(rootContent, 'ENGINEERING_ROUTER_WORKSPACE_ROOT');

    expect(result).toEqual({
      encryptionGenerated: true,
      ragTokenGenerated: true,
      ragTokenSynchronized: true,
      replaySigningKeyGenerated: true,
      amiSecretGenerated: true,
      postgresPasswordGenerated: true,
      engineeringRunnerTokenGenerated: true,
      engineeringRouterPathsProvisioned: true,
    });
    expect(isValidEncryptionKey(encryptionKey)).toBe(true);
    expect(isValidInternalToken(ragToken)).toBe(true);
    expect(isValidInternalToken(replaySigningKey)).toBe(true);
    expect(isValidInternalToken(amiSecret)).toBe(true);
    expect(isValidInternalToken(postgresPassword)).toBe(true);
    // separação de chaves: a de assinatura de replay NÃO é a de criptografia
    expect(replaySigningKey).not.toBe(encryptionKey);
    // e o segredo do AMI não reusa nenhuma das outras chaves
    expect(amiSecret).not.toBe(encryptionKey);
    expect(amiSecret).not.toBe(replaySigningKey);
    expect(postgresPassword).not.toBe(encryptionKey);
    expect(postgresPassword).not.toBe(amiSecret);
    expect(readEnvValue(ragContent, 'RAG_INTERNAL_TOKEN')).toBe(ragToken);
    // Drift bootstrap↔compose: as três variáveis exigidas por
    // `docker-compose.yml` (`:?`) precisam nascer no `.env` do bootstrap — o
    // teste com o `toEqual` acima é o contrato; aqui garantimos o conteúdo.
    expect(isValidInternalToken(runnerToken)).toBe(true);
    expect(runnerToken).not.toBe(encryptionKey);
    expect(runnerToken).not.toBe(ragToken);
    expect(hostRepoRoot && hostRepoRoot.length > 0).toBe(true);
    expect(workspaceRoot && workspaceRoot.length > 0).toBe(true);
    expect(JSON.stringify(result)).not.toContain(runnerToken);
    expect(JSON.stringify(result)).not.toContain(encryptionKey);
    expect(JSON.stringify(result)).not.toContain(ragToken);
    expect(JSON.stringify(result)).not.toContain(replaySigningKey);
    expect(JSON.stringify(result)).not.toContain(amiSecret);
    expect(JSON.stringify(result)).not.toContain(postgresPassword);
  });

  test('é idempotente para os caminhos do Engineering Router e preserva valor explícito do operador', () => {
    fs.writeFileSync(
      path.join(root, '.env'),
      'ENCRYPTION_KEY=\nENGINEERING_ROUTER_HOST_REPO_ROOT=/caminho/do/operador\n',
    );

    const first = ensureLocalSecrets(root);
    const afterFirst = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const workspaceRoot = readEnvValue(afterFirst, 'ENGINEERING_ROUTER_WORKSPACE_ROOT');

    // valor explícito do operador NUNCA é sobrescrito
    expect(readEnvValue(afterFirst, 'ENGINEERING_ROUTER_HOST_REPO_ROOT')).toBe(
      '/caminho/do/operador',
    );
    expect(first.engineeringRouterPathsProvisioned).toBe(true);
    expect(workspaceRoot && workspaceRoot.length > 0).toBe(true);

    const second = ensureLocalSecrets(root);
    const afterSecond = fs.readFileSync(path.join(root, '.env'), 'utf8');
    expect(second.engineeringRouterPathsProvisioned).toBe(false);
    expect(second.engineeringRunnerTokenGenerated).toBe(false);
    expect(readEnvValue(afterSecond, 'ENGINEERING_ROUTER_WORKSPACE_ROOT')).toBe(workspaceRoot);
    expect(readEnvValue(afterSecond, 'ENGINEERING_RUNNER_TOKEN')).toBe(
      readEnvValue(afterFirst, 'ENGINEERING_RUNNER_TOKEN'),
    );
  });

  test('rotaciona AMI_SECRET legado vazado (ragent2) e preserva um forte já definido', () => {
    fs.writeFileSync(path.join(root, '.env'), 'ENCRYPTION_KEY=\nAMI_SECRET=ragent2\n');

    const rotated = ensureLocalSecrets(root);
    const amiRotated = readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'AMI_SECRET');
    expect(rotated.amiSecretGenerated).toBe(true);
    expect(amiRotated).not.toBe('ragent2');
    expect(isValidInternalToken(amiRotated)).toBe(true);

    const strong = 'd'.repeat(64);
    fs.writeFileSync(path.join(root, '.env'), `AMI_SECRET=${strong}\n`);
    const preserved = ensureLocalSecrets(root);
    expect(preserved.amiSecretGenerated).toBe(false);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'AMI_SECRET')).toBe(strong);
  });

  test('rotaciona POSTGRES_PASSWORD default conhecido (StrongPass) e preserva um forte já definido', () => {
    fs.writeFileSync(path.join(root, '.env'), 'ENCRYPTION_KEY=\nPOSTGRES_PASSWORD=StrongPass\n');

    const rotated = ensureLocalSecrets(root);
    const rotatedValue = readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'POSTGRES_PASSWORD');
    expect(rotated.postgresPasswordGenerated).toBe(true);
    expect(rotatedValue).not.toBe('StrongPass');
    expect(isValidInternalToken(rotatedValue)).toBe(true);

    const strong = 'f'.repeat(64);
    fs.writeFileSync(path.join(root, '.env'), `POSTGRES_PASSWORD=${strong}\n`);
    const preserved = ensureLocalSecrets(root);
    expect(preserved.postgresPasswordGenerated).toBe(false);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'POSTGRES_PASSWORD')).toBe(strong);
  });

  test('checkout chamado `r-agent2` ⇒ HOST_REPO_ROOT é o PRÓPRIO checkout (não o monorepo pai)', () => {
    // REGRESSÃO REAL (medida 2026-09-28): o bootstrap gravava `path.dirname(root)` para
    // checkouts chamados `r-agent2`. O consumidor usa essa variável como ROOT onde roda git
    // (`git rev-parse HEAD`, `git worktree add` em patchApplyService), então o valor errado
    // fazia TODA task do Engineering Router falhar com "fatal: not a git repository"
    // (medido: suíte engineeringRouterModelRerouteE2E quebrava em createWorkspace).
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-monorepo-'));
    const checkout = path.join(parent, 'r-agent2');
    fs.mkdirSync(path.join(checkout, 'rag-service'), { recursive: true });
    fs.writeFileSync(path.join(checkout, '.env'), 'ENCRYPTION_KEY=\n');

    ensureLocalSecrets(checkout);

    const hostRepoRoot = readEnvValue(
      fs.readFileSync(path.join(checkout, '.env'), 'utf8'),
      'ENGINEERING_ROUTER_HOST_REPO_ROOT',
    );
    expect(hostRepoRoot).toBe(checkout);
    expect(hostRepoRoot).not.toBe(parent);
    expect(path.basename(hostRepoRoot)).toBe('r-agent2');

    fs.rmSync(parent, { recursive: true, force: true });
  });

  test('preserva valores válidos e é idempotente', () => {
    const encryptionKey = 'a'.repeat(64);
    const ragToken = 'b'.repeat(64);
    const replaySigningKey = 'c'.repeat(64);
    const amiSecret = 'e'.repeat(64);
    const postgresPassword = 'g'.repeat(64);
    fs.writeFileSync(path.join(root, '.env'), `ENCRYPTION_KEY=${encryptionKey}\nRAG_INTERNAL_TOKEN=${ragToken}\nREPLAY_SIGNING_KEY=${replaySigningKey}\nAMI_SECRET=${amiSecret}\nPOSTGRES_PASSWORD=${postgresPassword}\n`);
    fs.writeFileSync(path.join(root, 'rag-service', '.env'), `RAG_INTERNAL_TOKEN=${ragToken}\n`);

    expect(ensureLocalSecrets(root)).toEqual({
      encryptionGenerated: false,
      ragTokenGenerated: false,
      ragTokenSynchronized: false,
      replaySigningKeyGenerated: false,
      amiSecretGenerated: false,
      postgresPasswordGenerated: false,
      // ausentes no fixture deste teste: o bootstrap provisiona as duas na
      // primeira passada (drift bootstrap↔compose) e não repete na segunda
      engineeringRunnerTokenGenerated: true,
      engineeringRouterPathsProvisioned: true,
    });
    expect(ensureLocalSecrets(root)).toEqual({
      encryptionGenerated: false,
      ragTokenGenerated: false,
      ragTokenSynchronized: false,
      replaySigningKeyGenerated: false,
      amiSecretGenerated: false,
      postgresPasswordGenerated: false,
      engineeringRunnerTokenGenerated: false,
      engineeringRouterPathsProvisioned: false,
    });
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'ENCRYPTION_KEY')).toBe(encryptionKey);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'RAG_INTERNAL_TOKEN')).toBe(ragToken);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'REPLAY_SIGNING_KEY')).toBe(replaySigningKey);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'AMI_SECRET')).toBe(amiSecret);
    expect(readEnvValue(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'POSTGRES_PASSWORD')).toBe(postgresPassword);
  });
});
