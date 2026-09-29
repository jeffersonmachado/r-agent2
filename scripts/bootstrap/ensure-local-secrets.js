#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readEnvValue(content, key) {
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=\\s*(.*)$`);
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = line.match(matcher);
    if (!match) continue;
    const value = String(match[1] || '').trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }
  return '';
}

function upsertEnvValue(content, key, value) {
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
  const lines = String(content || '').split(/\r?\n/);
  const output = [];
  let replaced = false;
  for (const line of lines) {
    if (!matcher.test(line)) {
      output.push(line);
      continue;
    }
    if (!replaced) {
      output.push(`${key}=${value}`);
      replaced = true;
    }
  }
  if (!replaced) {
    if (output.length > 0 && output[output.length - 1] !== '') output.push('');
    output.push(`${key}=${value}`);
  }
  while (output.length > 1 && output[output.length - 1] === '' && output[output.length - 2] === '') {
    output.pop();
  }
  return `${output.join('\n').replace(/\n*$/, '')}\n`;
}

function isValidEncryptionKey(value) {
  const raw = String(value || '').trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return true;
  try {
    return /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && Buffer.from(raw, 'base64').length === 32;
  } catch (_) {
    return false;
  }
}

function isValidInternalToken(value) {
  return Buffer.byteLength(String(value || '').trim(), 'utf8') >= 32;
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function ensureLocalSecrets(rootDir) {
  const root = path.resolve(rootDir);
  const rootEnvPath = path.join(root, '.env');
  const ragEnvPath = path.join(root, 'rag-service', '.env');
  let rootContent = fs.existsSync(rootEnvPath) ? fs.readFileSync(rootEnvPath, 'utf8') : '';

  let encryptionKey = readEnvValue(rootContent, 'ENCRYPTION_KEY');
  const encryptionGenerated = !isValidEncryptionKey(encryptionKey);
  if (encryptionGenerated) {
    encryptionKey = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'ENCRYPTION_KEY', encryptionKey);
  }

  let ragToken = readEnvValue(rootContent, 'RAG_INTERNAL_TOKEN');
  const ragTokenGenerated = !isValidInternalToken(ragToken);
  if (ragTokenGenerated) {
    ragToken = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'RAG_INTERNAL_TOKEN', ragToken);
  }

  // Chave dedicada de assinatura HMAC dos artefatos de replay (QA Waves).
  // Sem ela, a governança enterprise usa ENCRYPTION_KEY como fallback e os
  // artefatos assinados em ambientes anteriores falham na validação.
  let replaySigningKey = readEnvValue(rootContent, 'REPLAY_SIGNING_KEY');
  const replaySigningKeyGenerated = !isValidInternalToken(replaySigningKey);
  if (replaySigningKeyGenerated) {
    replaySigningKey = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'REPLAY_SIGNING_KEY', replaySigningKey);
  }

  // Segredo do AMI (controle do PBX). O valor legado 'ragent2' esteve
  // versionado e é público — tratá-lo como inválido força a rotação no
  // bootstrap. API e Asterisk leem o MESMO valor via compose.
  let amiSecret = readEnvValue(rootContent, 'AMI_SECRET');
  const amiSecretGenerated = !isValidInternalToken(amiSecret) || amiSecret === 'ragent2';
  if (amiSecretGenerated) {
    amiSecret = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'AMI_SECRET', amiSecret);
  }

  // Senha do Postgres dos composes (prod/test). O default versionado
  // 'StrongPass' era um segredo conhecido — os composes agora são fail-closed
  // (`${POSTGRES_PASSWORD:?}`) e o bootstrap provisiona um valor gerado.
  let postgresPassword = readEnvValue(rootContent, 'POSTGRES_PASSWORD');
  const postgresPasswordGenerated = !isValidInternalToken(postgresPassword) || postgresPassword === 'StrongPass';
  if (postgresPasswordGenerated) {
    postgresPassword = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'POSTGRES_PASSWORD', postgresPassword);
  }

  // Token do Engineering Runner: o compose é fail-closed com ele
  // (`${ENGINEERING_RUNNER_TOKEN:?}`), então sem este valor o stack prod-like
  // local (`docker compose -f docker-compose.yml up -d --no-deps api rag-service`)
  // nem interpola — e é desse stack que o smoke contínuo das QA Waves depende
  // (evidência de 48 h do `validate:qa-governance`). Drift bootstrap↔compose
  // medido em 2026-09-28: as três variáveis abaixo eram exigidas pelo compose e
  // não existiam no `.env` gerado, derrubando três tentativas de subir o stack.
  let engineeringRunnerToken = readEnvValue(rootContent, 'ENGINEERING_RUNNER_TOKEN');
  const engineeringRunnerTokenGenerated = !isValidInternalToken(engineeringRunnerToken);
  if (engineeringRunnerTokenGenerated) {
    engineeringRunnerToken = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'ENGINEERING_RUNNER_TOKEN', engineeringRunnerToken);
  }

  // Caminhos REAIS do host exigidos pelo compose (ER-V1-SEALFIX-002): o compose
  // faz bind-mount literal `${ROOT}:${ROOT}` porque o daemon precisa enxergar os
  // mesmos bytes. Derivados do checkout local e NUNCA sobrescritos quando já
  // definidos (um valor explícito do operador sempre vence).
  let engineeringRouterPathsProvisioned = false;
  if (!readEnvValue(rootContent, 'ENGINEERING_ROUTER_HOST_REPO_ROOT')) {
    // REGRESSÃO CORRIGIDA (2026-09-28, medida): este campo gravava `path.dirname(root)`
    // quando o checkout se chama `r-agent2`, com a justificativa de que o pacote
    // `@results/auth` seria resolvido "a partir daqui". Mas o CONSUMIDOR usa esta variável
    // como ROOT onde roda `git` (`contextBuilderService.js`, `executionSandbox.js`, e o
    // `patchApplyService` que faz `git rev-parse HEAD` + `git worktree add`): com o diretório
    // PAI, o git falha com "fatal: not a git repository" e NENHUMA task do Engineering Router
    // consegue aplicar patch (medido: suíte `engineeringRouterModelRerouteE2E` quebrava em
    // `createWorkspace`). O fallback do próprio código é o checkout
    // (`path.resolve(__dirname,'..','..','..')`), então o valor correto é o checkout.
    // A resolução do pacote irmão é um assunto de npm/build, não desta variável.
    const hostRepoRoot = root;
    rootContent = upsertEnvValue(rootContent, 'ENGINEERING_ROUTER_HOST_REPO_ROOT', hostRepoRoot);
    engineeringRouterPathsProvisioned = true;
  }
  if (!readEnvValue(rootContent, 'ENGINEERING_ROUTER_WORKSPACE_ROOT')) {
    // Default documentado em docs/architecture/ENGINEERING_MODEL_ROUTER_OPERATIONS.md.
    rootContent = upsertEnvValue(
      rootContent,
      'ENGINEERING_ROUTER_WORKSPACE_ROOT',
      path.join(os.tmpdir(), 'engineering-router-workspaces'),
    );
    engineeringRouterPathsProvisioned = true;
  }

  writeAtomic(rootEnvPath, rootContent);

  let ragContent = fs.existsSync(ragEnvPath) ? fs.readFileSync(ragEnvPath, 'utf8') : '';
  const ragTokenSynchronized = readEnvValue(ragContent, 'RAG_INTERNAL_TOKEN') !== ragToken;
  if (ragTokenSynchronized) {
    ragContent = upsertEnvValue(ragContent, 'RAG_INTERNAL_TOKEN', ragToken);
  }
  writeAtomic(ragEnvPath, ragContent);

  return {
    encryptionGenerated,
    ragTokenGenerated,
    ragTokenSynchronized,
    replaySigningKeyGenerated,
    amiSecretGenerated,
    postgresPasswordGenerated,
    engineeringRunnerTokenGenerated,
    engineeringRouterPathsProvisioned,
  };
}

if (require.main === module) {
  const rootDir = process.argv[2] || path.join(__dirname, '..', '..');
  const result = ensureLocalSecrets(rootDir);
  // Nunca imprimir valores secretos.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  ensureLocalSecrets,
  isValidEncryptionKey,
  isValidInternalToken,
  readEnvValue,
  upsertEnvValue,
};
