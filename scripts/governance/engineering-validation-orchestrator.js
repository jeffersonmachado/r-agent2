'use strict';

/**
 * EngineeringValidationOrchestrator — MISSÃO A.
 *
 * Encadeia os níveis de validação e decide a escalação. NÃO reimplementa nada:
 * cada nível é um mecanismo que o RAP já tinha, agora com um único ponto de
 * entrada e uma decisão auditável.
 *
 *   L1 — direcionado por impacto (scripts/governance/run-impact-validation.js)
 *        seleção por grafo de imports + jornadas; rápido; fail-closed.
 *   L2 — suíte autoritativa do manifesto canônico
 *        (npm run test:release-authoritative; ~89 suítes; valida cobertura
 *        completa do manifesto, NOT_EXECUTED incluído).
 *   L3 — validação de governança completa
 *        (npm run validate:all-validators; 60 validadores).
 *
 * Política de escalação (fail-closed, "na dúvida valide mais"):
 *   L1 VERDE  e sem escalação  -> encerra em L1.
 *   L1 ESCALATE               -> sobe para L2.
 *   L1 VERMELHO               -> para e reporta (defeito encontrado).
 *   L2 VERDE                  -> encerra em L2.
 *   L2 VERMELHO               -> para e reporta.
 *   L3 é explícito (`--level=l3`) ou vem de `--escalate-to-l3`: L3 é CARO e o
 *   prompt proíbe tratá-lo como mecanismo de descoberta de defeito. A selagem
 *   NÃO acontece aqui — este orquestrador valida, não publica.
 *
 * Exit codes:
 *   0 = verde no nível alcançado
 *   1 = vermelho (defeito real encontrado)
 *   2 = inconclusivo (nível insuficiente e não autorizado a subir)
 *   3 = erro de infraestrutura
 *
 * Uso:
 *   node scripts/governance/engineering-validation-orchestrator.js
 *        [--level=auto|l1|l2|l3] [--base=<ref>] [--files=a,b]
 *        [--escalate-to-l3] [--dry-run] [--out=<caminho>]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = path.join(RAIZ, 'reports', 'validation-orchestrator-report.json');
const REL_L1 = path.join(RAIZ, 'reports', 'impact-validation-report.json');

const EXIT = Object.freeze({ GREEN: 0, RED: 1, INCONCLUSIVE: 2, INFRA: 3 });

const NIVEIS = Object.freeze(['l1', 'l2', 'l3']);

/**
 * Executa um comando e devolve o resultado com medição de tempo.
 * @param {string} bin
 * @param {string[]} args
 * @param {object} [opts]
 * @returns {{exitCode: number|null, signal: string|null, elapsedMs: number, spawnError: string|null}}
 */
