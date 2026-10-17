#!/usr/bin/env node
'use strict';

/**
 * Validador do MECANISMO de Bug Closure First + estado da fila de defeitos.
 *
 * Duas funções, ambas necessárias:
 *
 * 1. PROVAR QUE O MECANISMO CONSEGUE RECUSAR (defeito "gate que não pode falhar").
 *    Um gate que nunca recusa é pior que gate nenhum: dá sensação de proteção.
 *    Aqui o próprio validador exercita o motor de elegibilidade com contextos
 *    negativos e exige DENIED. Se o motor parar de recusar, ESTE validador falha.
 *
 * 2. PUBLICAR O ESTADO REAL da fila (`reports/bug-closure-status.json`): quantos
 *    defeitos estão abertos, quantos bloqueiam certificação, quantos ainda não têm
 *    severidade classificada e quantos não têm teste de regressão identificável.
 *    Ele falha quando existe defeito bloqueante aberto — porque nesse estado a
 *    plataforma NÃO está pronta, e dizer o contrário é o falso verde que a
 *    missão manda eliminar.
 *
 * Uso:
 *   node scripts/governance/validate-bug-closure-status.js [--json] [--informative]
 *
 * `--informative`: publica o relatório e sempre sai 0 (usado em diagnóstico).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RELATORIO = path.join(ROOT, 'reports', 'bug-closure-status.json');

const {
  evaluateExecutionEligibility, OPERACOES, DECISOES,
} = require(path.join(ROOT, 'governance', 'bug-closure', 'eligibility'));
const { carregarInventario } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-registry'));
const { ESTADOS } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-states'));

/** Operações que NUNCA podem começar com P0/P1 aberto. */
const OPERACOES_CERTIFICANTES = [
  OPERACOES.QA_WAVES_COMPLETA,
  OPERACOES.CONVERGENCIA_COMPLETA,
  OPERACOES.SELO_FINAL,
  OPERACOES.REPLAY_MASSIVO,
  OPERACOES.L2_L3_EXTENSIVO,
];

/** Operações que DEVEM continuar liberadas (senão vira deadlock: ninguém corrige). */
const OPERACOES_DE_CORRECAO = [
  OPERACOES.DIAGNOSTICO,
  OPERACOES.REPRODUCAO,
  OPERACOES.CORRECAO_CODIGO,
  OPERACOES.TESTES_DIRECIONADOS,
  OPERACOES.TESTES_NEGATIVOS_REGRESSAO,
];

/** Entrypoints reais que precisam consultar a elegibilidade antes de começar. */
const GUARDAS_EXIGIDAS = Object.freeze([
  'scripts/governance/converge-governance.sh',
  'scripts/governance/seal-release.sh',
  'scripts/release-package.sh',
  'scripts/governance/engineering-router-v2-seal.js',
  'pipeline/entrypoints/runQaMesh.js',
  'scripts/governance/db-integrity-wave.js',
  'scripts/governance/api-surface-wave.js',
  'scripts/governance/page-surface-wave.js',
  'scripts/ci/dev-branch-gate.js',
]);

const COMMIT_FICTICIO = 'f'.repeat(40);
const P0_FICTICIO = { id: 'P0-MECANISMO', severity: 'P0', state: ESTADOS.REPRODUCED };
const CONTEXTO_NEGATIVO = {
  commit: COMMIT_FICTICIO,
  actor: { id: 'validate-bug-closure-status' },
  defects: [P0_FICTICIO],
};

function provarQueRecusa() {
  const falhas = [];

  for (const op of OPERACOES_CERTIFICANTES) {
    const d = evaluateExecutionEligibility(CONTEXTO_NEGATIVO, op);
    if (d.allowed !== false || d.decision !== DECISOES.DENIED) {
      falhas.push({ code: 'MECANISMO_NAO_RECUSA', operacao: op, decision: d.decision });
    }
  }

  for (const op of OPERACOES_DE_CORRECAO) {
    const d = evaluateExecutionEligibility(CONTEXTO_NEGATIVO, op);
    if (d.allowed !== true) {
      falhas.push({ code: 'MECANISMO_BLOQUEIA_CORRECAO', operacao: op, decision: d.decision });
    }
  }

  // Fail-closed: contexto incompleto nunca autoriza.
  const semSha = evaluateExecutionEligibility({ actor: { id: 'x' }, defects: [] }, OPERACOES.CORRECAO_CODIGO);
  if (semSha.allowed !== false) falhas.push({ code: 'MECANISMO_AUTORIZA_SEM_SHA' });
  const semInventario = evaluateExecutionEligibility({ commit: COMMIT_FICTICIO, actor: { id: 'x' } }, OPERACOES.CORRECAO_CODIGO);
  if (semInventario.allowed !== false) falhas.push({ code: 'MECANISMO_AUTORIZA_SEM_INVENTARIO' });
  const desconhecida = evaluateExecutionEligibility(CONTEXTO_NEGATIVO, 'OPERACAO_QUE_NAO_EXISTE');
  if (desconhecida.allowed !== false) falhas.push({ code: 'MECANISMO_AUTORIZA_OPERACAO_DESCONHECIDA' });

  return falhas;
}

