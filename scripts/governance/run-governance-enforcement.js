#!/usr/bin/env node
'use strict';

/**
 * GATE AGREGADO COM VEREDITO PRÓPRIO (P1 — HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO).
 *
 * DEFEITO MEDIDO
 * --------------
 * `npm run validate:governance-enforcement` era uma cadeia `&&` do npm: o único
 * registro do resultado era o exit code do processo que a invocou. Nada no disco
 * dizia "o gate agregado do run X, sobre o commit Y, com o fingerprint Z, passou
 * (ou falhou) em N passos, e falhou no passo W". Um veredito sem registro próprio
 * não é auditável: quem lê o repositório (ou o auditor externo que só vê git) não
 * consegue distinguir "nunca rodou" de "rodou e passou" nem de "rodou e falhou".
 *
 * O QUE ESTE WRAPPER FAZ
 * ----------------------
 * - executa a MESMA cadeia (lida de `validate:governance-enforcement:chain` em
 *   package.json — uma única fonte, sem lista duplicada);
 * - preserva fail-fast: para no primeiro passo que falhar (mesmo comportamento);
 * - propaga o exit code real (0 só se TODOS passarem);
 * - grava `reports/governance-enforcement-verdict.json` com identidade do run
 *   (runId/sourceCommit/sourceFingerprint), lista de passos com exit code,
 *   duração e sha256 da saída, e o veredito final.
 *
 * FAIL-CLOSED: sem identidade de run completa o veredito é `BLOCKED`, nunca PASS.
 *
 * Uso:
 *   node scripts/governance/run-governance-enforcement.js [--json] [--out <path>]
 *                                                          [--somente-passos]
 */

const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SAIDA_PADRAO = path.join(ROOT, 'reports', 'governance-enforcement-verdict.json');

/**
 * CONTRATO DO GATE AGREGADO (defeitos P0 medidos em 2026-10-19 contra `9758f828f`).
 *
 * 1) CADEIA VAZIA DAVA PASS: `passos.length === cadeia.length` (0 === 0) e
 *    `[].every(...) === true` ⇒ `todosPassaram = true`. Um gate sem nenhum passo
 *    se declarava aprovado.
 * 2) AUTORIZAÇÃO TARDIA: a identidade era checada, mas TODOS os executores
 *    rodavam antes de qualquer decisão; o status virava BLOCKED depois do fato.
 *    A ordem correta é: identidade → autorização → escopo → cadeia → executar →
 *    verificar evidências → decidir.
 * 3) Sem conjunto obrigatório de passos: uma cadeia reduzida (ou editada para
 *    pular gates) continuaria "verde".
 *
 * Regra: nenhum executor é chamado antes de identidade e autorização válidas, e
 * a decisão PASS exige cadeia não vazia, sem duplicatas, contendo TODOS os
 * passos obrigatórios, cada um com exit 0 e digest de saída.
 */
const PASSOS_OBRIGATORIOS = Object.freeze([
  'npm run validate:ai-memory',
  'npm run validate:release-dag',
  'npm run validate:release-artifact-identity',
  'npm run validate:route-mounts',
  'npm run validate:runtime',
  'npm run validate:qa-governance',
  'npm run validate:replay-governance',
  'npm run validate:release-governance',
  'npm run validate:dist',
  'npm run validate:self-proving',
  'npm run validate:governance-summary',
  'npm run validate:bug-closure-status',
  'npm run validate:hardening-queue',
]);

const ETAPAS = Object.freeze(['IDENTIDADE', 'AUTORIZACAO', 'ESCOPO', 'CADEIA', 'EXECUCAO', 'EVIDENCIAS', 'DECISAO']);

/** Operação de elegibilidade que governa o gate agregado (é o SELO final). */
function avaliarAutorizacao(id) {
  try {
    const { evaluateExecutionEligibility, OPERACOES } = require('../../governance/bug-closure/eligibility');
    const { carregarInventario } = require('../../governance/bug-closure/defect-registry');
    const inventario = carregarInventario({});
    const decisao = evaluateExecutionEligibility(
      {
        commit: id.sourceCommit,
        actor: { id: 'scripts/governance/run-governance-enforcement.js', kind: 'runner' },
        defects: inventario.defeitos || [],
      },
      OPERACOES.SELO_FINAL,
    );
    return {
      operacao: OPERACOES.SELO_FINAL,
      allowed: Boolean(decisao.allowed),
      decision: decisao.decision,
      reasonCodes: decisao.reasonCodes || [],
      requiredActions: decisao.requiredActions || [],
    };
  } catch (err) {
    // Fail-closed: sem conseguir avaliar elegibilidade, não há autorização.
    return {
      operacao: 'SELO_FINAL',
      allowed: false,
      decision: 'BLOQUEADO_POR_FALHA_NA_AVALIACAO',
      reasonCodes: ['AUTORIZACAO_INDISPONIVEL'],
      requiredActions: [],
      erro: err && err.message ? err.message : String(err),
    };
  }
}

