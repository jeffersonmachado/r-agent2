'use strict';

/**
 * Gate da cadeia criptográfica de governança (MISSÃO B / B1).
 *
 * PROBLEMA REAL (medido 2026-10-14): `governance/governance-chain.js` constrói uma
 * cadeia SHA-256 encadeada (cumulativeHash + chainRoot) sobre 10 camadas de
 * artefatos e sabe se VERIFICAR (`verifyChain` recomputa os hashes dos arquivos
 * atuais e detecta `hash_mismatch`, `file_deleted`, `cumulative_hash_broken` e
 * `chain_root_mismatch`). Mas NENHUM gate a verificava:
 *
 *   - `scripts/governance/validate-self-proving.js` faz
 *     `if (!(governanceChain.valid === true || governanceChain.chainValid === true))`
 *     — isto é, **confia no campo `valid` gravado no JSON em disco**;
 *   - `verifyChain` não era chamado fora do próprio módulo;
 *   - não existia script npm com "chain" no agregado.
 *
 * Consequência: alterar um artefato e regravar `governance-chain.json` com
 * `valid: true` mantinha o self-proving verde. A "cadeia de imutabilidade" era
 * atestada, não recalculada — falso verde de segurança.
 *
 * Este gate RECALCULA. Semântica de fases (para não inventar vermelho):
 *   - cadeia ausente            -> PENDING_PHASE (exit 0; não é prova, é ausência
 *                                  legítima enquanto não há artefato selado)
 *   - cadeia presente e íntegra -> PASS (exit 0)
 *   - cadeia presente e quebrada-> FAIL (exit 1) com as failures nomeadas
 *
 * Uso: node scripts/governance/validate-governance-chain.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { loadChain, verifyChain } = require('../../governance/governance-chain');

const RAIZ = path.resolve(__dirname, '..', '..');
const RELATORIO = path.join(RAIZ, 'reports', 'governance-chain-report.json');

function main(argv = process.argv.slice(2)) {
  const stored = loadChain();

  let relatorio;
  if (!stored) {
    relatorio = {
      schemaVersion: 1,
      kind: 'governance-chain',
      generatedAt: new Date().toISOString(),
      status: 'PENDING_PHASE',
      reason: 'governance/governance-chain.json ausente — não há artefato selado para encadear',
      verified: false,
      failures: [],
    };
  } else {
    const resultado = verifyChain(stored);
    relatorio = {
      schemaVersion: 1,
      kind: 'governance-chain',
      generatedAt: new Date().toISOString(),
      status: resultado.valid ? 'PASS' : 'FAIL',
      verified: true,
      artifact: stored.artifact || null,
      gitCommit: stored.gitCommit || null,
      chainLength: stored.chainLength || (stored.links || []).length,
      storedChainRoot: resultado.storedChainRoot,
      computedRoot: resultado.computedRoot,
      chainRootValid: resultado.chainRootValid,
      tampered: resultado.tampered,
      checkedLinks: resultado.checkedLinks,
      failures: resultado.failures || [],
    };
  }

  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 1), 'utf8');

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 1)}\n`);
  } else {
    process.stdout.write(`[governance-chain] status=${relatorio.status}`);
    if (relatorio.verified) {
      process.stdout.write(
        ` links=${relatorio.checkedLinks} stored=${String(relatorio.storedChainRoot).slice(0, 12)}… ` +
          `recomputado=${String(relatorio.computedRoot).slice(0, 12)}…`
      );
    }
    process.stdout.write('\n');
    if (relatorio.failures.length) {
      process.stdout.write(`[governance-chain] FAIL: ${relatorio.failures.length} divergência(s)\n`);
      relatorio.failures.slice(0, 10).forEach((f) => {
        process.stdout.write(`  ${f.id} — ${f.reason}${f.path ? ` (${f.path})` : ''}\n`);
      });
      process.stdout.write(
        '[governance-chain] a cadeia é RECALCULADA a partir dos artefatos: divergência = artefato alterado ou chain regravada\n'
      );
    } else if (relatorio.status === 'PASS') {
      process.stdout.write('[governance-chain] PASS: cadeia recomputada confere com a persistida\n');
    } else {
      process.stdout.write(`[governance-chain] ${relatorio.reason}\n`);
    }
  }

  return relatorio.status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
