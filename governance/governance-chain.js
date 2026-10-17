#!/usr/bin/env node
'use strict';

/**
 * Governance Chain — motor de cadeia de imutabilidade criptográfica.
 *
 * Constrói uma cadeia ordenada de hashes SHA-256 sobre todos os artefatos
 * de governança. Qualquer adulteração em qualquer camada quebra o chainRoot
 * e invalida toda a governança.
 *
 * Estrutura da cadeia (ordem determinística):
 *   0. package (ZIP)
 *   1. manifest (sidecar .manifest.json)
 *   2. evidence-manifest
 *   3. final-proof-report
 *   4. final-readiness-report
 *   5. final-consistency-report
 *   6. cross-report-validation
 *   7. proof-signature
 *   8. blocker-engine
 *   9. package-validation-report
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { findLatestReleaseArtifact } = require('../tools/system/lib/release-artifact');

const ROOT        = path.join(__dirname, '..');
const CHAIN_PATH  = path.join(ROOT, 'governance', 'governance-chain.json');
const GENESIS_HASH = '0'.repeat(64);

// ─── Utilitários ──────────────────────────────────────────────────────────────
function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256String(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function resolveArtifact() {
  try {
    return findLatestReleaseArtifact({ requireAuditPassed: true });
  } catch (_) {
    return findLatestReleaseArtifact({ requireAuditPassed: false });
  }
}

// ─── Definição das camadas da cadeia (ordem fixa) ─────────────────────────────
function buildChainLayers(artifact) {
  const zipPath      = artifact.zipPath;
  const manifestPath = artifact.manifestPath || path.join(ROOT, 'dist',
    (artifact.zip || '').replace(/\.zip$/, '.manifest.json'));

  return [
    { id: 'package',              path: zipPath,                                                  label: 'Release ZIP'              },
    { id: 'sidecar_manifest',     path: manifestPath,                                             label: 'Release Manifest Sidecar' },
    { id: 'evidence_manifest',    path: path.join(ROOT, 'governance', 'evidence-manifest.json'), label: 'Evidence Manifest'        },
    { id: 'final_proof_report',   path: path.join(ROOT, 'governance', 'final-proof-report.json'),label: 'Final Proof Report'       },
    { id: 'final_readiness',      path: path.join(ROOT, 'governance', 'final-readiness-report.json'), label: 'Final Readiness Report' },
    { id: 'consistency_report',   path: path.join(ROOT, 'governance', 'final-consistency-report.json'), label: 'Consistency Report' },
    { id: 'cross_report',         path: path.join(ROOT, 'governance', 'cross-report-validation.json'), label: 'Cross-Report Validation' },
    { id: 'proof_signature',      path: path.join(ROOT, 'governance', 'proof-signature.json'),   label: 'Proof Signature'          },
    { id: 'blocker_engine',       path: path.join(ROOT, 'governance', 'blocker-engine.js'),      label: 'Blocker Engine'           },
    { id: 'package_validation',   path: path.join(ROOT, 'governance', 'package-validation-report.json'), label: 'Package Validation' },
  ];
}

// ─── Classificação canônica dos elos (FASE 6 / 2026-10-16) ───────────────────
//
// PROBLEMA REAL (medido 2026-10-16): a cadeia tratava como equivalentes elos de
// naturezas opostas — o ZIP/manifesto/engine (fontes CANÔNICAS, imutáveis depois
// do selo) e relatórios DERIVADOS que a própria maquinaria de governança reescreve
// (`system:go-no-go`, `circular-projection`, `converge-governance`, validator de
// QA, materialização de proofs). Resultado: qualquer execução de governança
// quebrava 6 dos 10 elos, e o artefato continuava declarando `valid: true`.
//
// A classificação é DECLARATIVA e verificável: `escritor` é o produtor legítimo,
// `imutavelPosSelo` diz se o elo pode ser reescrito depois do selo sem exigir
// recertificação. Elo derivado reescrito NÃO invalida a evidência, mas exige nova
// certificação (nunca pode permanecer com aparência de certificado).
const CLASSIFICACAO_ELOS = {
  package:            { classe: 'CANONICO', escritor: 'scripts/release-package.sh (empacotamento)',            imutavelPosSelo: true  },
  sidecar_manifest:   { classe: 'CANONICO', escritor: 'scripts/release-package.sh (manifesto sidecar)',        imutavelPosSelo: true  },
  blocker_engine:     { classe: 'CANONICO', escritor: 'versionado em git (fonte)',                             imutavelPosSelo: true  },
  evidence_manifest:  { classe: 'DERIVADO', escritor: 'governance/package-validator.js + tools/system',        imutavelPosSelo: false },
  final_proof_report: { classe: 'DERIVADO', escritor: 'governance/circular-projection.js + system:go-no-go',   imutavelPosSelo: false },
  final_readiness:    { classe: 'DERIVADO', escritor: 'governance/circular-projection.js + system:go-no-go',   imutavelPosSelo: false },
  consistency_report: { classe: 'DERIVADO', escritor: 'governance/governance-consistency-engine.js',           imutavelPosSelo: false },
  cross_report:       { classe: 'DERIVADO', escritor: 'governance/governance-consistency-engine.js',           imutavelPosSelo: false },
  proof_signature:    { classe: 'DERIVADO', escritor: 'governance/materialize-proof-artifacts.js',             imutavelPosSelo: false },
  package_validation: { classe: 'DERIVADO', escritor: 'governance/package-validator.js',                       imutavelPosSelo: false },
};

const CLASSE_DESCONHECIDA = { classe: 'DESCONHECIDA', escritor: null, imutavelPosSelo: null };

function classificarElo(id) {
  return CLASSIFICACAO_ELOS[id] || CLASSE_DESCONHECIDA;
}

// ─── Construção da cadeia ─────────────────────────────────────────────────────
function buildChain(artifact) {
  const layers     = buildChainLayers(artifact);
  const chainLinks = [];
  let prevHash     = GENESIS_HASH;
  let cumHash      = GENESIS_HASH;

  for (const layer of layers) {
    const hash = sha256File(layer.path);
    const exists = hash !== null;
    const classificacao = classificarElo(layer.id);

    // cumulativeHash = SHA256(prevCumHash + ':' + currentHash)
    const newCumHash = exists
      ? sha256String(`${cumHash}:${hash}`)
      : sha256String(`${cumHash}:missing:${layer.id}`);

    chainLinks.push({
      index:          chainLinks.length,
      id:             layer.id,
      label:          layer.label,
      path:           path.relative(ROOT, layer.path),
      existe:         exists,
      exists,
      classe:         classificacao.classe,
      escritor:       classificacao.escritor,
      imutavelPosSelo: classificacao.imutavelPosSelo,
      hash:           hash || null,
      previousHash:   prevHash,
      cumulativeHash: newCumHash,
      timestamp:      new Date().toISOString(),
    });

    prevHash = hash || `missing:${layer.id}`;
    cumHash  = newCumHash;
  }

  const chainRoot     = cumHash;
  const completeChain = chainLinks.every((l) => l.exists);
  const missingLayers = chainLinks.filter((l) => !l.exists).map((l) => l.id);

  return {
    generatedAt: new Date().toISOString(),
    artifact:    artifact.zip,
    gitCommit:   artifact.manifest?.git_commit || 'unknown',
    chainLength: chainLinks.length,
    chainRoot,
    completeChain,
    missingLayers,

    // DEFEITO MEDIDO (2026-10-16): aqui havia `valid: completeChain`. Isto é, o
    // construtor rotulava "CADEIA VÁLIDA" a partir de uma medição de EXISTÊNCIA,
    // sem recalcular um único hash — e o rótulo era persistido em disco e LIDO
    // como veredito por `validate-self-proving` (PASS no agregado) enquanto o
    // mesmo artefato tinha 9 divergências reais. `valid` agora só é `true` depois
    // de `certifyChain()`/`verifyChain()` recalcular e aprovar; o build declara
    // explicitamente que NÃO verificou.
    valid:        false,
    verification: 'NAO_VERIFICADA_PELO_BUILD',
    certification: null,
    links:        chainLinks,
  };
}

// ─── Certificação (recalcula e grava o veredito MEDIDO) ───────────────────────
/**
 * Recalcula os hashes dos elos a partir dos artefatos em disco e grava o
 * veredito medido no próprio artefato.
 *
 * `valid: true` só é gravado quando a recalculação aprova. Caso contrário o
 * artefato passa a declarar `DIVERGENTE` com a lista de divergências — de modo
 * que ele nunca mantenha aparência de válido depois de um elo ser alterado.
 */