/** Escopo da cadeia: não vazia, sem duplicatas, com todos os passos obrigatórios. */
function validarEscopo(cadeia) {
  const problemas = [];
  if (!Array.isArray(cadeia) || cadeia.length === 0) problemas.push('CADEIA_VAZIA');
  const itens = Array.isArray(cadeia) ? cadeia : [];
  const duplicados = itens.filter((c, i) => itens.indexOf(c) !== i);
  if (duplicados.length > 0) problemas.push(`PASSO_DUPLICADO:${[...new Set(duplicados)].join(',')}`);
  const ausentes = PASSOS_OBRIGATORIOS.filter((c) => !itens.includes(c));
  if (ausentes.length > 0) problemas.push(`PASSO_OBRIGATORIO_AUSENTE:${ausentes.join(',')}`);
  return { ok: problemas.length === 0, problemas, ausentes, duplicados: [...new Set(duplicados)] };
}

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

function lerCadeia() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const bruta = pkg.scripts['validate:governance-enforcement:chain'];
  if (!bruta) {
    const erro = new Error('CHAIN_SCRIPT_AUSENTE: package.json sem validate:governance-enforcement:chain');
    erro.code = 'CHAIN_SCRIPT_AUSENTE';
    throw erro;
  }
  return bruta.split('&&').map((s) => s.trim()).filter(Boolean);
}

function identidade() {
  const ler = (k) => (process.env[k] && String(process.env[k]).trim()) || null;
  let commit = ler('GOVERNANCE_SOURCE_COMMIT');
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (_) { commit = null; }
  }
  return {
    runId: ler('GOVERNANCE_RUN_ID'),
    sourceFingerprint: ler('GOVERNANCE_SOURCE_FINGERPRINT'),
    sourceCommit: commit,
    sourceTree: ler('GOVERNANCE_SOURCE_TREE'),
  };
}

function identidadeCompleta(id) {
  const faltantes = [];
  if (!id.runId) faltantes.push('runId');
  if (!id.sourceFingerprint) faltantes.push('sourceFingerprint');
  if (!id.sourceCommit || !/^[0-9a-f]{40}$/i.test(String(id.sourceCommit))) faltantes.push('sourceCommit');
  return { completa: faltantes.length === 0, faltantes };
}

/**
 * Executa a cadeia e devolve o veredito (sem I/O de disco além dos subprocessos).
 * @param {{cadeia?: string[], executor?: Function, id?: object}} [opcoes]
 */
