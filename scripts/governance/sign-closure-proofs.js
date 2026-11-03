#!/usr/bin/env node
'use strict';

/**
 * sign-closure-proofs.js — assina os RASCUNHOS de prova de fechamento com a chave de autoridade.
 *
 * POR QUE EXISTE
 * --------------
 * `regularize-bug-closures.js` faz a parte executável (re-executa o teste de regressão real, guarda
 * a saída com sha256 e monta o rascunho), mas NÃO assina — a chave privada é do dono. Este script
 * é o outro lado do fluxo: pega os rascunhos que já passaram do verificador, aplica a assinatura
 * Ed25519 da autoridade registrada e registra a atestação no livro de transições.
 *
 * O QUE ELE NÃO FAZ (de propósito)
 * --------------------------------
 *   - NÃO inventa prova: só assina rascunho cujo `evaluatedCommit` é o HEAD atual e cujo teste
 *     realmente executou com exit 0 (o rascunho carrega a execução).
 *   - NÃO ignora o verificador: antes de gravar, chama `verificarProvaDeFechamento` com âncora
 *     externa + pins; se o veredito não for OK, o item é listado e NADA é gravado.
 *   - NÃO altera a fila: atestação não transiciona estado (`fromState === toState`).
 *   - NÃO imprime valor de segredo: só presença/ausência e fingerprints truncados.
 *
 * Uso:
 *   node scripts/governance/sign-closure-proofs.js --identity <id> --key <chave-privada.pem>
 *        [--dir governance/bug-closure/proofs-drafts] [--limit N] [--dry-run] [--json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

const {
  payloadAssinavel, hashDoPayload, verificarProvaDeFechamento, carregarAutoridadesDeFechamento,
} = require(path.join(ROOT, 'governance', 'bug-closure', 'closure-proof'));
const { canonicalJson } = require(path.join(ROOT, 'governance', 'risk-acceptance', 'signature'));
const { applyAttestation } = require(path.join(ROOT, 'governance', 'bug-closure', 'transition-service'));
const { ancoraExterna } = require(path.join(ROOT, 'governance', 'bug-closure', 'trusted-authorities'));
const { computeSourceFingerprint } = require(path.join(ROOT, 'governance', 'proof-engine', 'fingerprint-chain'));

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes(nome);

const DIR = path.resolve(ROOT, arg('--dir', path.join('governance', 'bug-closure', 'proofs-drafts')));
const IDENTITY = arg('--identity');
const KEY_PATH = arg('--key');
const LIMIT = arg('--limit') ? Number(arg('--limit')) : null;
const DRY_RUN = flag('--dry-run');

function commitAtual() {
  const { execFileSync } = require('child_process');
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * Fingerprint do código — MESMA função usada pelo regularizador
 * (`computeSourceFingerprint`), para que a prova assinada case com a árvore avaliada.
 */
function fingerprintAtual() {
  return computeSourceFingerprint(ROOT);
}

function assinar(prova, chavePrivada, identity) {
  // ORDEM IMPORTA: `actor` está em CAMPOS_ASSINADOS. Assinar o payload com o ator do rascunho e
  // depois trocar o ator invalida a própria assinatura (defeito pego pelo verificador: 69 itens
  // recusados com ASSINATURA_INVALIDA). O ator é definido ANTES de assinar.
  const base = { ...prova, actor: { id: identity, kind: 'humano' } };
  const payload = canonicalJson(payloadAssinavel(base));
  const valor = crypto.sign(null, Buffer.from(payload, 'utf8'), chavePrivada);
  const assinada = {
    ...base,
    signature: {
      alg: 'Ed25519',
      keyId: identity,
      value: valor.toString('base64'),
      signedAt: new Date().toISOString(),
    },
  };
  assinada.proofHash = hashDoPayload(assinada);
  return assinada;
}