function certifyChain(chain, opcoes = {}) {
  const { origem = 'nao-informada', agora = new Date().toISOString() } = opcoes;
  const resultado  = verifyChain(chain);
  const certificada = resultado.valid === true;

  chain.valid        = certificada;
  chain.verification = certificada ? 'RECALCULADA_INTEGRA' : 'RECALCULADA_DIVERGENTE';
  chain.certification = {
    state:        certificada ? 'CERTIFICADA' : 'DIVERGENTE',
    origem,
    checkedAt:    agora,
    certifiedAt:  certificada ? agora : null,
    chainRoot:    chain.chainRoot,
    computedRoot: resultado.computedRoot,
    checkedLinks: resultado.checkedLinks,
    divergencias: (resultado.failures || []).map((f) => ({
      id: f.id, reason: f.reason, path: f.path || null,
    })),
  };

  return Object.assign({}, resultado, { certificada, chain });
}

// ─── Estado da cadeia: aparência x realidade (FASE 6) ────────────────────────
/**
 * Compara o veredito DECLARADO no artefato com a realidade MEDIDA nos arquivos.
 *
 * Implementa a regra canônica: "uma cadeia certificada nunca permaneça com
 * aparência de válida após a alteração de qualquer elemento obrigatório".
 *
 * Motivos de FAIL (nunca rebaixados para aviso):
 *  - CADEIA_DIVERGENTE                    — recalculação encontra divergências;
 *  - AUTO_DECLARACAO_DE_VALIDADE_FALSA    — artefato se declara válido/certificado
 *                                           e a recalculação o contradiz;
 *  - AUTO_DECLARACAO_DE_VALIDADE_SEM_CERTIFICACAO — declara validade, mas não
 *                                           declara quem/quando certificou;
 *  - CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA — elo gravado DEPOIS da certificação
 *                                           (a cadeia aparenta estar certificada
 *                                           sobre um conteúdo que já não é o dela).
 */