function executarCadeia(opcoes = {}) {
  const cadeia = opcoes.cadeia || lerCadeia();
  const id = opcoes.id || identidade();
  const executor = opcoes.executor || ((comando) => {
    const inicio = Date.now();
    const r = spawnSync(comando, {
      cwd: ROOT, encoding: 'utf8', shell: true, env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const saida = `${r.stdout || ''}${r.stderr || ''}`;
    return {
      exitCode: r.status === null ? null : r.status,
      duracaoMs: Date.now() - inicio,
      sha256Saida: sha256(saida),
      saidaFinal: saida.trim().split('\n').slice(-6).join('\n'),
    };
  });

  const etapas = [{ etapa: 'IDENTIDADE', iniciadaEm: new Date().toISOString() }];
  const idCheck = identidadeCompleta(id);

  // ── 1) IDENTIDADE — nada executa sem ela ────────────────────────────────
  if (!idCheck.completa) {
    etapas[0].resultado = 'BLOQUEADO';
    return montarVeredito({
      status: 'BLOCKED', motivo: `identidade de run incompleta (${idCheck.faltantes.join(',')}) — veredito não é certificável`,
      id, idCheck, cadeia, passos: [], etapas, interrompidoEm: null,
      autorizacao: null, escopo: null, evidencia: null,
    });
  }

  // ── 2) AUTORIZAÇÃO — nenhum executor antes disto ────────────────────────
  const autorizacao = opcoes.autorizacao || avaliarAutorizacao(id);
  etapas.push({ etapa: 'AUTORIZACAO', iniciadaEm: new Date().toISOString(), resultado: autorizacao.allowed ? 'AUTORIZADO' : 'NEGADO', decisao: autorizacao.decision, motivos: autorizacao.reasonCodes });
  etapas[0].resultado = 'OK';
  if (!autorizacao.allowed) {
    return montarVeredito({
      status: 'BLOCKED',
      motivo: `autorização negada (${autorizacao.decision}${autorizacao.reasonCodes.length ? `: ${autorizacao.reasonCodes.join(',')}` : ''}) — nenhum passo foi executado`,
      id, idCheck, cadeia, passos: [], etapas, interrompidoEm: null,
      autorizacao, escopo: null, evidencia: null,
    });
  }

  // ── 3) ESCOPO — cadeia não vazia, sem duplicatas, com os obrigatórios ───
  const escopo = validarEscopo(cadeia);
  etapas.push({ etapa: 'ESCOPO', iniciadaEm: new Date().toISOString(), resultado: escopo.ok ? 'OK' : 'INVALIDO', problemas: escopo.problemas });
  if (!escopo.ok) {
    return montarVeredito({
      status: 'BLOCKED', motivo: `escopo da cadeia inválido (${escopo.problemas.join('; ')}) — nenhum passo foi executado`,
      id, idCheck, cadeia, passos: [], etapas, interrompidoEm: null,
      autorizacao, escopo, evidencia: null,
    });
  }

  // ── 4) CADEIA + 5) EXECUÇÃO (fail-fast) ─────────────────────────────────
  etapas.push({ etapa: 'CADEIA', iniciadaEm: new Date().toISOString(), resultado: 'OK', totalPassos: cadeia.length });
  const passos = [];
  let interrompidoEm = null;

  for (const comando of cadeia) {
    const resultado = executor(comando);
    passos.push({ comando, ...resultado });
    const falhou = resultado.exitCode === null || resultado.exitCode !== 0;
    if (falhou) {
      interrompidoEm = comando;
      break; // fail-fast: mesmo comportamento da cadeia `&&`
    }
  }
  etapas.push({ etapa: 'EXECUCAO', iniciadaEm: new Date().toISOString(), resultado: interrompidoEm ? 'INTERROMPIDA' : 'CONCLUIDA', passosExecutados: passos.length });

  // ── 6) EVIDÊNCIAS — exit 0 E digest de saída por passo ──────────────────
  const semEvidencia = passos.filter((p) => !/^[0-9a-f]{64}$/i.test(String(p.sha256Saida || '')));
  const evidencia = {
    ok: semEvidencia.length === 0,
    semDigest: semEvidencia.map((p) => p.comando),
    todosExecutados: passos.length === cadeia.length,
  };
  etapas.push({ etapa: 'EVIDENCIAS', iniciadaEm: new Date().toISOString(), resultado: evidencia.ok ? 'OK' : 'AUSENTE', semDigest: evidencia.semDigest });

  // ── 7) DECISÃO ──────────────────────────────────────────────────────────
  const todosPassaram = passos.length === cadeia.length
    && passos.every((p) => p.exitCode === 0)
    && evidencia.ok;

  let status;
  let motivo = null;
  if (todosPassaram) status = 'PASS';
  else if (interrompidoEm) { status = 'FAIL'; motivo = `passo falhou: ${interrompidoEm}`; }
  else if (!evidencia.ok) { status = 'FAIL'; motivo = `passo sem evidência (digest ausente): ${evidencia.semDigest.join(',')}`; }
  else { status = 'FAIL'; motivo = `cadeia incompleta: ${passos.length}/${cadeia.length} passos`; }

  etapas.push({ etapa: 'DECISAO', iniciadaEm: new Date().toISOString(), resultado: status });

  return montarVeredito({
    status, motivo, id, idCheck, cadeia, passos, etapas, interrompidoEm,
    autorizacao, escopo, evidencia,
  });
}

/** Monta o veredito auditável (identidade, etapas, passos, evidência). */
function montarVeredito({ status, motivo, id, idCheck, cadeia, passos, etapas, interrompidoEm, autorizacao, escopo, evidencia }) {
  return {
    schemaVersion: 2,
    kind: 'governance-enforcement-verdict',
    generatedAt: new Date().toISOString(),
    status,
    identidade: id,
    identidadeFaltantes: idCheck ? idCheck.faltantes : [],
    autorizacao,
    escopo,
    evidencia,
    etapas,
    totalPassos: (cadeia || []).length,
    passosExecutados: (passos || []).length,
    interrompidoEm,
    passos: passos || [],
    // PASS só com identidade completa + autorização + escopo + 100% dos passos verdes com digest.
    motivo: status === 'PASS' ? null : motivo,
  };
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const somente = argv.includes('--somente-passos');
  const iOut = argv.indexOf('--out');
  const saida = iOut >= 0 ? path.resolve(ROOT, argv[iOut + 1]) : SAIDA_PADRAO;

  const veredito = executarCadeia();

  if (!somente) {
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    fs.writeFileSync(saida, `${JSON.stringify(veredito, null, 2)}\n`, 'utf8');
  }

  if (json) process.stdout.write(`${JSON.stringify(veredito, null, 2)}\n`);
  else {
    process.stdout.write(
      `[agg] status=${veredito.status} passos=${veredito.passosExecutados}/${veredito.totalPassos}`
      + `${veredito.interrompidoEm ? ` interrompido=${veredito.interrompidoEm}` : ''}\n`
    );
    if (veredito.motivo) process.stdout.write(`[agg] motivo: ${veredito.motivo}\n`);
    process.stdout.write(`[agg] veredito: ${path.relative(ROOT, saida)}\n`);
  }

  return veredito.status === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main, executarCadeia, lerCadeia, identidadeCompleta,
  validarEscopo, avaliarAutorizacao, PASSOS_OBRIGATORIOS, ETAPAS,
};
