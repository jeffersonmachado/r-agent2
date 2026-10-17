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
 * ─── ENDURECIMENTO FASE 6 (2026-10-16) ───────────────────────────────────────
 *
 * DEFEITO MEDIDO (reproduzido antes da correção): `governance-chain.json` persistia
 * `valid: true`, `completeChain: true`, `missingLayers: []`, enquanto a recalculação
 * encontrava **9 divergências** e `computedRoot` diferente — e o gate do agregado
 * (`validate:self-proving`) aprovava lendo esse campo persistido. Isto é, a cadeia
 * mantinha APARÊNCIA de válida depois de 6 elos serem reescritos (até 9869 s após a
 * certificação) e o agregado dava PASS.
 *
 * A causa-raiz era de vocabulário: `buildChain()` gravava `valid: completeChain`,
 * ou seja, "válido" significava "todos os arquivos existem", sem recalcular hash.
 * A correção: o build não declara validade; `certifyChain()` recalcula e grava o
 * veredito medido; e este gate reprova a DIVERGÊNCIA ENTRE DECLARAÇÃO E REALIDADE,
 * não apenas a divergência de hash.
 *
 * Uso: node scripts/governance/validate-governance-chain.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { loadChain, verifyChain, avaliarEstadoDaCadeia, elosPorClasse } = require('../../governance/governance-chain');

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
    const estado    = avaliarEstadoDaCadeia(stored);
    relatorio = {
      schemaVersion: 1,
      kind: 'governance-chain',
      generatedAt: new Date().toISOString(),
      status: estado.status,
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

      // ── aparência x realidade (FASE 6) ──
      declaracaoPersistida: {
        valid: stored.valid === undefined ? null : stored.valid,
        verification: stored.verification || null,
        certificationState: stored.certification ? stored.certification.state : null,
        certifiedAt: stored.certification ? (stored.certification.certifiedAt || stored.certification.checkedAt) : null,
        origem: stored.certification ? stored.certification.origem : null,
      },
      autoDeclaracao: estado.autoDeclaracao,
      recalculadaIntegra: estado.recalculadaIntegra,
      escritasPosteriores: estado.escritasPosteriores,
      classificacaoElos: {
        contagem: estado.classes,
        canonicos: elosPorClasse(stored, 'CANONICO'),
        derivados: elosPorClasse(stored, 'DERIVADO'),
        imutaveisPosSelo: (stored.links || []).filter((l) => l.imutavelPosSelo === true).map((l) => l.id),
      },
      motivos: estado.motivos,
      codes: estado.codes,
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
    }
    if (relatorio.autoDeclaracao === 'FALSA') {
      process.stdout.write(
        '[governance-chain] AUTO_DECLARACAO_DE_VALIDADE_FALSA: o artefato se declara ' +
        `válido (valid=${relatorio.declaracaoPersistida.valid}, estado=${relatorio.declaracaoPersistida.certificationState}) ` +
        `mas a recalculação encontrou ${relatorio.failures.length} divergência(s) — aparência de válida sobre conteúdo alterado\n`
      );
    }
    if (relatorio.autoDeclaracao === 'SEM_CERTIFICACAO') {
      process.stdout.write(
        '[governance-chain] AUTO_DECLARACAO_DE_VALIDADE_SEM_CERTIFICACAO: declara validade sem declarar quem/quando certificou\n'
      );
    }
    if (relatorio.escritasPosteriores && relatorio.escritasPosteriores.ids.length) {
      process.stdout.write(
        `[governance-chain] CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA: ${relatorio.escritasPosteriores.ids.length} elo(s) gravado(s) depois da certificação\n`
      );
      relatorio.escritasPosteriores.detalhes.slice(0, 10).forEach((d) => {
        process.stdout.write(`  ${d.id} (${d.classe}) +${d.segundosDepois}s\n`);
      });
    }
    if (relatorio.classificacaoElos) {
      process.stdout.write(
        `[governance-chain] elos: canonicos=${relatorio.classificacaoElos.canonicos.length} ` +
        `derivados=${relatorio.classificacaoElos.derivados.length} ` +
        `imutaveisPosSelo=${relatorio.classificacaoElos.imutaveisPosSelo.length}\n`
      );
    }
    if (relatorio.status === 'PASS') {
      process.stdout.write('[governance-chain] PASS: cadeia recomputada confere com a persistida e a declaração é auditável\n');
    }
  }

  return relatorio.status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