function main() {
  if (!IDENTITY || !KEY_PATH) {
    process.stderr.write('[sign] uso: --identity <id> --key <chave-privada.pem> [--dry-run] [--json]\n');
    return 2;
  }
  const chave = crypto.createPrivateKey(fs.readFileSync(path.resolve(KEY_PATH), 'utf8'));
  const commit = commitAtual();
  const fingerprint = fingerprintAtual();
  const ancoragem = { pins: null, externa: ancoraExterna() };
  const autoridades = carregarAutoridadesDeFechamento(ROOT);
  const autoridade = (Array.isArray(autoridades) ? autoridades : []).find((a) => a.identity === IDENTITY);
  if (!autoridade) {
    process.stderr.write(`[sign] RECUSADO: identidade "${IDENTITY}" não está registrada em authorities.json\n`);
    return 2;
  }
  if (!autoridade.mayCloseDefects) {
    process.stderr.write(`[sign] RECUSADO: "${IDENTITY}" não tem mayCloseDefects\n`);
    return 2;
  }

  const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  const resultados = [];
  let assinados = 0;

  for (const arquivo of arquivos) {
    if (LIMIT && assinados >= LIMIT) break;
    const rel = path.join(path.relative(ROOT, DIR), arquivo);
    let rascunho;
    try {
      rascunho = JSON.parse(fs.readFileSync(path.join(DIR, arquivo), 'utf8'));
    } catch (erro) {
      resultados.push({ arquivo: rel, status: 'RASCUNHO_ILEGIVEL', motivo: erro.message });
      continue;
    }

    if (rascunho.evaluatedCommit !== commit) {
      resultados.push({ arquivo: rel, id: rascunho.defectId, status: 'RASCUNHO_VENCIDO', motivo: `commit ${String(rascunho.evaluatedCommit).slice(0, 9)} != HEAD ${commit.slice(0, 9)}` });
      continue;
    }

    const prova = assinar(rascunho, chave, IDENTITY);
    const veredito = verificarProvaDeFechamento(prova, {
      defeito: { id: prova.defectId, severity: prova.severityAfter || prova.severityBefore, state: String(prova.toState || '').toUpperCase() },
      currentCommit: commit,
      currentFingerprint: fingerprint,
      rootDir: ROOT,
      autoridades,
      ancoragem,
      livro: null,
      agora: Date.now(),
      existeArquivo: (relArq) => fs.existsSync(path.join(ROOT, relArq)),
    });

    if (!veredito.ok) {
      resultados.push({ arquivo: rel, id: prova.defectId, status: 'RECUSADA_PELO_VERIFICADOR', motivos: veredito.reasons });
      continue;
    }

    if (DRY_RUN) {
      resultados.push({ arquivo: rel, id: prova.defectId, status: 'PRONTA_PARA_GRAVAR' });
      assinados += 1;
      continue;
    }

    const aplicada = applyAttestation({
      defectId: prova.defectId,
      proof: prova,
      currentCommit: commit,
      currentFingerprint: fingerprint,
      rootDir: ROOT,
      autoridades,
      ancoragem,
      actor: { id: IDENTITY },
    });
    if (!aplicada.ok) {
      resultados.push({ arquivo: rel, id: prova.defectId, status: 'ATESTACAO_RECUSADA', motivos: aplicada.reasons, code: aplicada.code });
      continue;
    }
    assinados += 1;
    resultados.push({ arquivo: rel, id: prova.defectId, status: 'ATESTADA' });
  }

  const resumo = {
    kind: 'sign-closure-proofs',
    generatedAt: new Date().toISOString(),
    commit,
    identity: IDENTITY,
    ancoragemExterna: Boolean(ancoragem.externa),
    dryRun: DRY_RUN,
    candidatos: arquivos.length,
    assinados,
    porStatus: resultados.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
  };

  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify({ ...resumo, resultados }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(resumo, null, 2)}\n`);
  }
  return assinados > 0 ? 0 : 1;
}

process.exitCode = main();