function avaliarEstadoDaCadeia(chain, opcoes = {}) {
  const lerMtime = opcoes.lerMtime || ((rel) => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? fs.statSync(abs).mtimeMs : null;
  });

  const recalc = verifyChain(chain);
  const motivos = [];

  if (!recalc.valid) {
    motivos.push({
      code: 'CADEIA_DIVERGENTE',
      message: `${recalc.failures.length} divergência(s): ${recalc.failures.map((f) => `${f.id}:${f.reason}`).join(', ')}`,
      divergencias: recalc.failures,
    });
  }

  const declaraValidade = chain.valid === true || chain.chainValid === true
    || (chain.certification && chain.certification.state === 'CERTIFICADA');
  const temCertificacao = !!(chain.certification && chain.certification.state);

  let autoDeclaracao = 'AUSENTE';
  if (declaraValidade) {
    if (!recalc.valid) {
      autoDeclaracao = 'FALSA';
      motivos.push({
        code: 'AUTO_DECLARACAO_DE_VALIDADE_FALSA',
        message: `artefato declara validade (valid=${chain.valid}, estado=${chain.certification ? chain.certification.state : 'sem certification'}) mas a recalculação encontrou ${recalc.failures.length} divergência(s)`,
      });
    } else if (!temCertificacao) {
      autoDeclaracao = 'SEM_CERTIFICACAO';
      motivos.push({
        code: 'AUTO_DECLARACAO_DE_VALIDADE_SEM_CERTIFICACAO',
        message: 'artefato declara validade sem declarar certificação (quem/quando certificou) — declaração não auditável',
      });
    } else {
      autoDeclaracao = 'VALIDA';
    }
  }

  // Escritas posteriores à certificação: a aparência de certificado sobreviveu
  // à alteração de conteúdo que a invalidou.
  const referenciaMs = chain.certification && (chain.certification.checkedAt || chain.certification.certifiedAt)
    ? Date.parse(chain.certification.checkedAt || chain.certification.certifiedAt)
    : (chain.generatedAt ? Date.parse(chain.generatedAt) : null);

  const escritasPosteriores = { ids: [], detalhes: [] };
  if (Number.isFinite(referenciaMs)) {
    for (const link of chain.links || []) {
      const ms = lerMtime(link.path);
      if (ms === null || ms === undefined) continue;
      if (ms > referenciaMs) {
        escritasPosteriores.ids.push(link.id);
        escritasPosteriores.detalhes.push({
          id: link.id,
          classe: link.classe || null,
          path: link.path,
          segundosDepois: Math.round((ms - referenciaMs) / 1000),
        });
      }
    }
  }

  if (escritasPosteriores.ids.length > 0) {
    motivos.push({
      code: 'CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA',
      message: `${escritasPosteriores.ids.length} elo(s) gravado(s) depois da referência de certificação: ${escritasPosteriores.ids.join(', ')}`,
      detalhes: escritasPosteriores.detalhes,
    });
  }

  return {
    status: motivos.length === 0 ? 'PASS' : 'FAIL',
    recalc,
    recalculadaIntegra: recalc.valid === true,
    autoDeclaracao,
    temCertificacao,
    declaracaoReferenciaMs: Number.isFinite(referenciaMs) ? referenciaMs : null,
    escritasPosteriores,
    classes: (chain.links || []).reduce((acc, l) => {
      const c = l.classe || 'DESCONHECIDA';
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {}),
    motivos,
    codes: motivos.map((m) => m.code),
  };
}