function verificarGuardas() {
  return GUARDAS_EXIGIDAS.map((rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return { arquivo: rel, ok: false, motivo: 'AUSENTE' };
    const fonte = fs.readFileSync(abs, 'utf8');
    const citaElegibilidade = /bug-closure|evaluate-execution-eligibility|exigirElegibilidade/.test(fonte);
    return {
      arquivo: rel,
      ok: citaElegibilidade,
      motivo: citaElegibilidade ? 'consulta a elegibilidade' : 'NÃO consulta a elegibilidade',
    };
  });
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const informativo = argv.includes('--informative');

  const violacoes = [];

  const falhasMecanismo = provarQueRecusa();
  violacoes.push(...falhasMecanismo);

  const guardas = verificarGuardas();
  for (const g of guardas.filter((x) => !x.ok)) {
    violacoes.push({ code: 'ENTRYPOINT_SEM_GUARDA', item: g.arquivo, detail: g.motivo });
  }

  let inventario = null;
  let erroInventario = null;
  try {
    inventario = carregarInventario();
  } catch (error) {
    erroInventario = String(error.message || error);
    violacoes.push({ code: 'INVENTARIO_INDISPONIVEL', detail: erroInventario });
  }

  let resumo = null;
  const semEstadoCanonico = [];
  if (inventario) {
    for (const d of inventario.defeitos) {
      if (!Object.prototype.hasOwnProperty.call(ESTADOS, String(d.state))) {
        semEstadoCanonico.push(d.id);
      }
    }
    if (semEstadoCanonico.length) {
      violacoes.push({ code: 'ITEM_SEM_ESTADO_CANONICO', detail: semEstadoCanonico.join(',') });
    }
    const abertos = inventario.defeitos.filter((d) => d.aberto);
    const p0 = abertos.filter((d) => d.severity === 'P0');
    const p1 = abertos.filter((d) => d.severity === 'P1');
    const semSev = abertos.filter((d) => !d.severity);
    resumo = {
      total: inventario.resumo.total,
      abertos: inventario.resumo.abertos,
      bloqueantesParaCertificacao: inventario.resumo.bloqueantesParaCertificacao,
      p0Abertos: p0.length,
      p1Abertos: p1.length,
      semSeveridadeAbertos: inventario.resumo.semSeveridadeAbertos,
      bloqueioExterno: inventario.resumo.bloqueioExterno,
      riscoAceito: inventario.resumo.riscoAceito,
      porEstado: inventario.resumo.porEstado,
      porSeveridade: inventario.resumo.porSeveridade,
      idsBloqueantes: inventario.defeitos
        .filter((d) => d.bloqueanteParaCertificacao)
        .map((d) => d.id),
    };

    // Defeito bloqueante aberto = plataforma não pronta. Não é violação de
    // mecanismo: é o ESTADO medido, e o status do relatório é FAIL.
    if (p0.length > 0) {
      violacoes.push({
        code: 'P0_ABERTO',
        detail: `${p0.length} defeito(s) P0 aberto(s)`,
        ids: p0.map((d) => d.id).slice(0, 40),
      });
    }
    if (p1.length > 0) {
      violacoes.push({
        code: 'P1_BLOQUEANTE_ABERTO',
        detail: `${p1.length} defeito(s) P1 aberto(s)`,
        ids: p1.map((d) => d.id).slice(0, 40),
      });
    }
    if (resumo.semSeveridadeAbertos > 0) {
      violacoes.push({
        code: 'SEVERIDADE_NAO_CLASSIFICADA',
        detail: `${resumo.semSeveridadeAbertos} defeito(s) aberto(s) sem severidade — não é P3 por omissão e bloqueia certificação`,
        ids: semSev.map((d) => d.id).slice(0, 40),
      });
    }
  }

  const status = violacoes.length === 0 ? 'PASS' : 'FAIL';
  const relatorio = {
    schemaVersion: 1,
    kind: 'bug-closure-status',
    generatedAt: new Date().toISOString(),
    status,
    mecanismo: {
      operacoesCertificantes: OPERACOES_CERTIFICANTES,
      operacoesDeCorrecao: OPERACOES_DE_CORRECAO,
      provasDeRecusa: OPERACOES_CERTIFICANTES.length + OPERACOES_DE_CORRECAO.length + 3,
      falhas: falhasMecanismo,
    },
    guardas,
    inventario: resumo || { erro: erroInventario },
    violacoes,
  };

  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 1)}\n`, 'utf8');

  if (json) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 1)}\n`);
  } else {
    process.stdout.write(`[bug-closure-status] mecanismo: ${falhasMecanismo.length === 0 ? 'recusa como deve' : 'FALHOU'} (${relatorio.mecanismo.provasDeRecusa} provas)\n`);
    process.stdout.write(`[bug-closure-status] guardas: ${guardas.filter((g) => g.ok).length}/${guardas.length} entrypoints consultam elegibilidade\n`);
    if (resumo) {
      process.stdout.write(
        `[bug-closure-status] abertos=${resumo.abertos} (P0=${resumo.p0Abertos} P1=${resumo.p1Abertos} ` +
        `semSeveridade=${resumo.semSeveridadeAbertos} externos=${resumo.bloqueioExterno}) ` +
        `bloqueantesParaCertificacao=${resumo.bloqueantesParaCertificacao}\n`
      );
    }
    if (status === 'PASS') {
      process.stdout.write('[bug-closure-status] PASS\n');
    } else {
      process.stdout.write(`[bug-closure-status] FAIL: ${violacoes.length} motivo(s)\n`);
      for (const v of violacoes.slice(0, 6)) {
        process.stdout.write(`  ${v.code}${v.operacao ? ` (${v.operacao})` : ''} ${v.detail || ''}${v.item ? ` ${v.item}` : ''}\n`);
      }
    }
    process.stdout.write(`[bug-closure-status] relatório: reports/bug-closure-status.json\n`);
  }

  if (informativo) return 0;
  return status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, provarQueRecusa, verificarGuardas, GUARDAS_EXIGIDAS, OPERACOES_CERTIFICANTES };
