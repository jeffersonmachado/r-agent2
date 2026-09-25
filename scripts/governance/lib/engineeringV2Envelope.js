'use strict';

/**
 * scripts/governance/lib/engineeringV2Envelope.js — ENVELOPE DE AUDITORIA V2 (gerar ≠ verificar).
 *
 * Requisito explícito da missão: GENERATE e VERIFY são operações SEPARADAS. A verificação consome
 * um envelope JÁ EXISTENTE e NUNCA o regenera — se o verifier recalculasse o envelope a partir da
 * fonte, ele sempre concordaria consigo mesmo e não provaria nada (seria um envelope
 * AUTO-REFERENTE, um dos anti-padrões proibidos pela missão).
 *
 * O verifier portanto só faz o que é verificável sem confiar em quem gerou:
 *   - recomputa o SHA-256 dos BYTES reais de cada artefato em disco;
 *   - compara com o hash declarado no `manifest.json` e no `hashes.json`;
 *   - exige que os dois concordem entre si (references coerentes);
 *   - exige `runId` idêntico em todos os artefatos (nunca mistura de execuções);
 *   - se houver `signature.json`, valida a assinatura Ed25519 sobre o `manifest` CANÔNICO usando a
 *     chave pública embutida (ou fornecida por env) — reusando `canonicalJson` de
 *     `governance/release-attestation.js`, o mesmo algoritmo já usado pelo release;
 *   - marca qualquer arquivo PRESENTE no diretório que não esteja declarado no manifesto, e
 *     qualquer arquivo declarado que esteja AUSENTE — os dois sentidos.
 *
 * Diferença em relação ao envelope V1: aquele cobre uma lista FIXA de 15 artefatos do Router V1 e
 * carrega uma validação semântica profunda por tipo (requirements de runtime, seal-fix backlog
 * etc.). Este é o mecanismo GENÉRICO de integridade para o conjunto V2 (missão, task, lease,
 * fencing, política, frescor de spec, execução de suítes): não duplica a semântica do V1 e não
 * substitui o V1 — são escopos distintos, declarados no próprio manifesto (`scope`).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalJson } = require('../../../governance/release-attestation');

const ENVELOPE_VERSION = '2.0.0';
const SCOPE_V2 = 'engineering-router-v2';
const MANIFEST_FILE = 'manifest.json';
const HASHES_FILE = 'hashes.json';
const SIGNATURE_FILE = 'signature.json';
const STATUS_FILE = 'verification.json';

const SCHEMA_ID = 'engineering-router-v2-audit-envelope@2.0.0';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readJsonSafe(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Arquivos de artefato: todo `.json` do envelope exceto os de controle. */
function listArtifactFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => ![MANIFEST_FILE, HASHES_FILE, SIGNATURE_FILE, STATUS_FILE].includes(name))
    .sort();
}

/**
 * GENERATE — escreve o envelope. Não verifica nada: gerar e verificar são operações distintas.
 *
 * @param {Object} params
 * @param {string} params.outDir           diretório do envelope (criado/limpo)
 * @param {Object} params.artifacts        mapa nome-do-arquivo → objeto JSON
 * @param {string} params.runId            identificador da execução (obrigatório)
 * @param {string} [params.sourceFingerprint]
 * @param {string} [params.sourceCommit]
 * @param {string} [params.generatedAt]
 * @returns {{outDir:string, manifest:Object, files:string[]}}
 */