function elosPorClasse(chain, classe) {
  return (chain.links || []).filter((l) => (l.classe || 'DESCONHECIDA') === classe).map((l) => l.id);
}

// ─── Verificação da cadeia existente ──────────────────────────────────────────
function verifyChain(storedChain) {
  if (!storedChain || !Array.isArray(storedChain.links)) {
    return { valid: false, error: 'chain_missing_or_malformed' };
  }

  const failures = [];
  let prevHash = GENESIS_HASH;
  let cumHash  = GENESIS_HASH;

  for (const link of storedChain.links) {
    let abs = path.join(ROOT, link.path);

    // Suportar nova estrutura normalizada: dist/release/ e dist/governance/ e dist/signatures/
    // Se o arquivo não existe no caminho original, tentar caminhos alternativos
    if (!fs.existsSync(abs)) {
      const base = path.basename(link.path);
      const alternatives = [
        path.join(ROOT, 'dist', 'release', base),       // dist/release/<zip|manifest>
        path.join(ROOT, 'dist', 'governance', base),    // dist/governance/<json>
        path.join(ROOT, 'dist', 'signatures', base),    // dist/signatures/<sig>
      ];
      for (const alt of alternatives) {
        if (fs.existsSync(alt)) { abs = alt; break; }
      }
    }

    const currentHash  = sha256File(abs);
    const exists       = currentHash !== null;

    // Verificar hash individual
    if (link.exists && exists && currentHash !== link.hash) {
      failures.push({
        id:       link.id,
        reason:   'hash_mismatch',
        expected: link.hash,
        actual:   currentHash,
        path:     link.path,
      });
    } else if (link.exists && !exists) {
      failures.push({ id: link.id, reason: 'file_deleted', path: link.path });
    }

    // Verificar hash acumulativo
    const expectedCum = exists
      ? sha256String(`${cumHash}:${currentHash}`)
      : sha256String(`${cumHash}:missing:${link.id}`);

    if (expectedCum !== link.cumulativeHash) {
      if (!failures.find((f) => f.id === link.id)) {
        failures.push({
          id:       link.id,
          reason:   'cumulative_hash_broken',
          expected: link.cumulativeHash,
          actual:   expectedCum,
        });
      }
    }

    prevHash = currentHash || `missing:${link.id}`;
    cumHash  = exists
      ? sha256String(`${cumHash}:${currentHash}`)
      : sha256String(`${cumHash}:missing:${link.id}`);
  }

  // Verificar chainRoot
  const chainRootValid = cumHash === storedChain.chainRoot;
  if (!chainRootValid) {
    failures.push({
      id:       'chain_root',
      reason:   'chain_root_mismatch',
      expected: storedChain.chainRoot,
      actual:   cumHash,
    });
  }

  return {
    valid:           failures.length === 0,
    chainRootValid,
    tampered:        failures.length > 0,
    failures,
    checkedLinks:    storedChain.links.length,
    storedChainRoot: storedChain.chainRoot,
    computedRoot:    cumHash,
  };
}

function loadChain() {
  if (!fs.existsSync(CHAIN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHAIN_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeChain(chain) {
  fs.mkdirSync(path.dirname(CHAIN_PATH), { recursive: true });
  fs.writeFileSync(CHAIN_PATH, `${JSON.stringify(chain, null, 2)}\n`, 'utf8');
}

module.exports = {
  GENESIS_HASH,
  CLASSIFICACAO_ELOS,
  classificarElo,
  elosPorClasse,
  sha256File,
  sha256String,
  buildChain,
  certifyChain,
  avaliarEstadoDaCadeia,
  verifyChain,
  loadChain,
  writeChain,
  resolveArtifact,
};

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const verify = process.argv.includes('--verify');

  if (verify) {
    const stored = loadChain();
    if (!stored) {
      // eslint-disable-next-line no-console
      console.error('[governance-chain] Cadeia não encontrada. Execute sem --verify primeiro.');
      process.exit(1);
    }
    const result = verifyChain(stored);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
  }

  const artifact = resolveArtifact();
  const chain    = buildChain(artifact);
  writeChain(chain);
  // Exit code continua ligado a COMPLETUDE (o build não é verificação, e alterar
  // isto quebraria o empacotamento que só quer saber se todas as camadas existem).
  // O que muda é o rótulo: o artefato não declara mais validade que não mediu.
  // eslint-disable-next-line no-console
  console.log(
    `[governance-chain] chainRoot=${chain.chainRoot.slice(0, 16)}… ` +
    `completa=${chain.completeChain} valid=NAO_VERIFICADA (build não verifica; use --verify) links=${chain.chainLength}`
  );
  process.exit(chain.completeChain ? 0 : 1);
}
