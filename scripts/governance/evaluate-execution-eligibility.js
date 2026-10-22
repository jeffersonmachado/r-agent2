#!/usr/bin/env node
'use strict';

/**
 * GATE CENTRAL DE ELEGIBILIDADE — CLI (Bug Closure First).
 *
 * Qualquer orquestrador (selo, converge, waves, mesh, replay, pacote) deve chamar
 * este comando ANTES de começar. Exit 0 = autorizado; exit 1 = recusado.
 *
 * Uso:
 *   node scripts/governance/evaluate-execution-eligibility.js --operation QA_WAVES_COMPLETA --actor converge
 *   node scripts/governance/evaluate-execution-eligibility.js --operation CORRECAO_CODIGO --json
 *
 * Códigos de saída:
 *   0 autorizado
 *   1 recusado (fail-closed)
 *   2 erro de uso/ambiente (inventário ilegível etc.)
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const { evaluateExecutionEligibility, OPERACOES } = require(path.join(ROOT, 'governance', 'bug-closure', 'eligibility'));
const { carregarInventario } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-registry'));
const { registrarAuditoria, CATALOGO_OPERACOES } = require(path.join(ROOT, 'governance', 'bug-closure', 'execution-budget'));

function arg(argv, nome, curto) {
  const i = argv.findIndex((a) => a === nome || (curto && a === curto));
  return i >= 0 ? argv[i + 1] : null;
}

function shaHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return null;
  }
}

function main(argv = process.argv.slice(2)) {
  const operacao = arg(argv, '--operation', '-o');
  const json = argv.includes('--json');
  const commit = arg(argv, '--commit') || shaHead();
  const actor = arg(argv, '--actor') || 'cli';
  const certificacao = arg(argv, '--certification');
  const queuePath = arg(argv, '--queue');
  // Escopo da missão: ids de defeitos em correção (a condicional de L0/L1 olha
  // só para eles). Sem escopo, a condicional olha todos os abertos — o default é
  // o mais rígido.
  const escopoBruto = arg(argv, '--scope');
  const activeDefectIds = escopoBruto
    ? String(escopoBruto).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  if (!operacao) {
    process.stderr.write(
      `[eligibility] uso: --operation <${Object.keys(OPERACOES).join('|')}>\n`
    );
    return 2;
  }

  // Achado do revisor (2ª passada, P1): `--queue` era um bypass de UM argumento — apontar o
  // gate para `{"items":[]}` concedia SELO_FINAL. O caminho explícito segue as MESMAS regras
  // do override de ambiente: contexto de teste + fixture versionado em `tests/fixtures/`.
  if (queuePath) {
    const raizRepo = path.resolve(__dirname, '..', '..');
    const rel = path.relative(raizRepo, path.resolve(queuePath)).split(path.sep).join('/');
    const ambienteDeTeste = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    if (!ambienteDeTeste || !rel.startsWith('tests/fixtures/')) {
      process.stderr.write(
        `[eligibility] RECUSADO (QUEUE_OVERRIDE_RECUSADO): --queue só é aceito em contexto de teste `
        + `apontando para fixture versionado em tests/fixtures/ (recebido: ${rel || queuePath})\n`,
      );
      return 2;
    }
  }

  let inventario;
  try {
    inventario = carregarInventario(queuePath ? { queuePath } : {});
  } catch (erro) {
    // Fail-closed: inventário desconhecido NUNCA vira "sem defeitos".
    const saida = {
      allowed: false,
      decision: 'DENIED',
      operation: operacao,
      reasonCodes: [erro.code || 'INVENTARIO_INDISPONIVEL'],
      blockingFindings: [{ code: erro.code || 'INVENTARIO_INDISPONIVEL', detail: erro.message }],
      requiredActions: ['restaurar o inventário oficial (AI_MEMORY/hardening-queue.json)'],
      evaluatedCommit: commit,
    };
    registrarAuditoria({ tipo: 'eligibility', ...saida });
    process.stderr.write(`[eligibility] RECUSADO (inventário indisponível): ${erro.message}\n`);
    if (json) process.stdout.write(`${JSON.stringify(saida, null, 2)}\n`);
    return 2;
  }

  const decisao = evaluateExecutionEligibility(
    {
      commit,
      actor: { id: actor },
      defects: inventario.defeitos,
      activeDefectIds,
      diagnosticPurpose: argv.includes('--diagnostic'),
      certification: certificacao || undefined,
      environment: process.env.NODE_ENV || 'development',
    },
    operacao
  );

  const completa = {
    ...decisao,
    catalogo: CATALOGO_OPERACOES[decisao.operation] || null,
    inventarioResumo: inventario.resumo,
  };

  let destinoAuditoria = null;
  try {
    destinoAuditoria = registrarAuditoria({ tipo: 'eligibility', ...completa });
  } catch (_) {
    // Auditoria indisponível não pode autorizar operação crítica em silêncio.
    completa.allowed = false;
    completa.decision = 'DENIED';
    completa.reasonCodes = [...(completa.reasonCodes || []), 'AUDITORIA_INDISPONIVEL'];
    completa.blockingFindings = [...(completa.blockingFindings || []), { code: 'AUDITORIA_INDISPONIVEL' }];
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...completa, auditPath: destinoAuditoria }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[eligibility] ${completa.decision} op=${completa.operation} commit=${String(completa.evaluatedCommit || '').slice(0, 10)} ` +
      `p0=${inventario.resumo.porSeveridade.P0 || 0} p1=${inventario.resumo.porSeveridade.P1 || 0} ` +
      `abertos=${inventario.resumo.abertos} bloqueantes=${inventario.resumo.bloqueantesParaCertificacao}\n`
    );
    if (completa.reasonCodes.length) process.stdout.write(`  razões: ${completa.reasonCodes.join(', ')}\n`);
    for (const f of (completa.blockingFindings || []).slice(0, 8)) {
      process.stdout.write(`  - ${f.code}${f.defectId ? ` (${f.defectId})` : ''}${f.detail ? `: ${f.detail}` : ''}\n`);
    }
    if ((completa.requiredActions || []).length) {
      process.stdout.write('  ações exigidas:\n');
      for (const a of completa.requiredActions) process.stdout.write(`    · ${a}\n`);
    }
    if (destinoAuditoria) process.stdout.write(`  auditoria: ${destinoAuditoria}\n`);
  }

  return completa.allowed ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