function generateEnvelope({
  outDir,
  artifacts = {},
  runId,
  sourceFingerprint = null,
  sourceCommit = null,
  generatedAt = null,
} = {}) {
  if (!outDir) throw new Error('generateEnvelope exige outDir');
  if (!runId) throw new Error('generateEnvelope exige runId (sem ele não há como detectar mistura de execuções)');
  if (!artifacts || Object.keys(artifacts).length === 0) {
    throw new Error('generateEnvelope exige ao menos um artefato — envelope vazio é vacuoso');
  }
  fs.mkdirSync(outDir, { recursive: true });
  // Limpa o diretório: envelope é um retrato de UMA execução, nunca um acumulado.
  for (const existing of fs.readdirSync(outDir)) {
    fs.rmSync(path.join(outDir, existing), { recursive: true, force: true });
  }

  const files = [];
  const artifactHashes = {};
  for (const [name, payload] of Object.entries(artifacts)) {
    if (!name.endsWith('.json')) throw new Error(`artefato deve ser .json: ${name}`);
    if ([MANIFEST_FILE, HASHES_FILE, SIGNATURE_FILE, STATUS_FILE].includes(name)) {
      throw new Error(`nome de artefato reservado: ${name}`);
    }
    // Todo artefato carrega o runId do ENVELOPE: é assim que o verifier detecta mistura de
    // execuções. DEFEITO REAL medido em 2026-09-25: a primeira versão fazia `{ runId, ...payload }`
    // e o `runId` PRÓPRIO de um relatório de entrada (todo relatório de governança tem o seu, da
    // execução que o produziu) sobrescrevia o do envelope — o verifier então acusava, com razão,
    // "runId de outra execução". A correção não é descartar o runId do insumo (isso destruiria a
    // proveniência justamente dentro do artefato que existe para preservá-la): o runId do envelope
    // vira o canônico e o do insumo é PRESERVADO em `sourceRunId`.
    const sourceRunId = payload.runId && payload.runId !== runId ? payload.runId : null;
    const withRun = {
      artifactType: payload.artifactType || name.replace(/\.json$/, ''),
      ...payload,
      runId,
      ...(sourceRunId ? { sourceRunId } : {}),
    };
    const text = `${JSON.stringify(withRun, null, 2)}\n`;
    fs.writeFileSync(path.join(outDir, name), text);
    artifactHashes[name] = sha256Text(text);
    files.push(name);
  }

  const manifest = {
    artifactType: 'engineering-v2-audit-envelope-manifest',
    artifactVersion: ENVELOPE_VERSION,
    schemaId: SCHEMA_ID,
    scope: SCOPE_V2,
    generatedAt: generatedAt || new Date().toISOString(),
    runId,
    sourceCommit,
    sourceFingerprint: sourceFingerprint || null,
    artifactCount: files.length,
    artifactHashes,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, MANIFEST_FILE), manifestText);

  const hashes = {
    artifactType: 'engineering-v2-audit-envelope-hashes',
    artifactVersion: ENVELOPE_VERSION,
    schemaId: SCHEMA_ID,
    runId,
    algorithm: 'sha256',
    manifestHash: sha256Text(manifestText),
    hashes: { ...artifactHashes },
  };
  fs.writeFileSync(path.join(outDir, HASHES_FILE), `${JSON.stringify(hashes, null, 2)}\n`);

  return { outDir, manifest, files };
}

/**
 * Assina o MANIFEST de um envelope JÁ EXISTENTE (operação separada de gerar e de verificar).
 * Sem chave configurada, nenhuma assinatura é criada (estado declarado, nunca um selo falso).
 */
function signEnvelope(envelopeDir, { privateKeyPem = null } = {}) {
  const manifestPath = path.join(envelopeDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) throw new Error(`manifesto ausente em ${envelopeDir}`);
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);

  let pem = privateKeyPem;
  if (!pem) {
    const { loadPrivateKey } = require('../../../governance/release-attestation');
    try {
      pem = loadPrivateKey();
    } catch (err) {
      return { signed: false, reason: `chave privada indisponível: ${err.message}` };
    }
  }

  const canonical = canonicalJson(manifest);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), pem).toString('hex');
  const publicKeyPem = crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' });
  const payload = {
    artifactType: 'engineering-v2-audit-envelope-signature',
    artifactVersion: ENVELOPE_VERSION,
    schemaId: SCHEMA_ID,
    algorithm: 'ed25519',
    signedDocument: 'canonicalJSON(manifest)',
    runId: manifest.runId,
    manifestHash: sha256Text(manifestText),
    canonicalPayload: canonical,
    signature,
    publicKeyPem,
    publicKeyFingerprint: sha256Text(publicKeyPem),
    signedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(envelopeDir, SIGNATURE_FILE), `${JSON.stringify(payload, null, 2)}\n`);
  return { signed: true, publicKeyFingerprint: payload.publicKeyFingerprint };
}

/**
 * VERIFY — consome o envelope EXISTENTE. Nunca regenera, nunca escreve nos artefatos (apenas o
 * relatório de verificação, que é resultado, não insumo).
 *
 * @returns {{status:'VERIFIED'|'INVALID', checks:Array, failures:Array}}
 */