function executar(bin, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(bin, args, {
    cwd: RAIZ,
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    exitCode: r.status,
    signal: r.signal,
    elapsedMs: Date.now() - t0,
    spawnError: r.error ? r.error.message : null,
  };
}

/**
 * Nível 1 — validação direcionada por impacto.
 * @param {object} opts
 * @returns {{status: string, exitCode: number|null, elapsedMs: number, detail: object}}
 */
function nivelL1(opts) {
  const args = ['scripts/governance/run-impact-validation.js'];
  if (opts.base) args.push(`--base=${opts.base}`);
  if (opts.files) args.push(`--files=${opts.files}`);
  if (opts.dryRun) args.push('--dry-run');

  const r = executar('node', args);
  let relatorio = null;
  try {
    if (fs.existsSync(REL_L1)) relatorio = JSON.parse(fs.readFileSync(REL_L1, 'utf8'));
  } catch {
    /* relatório ilegível não invalida o exit code */
  }

  // Um L1 em dry-run NÃO executa suíte alguma: seu exit 0 significa "nada
  // rodou", não "tudo passou". Tratar como verde aqui seria o mesmo falso verde
  // que `run-release-suites.js` já corrigiu historicamente.
  const dryRun = Boolean(relatorio && relatorio.execution && relatorio.execution.dryRun);

  const status = dryRun
    ? 'SKIPPED_DRY_RUN'
    : r.exitCode === EXIT.GREEN
      ? 'GREEN'
      : r.exitCode === EXIT.RED
        ? 'RED'
        : r.exitCode === EXIT.INCONCLUSIVE
          ? 'ESCALATE'
          : 'INFRA';

  return {
    status,
    exitCode: r.exitCode,
    elapsedMs: r.elapsedMs,
    detail: {
      selectedTests: relatorio ? relatorio.selection.totalTests : null,
      changedFiles: relatorio ? relatorio.changedFiles.length : null,
      journeys: relatorio ? relatorio.selection.journeys.length : null,
      meshScenarios: relatorio ? relatorio.selection.meshScenarios.length : null,
      escalateReason: relatorio ? relatorio.decision.escalateReason : null,
      unclassified: relatorio ? relatorio.decision.unclassified : [],
      byLayer: relatorio ? relatorio.selection.byLayer : null,
    },
  };
}

/**
 * Nível 2 — suíte autoritativa do manifesto canônico.
 * @param {object} opts
 * @returns {{status: string, exitCode: number|null, elapsedMs: number, detail: object}}
 */
function nivelL2(opts) {
  if (opts.dryRun) return { status: 'SKIPPED_DRY_RUN', exitCode: null, elapsedMs: 0, detail: {} };
  const r = executar('npm', ['run', '--silent', 'test:release-authoritative'], {
    env: { RELEASE_AUTHORITATIVE: '1' },
  });
  return {
    status: r.exitCode === 0 ? 'GREEN' : r.exitCode === null ? 'INFRA' : 'RED',
    exitCode: r.exitCode,
    elapsedMs: r.elapsedMs,
    detail: { runner: 'test:release-authoritative', signal: r.signal, spawnError: r.spawnError },
  };
}

/**
 * Nível 3 — validação de governança completa.
 * @param {object} opts
 * @returns {{status: string, exitCode: number|null, elapsedMs: number, detail: object}}
 */
function nivelL3(opts) {
  if (opts.dryRun) return { status: 'SKIPPED_DRY_RUN', exitCode: null, elapsedMs: 0, detail: {} };
  const args = ['run', '--silent', 'validate:all-validators'];
  if (opts.only) args.push(`--only=${opts.only}`);
  if (opts.timeoutSeconds) args.push(`--timeout-seconds=${opts.timeoutSeconds}`);
  const r = executar('npm', args);
  return {
    status: r.exitCode === 0 ? 'GREEN' : r.exitCode === null ? 'INFRA' : 'RED',
    exitCode: r.exitCode,
    elapsedMs: r.elapsedMs,
    detail: { runner: 'validate:all-validators', signal: r.signal, spawnError: r.spawnError },
  };
}

/**
 * Decide o nível inicial a partir do resultado do L1.
 * @param {object} l1
 * @param {string} nivelPedido
 * @returns {{nivelInicial: string, motivo: string}}
 */
function decidirNivelInicial(l1, nivelPedido) {
  if (nivelPedido === 'l2' || nivelPedido === 'l3') {
    return { nivelInicial: nivelPedido, motivo: `pedido explícito (--level=${nivelPedido})` };
  }
  if (l1.status === 'GREEN') return { nivelInicial: 'l1', motivo: 'L1 verde e sem escalação' };
  if (l1.status === 'ESCALATE') return { nivelInicial: 'l2', motivo: `L1 escalou (${l1.detail.escalateReason})` };
  return { nivelInicial: 'l1', motivo: `L1 ${l1.status}` };
}

/**
 * Traduz o status de um nível para o desfecho do orquestrador.
 *
 * `SKIPPED_DRY_RUN` NUNCA pode virar verde: um nível que não executou não
 * produziu evidência. O defeito de cair no `else` e reportar GREEN sem execução
 * é o mesmo padrão de falso verde que o RAP já corrigiu em
 * `run-release-suites.js` (que "reusava QUALQUER relatório e inventava
 * exitCode: 0"). Aqui é inconclusivo por construção.
 *
 * @param {string} status
 * @param {string} nivel
 * @returns {string}
 */
function statusParaOutcome(status, nivel) {
  const n = String(nivel).toUpperCase();
  if (status === 'GREEN') return `GREEN_AT_${n}`;
  if (status === 'RED') return `RED_AT_${n}`;
  if (status === 'INFRA') return `INFRA_AT_${n}`;
  return 'INCONCLUSIVE_DRY_RUN';
}

/**
 * Executa o orquestrador.
 * @param {string[]} argv
 * @returns {number} exit code
 */
function main(argv = process.argv.slice(2)) {
  const valor = (nome, padrao = null) => {
    const comIgual = argv.find((a) => a.startsWith(`--${nome}=`));
    if (comIgual) return comIgual.slice(nome.length + 3);
    const i = argv.indexOf(`--${nome}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : padrao;
  };
  const tem = (nome) => argv.some((a) => a === `--${nome}` || a.startsWith(`--${nome}=`));

  const opts = {
    nivel: valor('level', 'auto'),
    base: valor('base', null),
    files: valor('files', null),
    only: valor('only', null),
    timeoutSeconds: valor('timeout-seconds', null),
    escalateToL3: tem('escalate-to-l3'),
    dryRun: tem('dry-run'),
  };

  const relatorio = {
    schemaVersion: 1,
    kind: 'validation-orchestrator',
    startedAt: new Date().toISOString(),
    options: opts,
    levels: {},
    decision: null,
    totalElapsedMs: 0,
  };

  // ── BUG CLOSURE FIRST (2026-10-17) ────────────────────────────────────────
  // L2/L3 são extensivos; L1 é amplo. A autorização vem ANTES de qualquer
  // execução, e `--dry-run` segue livre (planejar não executa suíte).
  if (!opts.dryRun) {
    const { exigirElegibilidade } = require('../../governance/bug-closure/require-eligibility');
    const operacao = opts.nivel === 'l2' || opts.nivel === 'l3'
      ? 'L2_L3_EXTENSIVO'
      : 'L1_AMPLO';
    exigirElegibilidade(operacao, { actor: 'scripts/governance/engineering-validation-orchestrator.js' });
  }

  const t0 = Date.now();
  process.stdout.write('[orq] nível L1 — validação direcionada por impacto\n');
  const l1 = nivelL1(opts);
  relatorio.levels.l1 = l1;
  process.stdout.write(`[orq] L1: ${l1.status} (${(l1.elapsedMs / 1000).toFixed(1)}s)\n`);

  if (l1.status === 'RED') {
    relatorio.decision = { outcome: 'RED_AT_L1', nextLevel: null, reason: 'L1 encontrou teste(s) falhando' };
  } else if (l1.status === 'INFRA') {
    relatorio.decision = { outcome: 'INFRA_AT_L1', nextLevel: null, reason: 'falha de infraestrutura no L1' };
  } else {
    const { nivelInicial, motivo } = decidirNivelInicial(l1, opts.nivel);
    let outcome = statusParaOutcome(nivelInicial === 'l1' ? l1.status : 'SKIPPED', 'l1');
    let chegou = nivelInicial === 'l1';

    if (nivelInicial === 'l2' || nivelInicial === 'l3') {
      process.stdout.write(`[orq] subindo para L2 — ${motivo}\n`);
      const l2 = nivelL2(opts);
      relatorio.levels.l2 = l2;
      process.stdout.write(`[orq] L2: ${l2.status} (${(l2.elapsedMs / 60000).toFixed(1)}min)\n`);
      chegou = true;
      outcome = statusParaOutcome(l2.status, 'l2');

      if (l2.status === 'GREEN') {
        const querL3 = opts.nivel === 'l3' || opts.escalateToL3;
        if (querL3) {
          process.stdout.write('[orq] nível L3 — validação de governança completa\n');
          const l3 = nivelL3(opts);
          relatorio.levels.l3 = l3;
          process.stdout.write(`[orq] L3: ${l3.status} (${(l3.elapsedMs / 60000).toFixed(1)}min)\n`);
          outcome = statusParaOutcome(l3.status, 'l3');
        }
      }
    }

    relatorio.decision = {
      outcome,
      nextLevel: chegou ? null : 'l2',
      reason: motivo,
      l3Requested: opts.nivel === 'l3' || opts.escalateToL3,
    };
  }

  relatorio.totalElapsedMs = Date.now() - t0;
  relatorio.finishedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(relatorio, null, 1), 'utf8');

  process.stdout.write(
    `[orq] decisão: ${relatorio.decision.outcome} — ${relatorio.decision.reason} ` +
      `(${(relatorio.totalElapsedMs / 1000).toFixed(1)}s)\n`
  );
  process.stdout.write(`[orq] relatório: ${path.relative(RAIZ, SAIDA)}\n`);

  switch (relatorio.decision.outcome) {
    case 'GREEN_AT_L1':
    case 'GREEN_AT_L2':
    case 'GREEN_AT_L3':
      return EXIT.GREEN;
    case 'RED_AT_L1':
    case 'RED_AT_L2':
    case 'RED_AT_L3':
      return EXIT.RED;
    case 'INFRA_AT_L1':
    case 'INFRA_AT_L2':
    case 'INFRA_AT_L3':
      return EXIT.INFRA;
    case 'INCONCLUSIVE_DRY_RUN':
      return EXIT.INCONCLUSIVE;
    default:
      return EXIT.INCONCLUSIVE;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, EXIT, NIVEIS, decidirNivelInicial, nivelL1, nivelL2, nivelL3 };
