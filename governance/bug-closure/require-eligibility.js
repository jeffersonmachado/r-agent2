'use strict';

/**
 * Guarda de ENTRADA para entrypoints Node (BUG CLOSURE FIRST, 2026-10-17).
 *
 * Espelho em JS de `scripts/governance/lib/bug-closure-guard.sh`. Existe para que
 * os entrypoints Node (waves, mesh, selo V2) não precisem reimplementar a
 * leitura da fila nem a política — eles apenas perguntam e abortam.
 *
 * REGRA: processo extensivo não começa enquanto existir P0/P1 bloqueante aberto.
 * Não há variável de ambiente que desligue isto: o desvio exigiria editar código
 * versionado (visível no diff e no `sourceFingerprint`).
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const { evaluateExecutionEligibility } = require('./eligibility');
const { carregarInventario } = require('./defect-registry');

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
}

/**
 * Avalia a operação e ABORTA o processo com exit 3 quando negada.
 *
 * Exit 3 (e não 1) para distinguir "recusado por defeitos abertos" de "falhou
 * por erro de execução" — quem lê logs e pipelines precisa poder diferenciar.
 *
 * @returns {object} decisão (quando autorizado)
 */
function exigirElegibilidade(operacao, opcoes = {}) {
  const ator = opcoes.actor || path.relative(ROOT, process.argv[1] || 'desconhecido');
  const commit = opcoes.commit || headSha();

  let inventario;
  try {
    inventario = carregarInventario(opcoes.queuePath ? { queuePath: opcoes.queuePath } : undefined);
  } catch (erro) {
    // Sem inventário não há como provar ausência de defeito: fail-closed.
    process.stderr.write(
      `[bug-closure] RECUSADO: inventário de defeitos indisponível (${erro.message}).\n` +
      'Ausência de inventário NÃO é ausência de defeitos.\n'
    );
    process.exit(3);
  }

  const decisao = evaluateExecutionEligibility(
    { commit, actor: { id: ator, kind: 'entrypoint' }, defects: inventario.defeitos, activeDefectIds: opcoes.activeDefectIds },
    operacao
  );

  const rotulo = `[bug-closure] ${operacao} @ ${String(commit).slice(0, 12)}`;
  if (decisao.allowed) {
    process.stdout.write(`${rotulo}: ${decisao.decision}\n`);
    return decisao;
  }

  process.stderr.write(`${rotulo}: RECUSADO — ${decisao.reasonCodes.join(', ')}\n`);
  for (const f of (decisao.blockingFindings || []).slice(0, 15)) {
    process.stderr.write(`  - ${f.code} (${f.defectId || '?'}) ${f.detail || ''}\n`);
  }
  for (const a of decisao.requiredActions || []) {
    process.stderr.write(`  ação exigida: ${a}\n`);
  }
  process.stderr.write(
    '[bug-closure] Nenhum processo extensivo começa com P0/P1 bloqueante aberto.\n' +
    '[bug-closure] Corrija e VERIFIQUE o defeito (teste de regressão no mesmo SHA) antes de reexecutar.\n'
  );
  process.exit(3);
  return decisao; // inalcançável (process.exit) — mantido para leitura
}

module.exports = { exigirElegibilidade, headSha };