function verifyEnvelope(envelopeDir) {
  const checks = [];
  const failures = [];
  const record = (id, ok, detail = null) => {
    checks.push({ id, ok, detail });
    if (!ok) failures.push({ id, detail });
  };

  if (!fs.existsSync(envelopeDir) || !fs.statSync(envelopeDir).isDirectory()) {
    return { status: 'INVALID', checks: [{ id: 'ENVELOPE_EXISTS', ok: false, detail: `não é um diretório: ${envelopeDir}` }], failures: [{ id: 'ENVELOPE_EXISTS', detail: `não é um diretório: ${envelopeDir}` }] };
  }

  const manifestRead = readJsonSafe(path.join(envelopeDir, MANIFEST_FILE));
  record('MANIFEST_READABLE', manifestRead.ok, manifestRead.ok ? null : manifestRead.error);
  if (!manifestRead.ok) return { status: 'INVALID', checks, failures };
  const manifest = manifestRead.value;

  record('SCOPE_IS_V2', manifest.scope === SCOPE_V2, `scope=${manifest.scope || '(ausente)'}`);
  record('SCHEMA_ID', manifest.schemaId === SCHEMA_ID, `schemaId=${manifest.schemaId || '(ausente)'}`);
  record('RUN_ID_PRESENT', Boolean(manifest.runId), 'manifesto sem runId');

  // 1. Hash dos BYTES reais × hash declarado no manifesto.
  const declared = manifest.artifactHashes || {};
  const onDisk = listArtifactFiles(envelopeDir);
  for (const name of Object.keys(declared).sort()) {
    const absolute = path.join(envelopeDir, name);
    if (!fs.existsSync(absolute)) {
      record(`ARTIFACT_PRESENT:${name}`, false, 'declarado no manifesto e ausente do disco');
      continue;
    }
    const actual = sha256File(absolute);
    record(`ARTIFACT_HASH:${name}`, actual === declared[name], actual === declared[name] ? null : `esperado ${declared[name]}, encontrado ${actual}`);
  }

  // 2. Arquivo presente e NÃO declarado: envelope adulterado por acréscimo.
  for (const name of onDisk) {
    if (!Object.prototype.hasOwnProperty.call(declared, name)) {
      record(`ARTIFACT_UNDECLARED:${name}`, false, 'arquivo presente no envelope mas não declarado no manifesto');
    }
  }

  // 3. references: hashes.json tem de concordar com o manifesto (e com os bytes).
  const hashesRead = readJsonSafe(path.join(envelopeDir, HASHES_FILE));
  record('HASHES_READABLE', hashesRead.ok, hashesRead.ok ? null : hashesRead.error);
  if (hashesRead.ok) {
    const hashes = hashesRead.value;
    record('HASHES_RUN_ID_MATCH', hashes.runId === manifest.runId, `hashes.runId=${hashes.runId}, manifest.runId=${manifest.runId}`);
    for (const [name, value] of Object.entries(hashes.hashes || {})) {
      record(`HASHES_REFERENCE:${name}`, declared[name] === value, declared[name] === value ? null : `hashes.json=${value} × manifest=${declared[name] || '(ausente)'}`);
    }
    const manifestBytes = fs.readFileSync(path.join(envelopeDir, MANIFEST_FILE));
    record('MANIFEST_HASH_BINDING', hashes.manifestHash === sha256Text(manifestBytes.toString('utf8')), 'hashes.manifestHash não corresponde aos bytes do manifesto');
  }

  // 4. runId coerente em TODOS os artefatos (nunca mistura de execuções).
  for (const name of onDisk) {
    const read = readJsonSafe(path.join(envelopeDir, name));
    if (!read.ok) {
      record(`ARTIFACT_JSON:${name}`, false, read.error);
      continue;
    }
    record(`ARTIFACT_RUN_ID:${name}`, read.value.runId === manifest.runId, `runId do artefato=${read.value.runId}, manifesto=${manifest.runId}`);
  }

  // 5. Assinatura, quando presente: valida o manifesto CANÔNICO com a chave pública embutida.
  const signaturePath = path.join(envelopeDir, SIGNATURE_FILE);
  if (fs.existsSync(signaturePath)) {
    const sigRead = readJsonSafe(signaturePath);
    if (!sigRead.ok) {
      record('SIGNATURE_READABLE', false, sigRead.error);
    } else {
      const sig = sigRead.value;
      record('SIGNATURE_ALGORITHM', sig.algorithm === 'ed25519', `algorithm=${sig.algorithm}`);
      const canonical = canonicalJson(manifest);
      record('SIGNATURE_PAYLOAD_BINDING', sig.canonicalPayload === canonical, 'canonicalPayload não corresponde ao manifesto atual (manifesto modificado após a assinatura)');
      try {
        const valid = crypto.verify(null, Buffer.from(canonical, 'utf8'), sig.publicKeyPem, Buffer.from(sig.signature, 'hex'));
        record('SIGNATURE_VALID', valid, valid ? null : 'assinatura Ed25519 inválida');
      } catch (err) {
        record('SIGNATURE_VALID', false, err.message);
      }
    }
  } else {
    // Ausência de assinatura é ESTADO DECLARADO, nunca falha nem selo implícito.
    record('SIGNATURE_PRESENT', true, 'envelope não assinado (integridade por hash, sem assinatura)');
  }

  return {
    status: failures.length === 0 ? 'VERIFIED' : 'INVALID',
    manifest,
    checks,
    failures,
    artifactFiles: onDisk,
  };
}

module.exports = {
  ENVELOPE_VERSION,
  SCOPE_V2,
  SCHEMA_ID,
  MANIFEST_FILE,
  HASHES_FILE,
  SIGNATURE_FILE,
  STATUS_FILE,
  sha256File,
  sha256Text,
  listArtifactFiles,
  generateEnvelope,
  signEnvelope,
  verifyEnvelope,
};
