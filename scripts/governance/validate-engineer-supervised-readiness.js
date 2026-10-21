#!/usr/bin/env node
'use strict';

/**
 * validate-engineer-supervised-readiness.js — GATE EXECUTÁVEL da decisão
 * `ENGINEER_SUPERVISED_READY_GO` (missão §13).
 *
 * POR QUE EXISTE
 * --------------
 * Até aqui a decisão vivia em prosa em `ENGINEER_SUPERVISED_READINESS.md`: nada impedia alguém
 * (humano ou agente) de declarar "pronto" por narrativa. Este gate torna a decisão DERIVADA de
 * fatos medidos, e falha explicitamente quando falta prova.
 *
 * REGRAS (não negociáveis):
 *   - Nenhum check é "assumido": cada um lê um artefato real do disco/git ou mede contador.
 *   - Ausência de prova NUNCA vira PASS: é FAIL (`carried`/`missing` no relatório).
 *   - Aprovação humana NÃO pode ser simulada: exige arquivo de assinatura com campos
 *     obrigatórios e `simulated:false`. Sem ele o veredito é `PENDING_HUMAN_APPROVAL`
 *     (exit 2) — nunca GO.
 *   - `blocked_external` é reportado como impedimento declarado, mas não é "pronto".
 *
 * VEREDITOS
 * ---------
 *   ENGINEER_SUPERVISED_READY_GO   (exit 0) — todos os checks PASS **e** aprovação humana real
 *   PENDING_HUMAN_APPROVAL         (exit 2) — checks PASS, falta a assinatura humana
 *   NOT_READY                      (exit 1) — algum check bloqueante falhou
 *   INFRA_ERROR                    (exit 3) — não foi possível medir (ex.: git indisponível)
 *
 * Uso:
 *   node scripts/governance/validate-engineer-supervised-readiness.js [--json <arquivo>]
 *   ... --approval <arquivo>          # caminho explícito da assinatura humana
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

const argDe = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
};

const JSON_OUT = argDe('--json') || path.join(ROOT, 'reports', 'engineer-supervised-readiness-report.json');
const APPROVAL_PATH = argDe('--approval')
  || path.join(ROOT, 'AI_MEMORY', 'evidence', 'engineer-supervised-approval.json');

const QUEUE_PATH = path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json');
const READINESS_DOC = path.join(ROOT, 'ENGINEER_SUPERVISED_READINESS.md');
const DECISIONS_CONFIG = path.join(ROOT, 'config', 'readiness-decisions.json');

const riskAcceptance = require('../../governance/risk-acceptance');
const { DECISOES, CATEGORIAS_NAO_DISPENSAVEIS } = require('../../governance/risk-acceptance/policy');
const signature = require('../../governance/risk-acceptance/signature');

/** Estados abertos (defeito conhecido sem correção). Espelha validate-hardening-queue.js. */
const ABERTOS = new Set(['pending', 'in_progress', 'failed', 'fixed_unverified']);
const IMPEDIDOS = new Set(['blocked', 'blocked_external']);

/** Seções exigidas no relatório de readiness (prova de que o documento não foi esvaziado). */
const SECOES_OBRIGATORIAS = [
  '## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.',
];

const checks = [];

function registrar(id, { ok, bloqueante = true, detalhe, dados = null }) {
  checks.push({ id, ok: Boolean(ok), bloqueante, detalhe, ...(dados ? { dados } : {}) });
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function lerJson(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

// ── 1. Fila oficial sem item aberto ───────────────────────────────────────────────────────────
function checkFila() {
  let fila;
  try {
    fila = lerJson(QUEUE_PATH);
  } catch (err) {
    registrar('QUEUE_READABLE', { ok: false, detalhe: `fila ilegível: ${err.message}` });
    return;
  }
  const items = Array.isArray(fila.items) ? fila.items : [];
  const abertos = items.filter((i) => ABERTOS.has(String(i.status || '').toLowerCase()));
  const impedidos = items.filter((i) => IMPEDIDOS.has(String(i.status || '').toLowerCase()));

  registrar('QUEUE_READABLE', { ok: items.length > 0, detalhe: `${items.length} item(ns)` });
  registrar('QUEUE_NO_OPEN_DEFECT', {
    ok: abertos.length === 0,
    detalhe: abertos.length === 0
      ? 'nenhum item aberto (pending/in_progress/failed/fixed_unverified)'
      : `abertos: ${abertos.map((i) => `${i.id}(${i.status})`).join(', ')}`,
    dados: { abertos: abertos.map((i) => i.id) },
  });
  // Impedimento declarado deixa de ser FAIL cego: cada item precisa ser CLASSIFICADO
  // (resolvido com probe, aceito por humano assinado, ou roteado para a decisão dona).
  // A classificação é medida em `checkBloqueiosClassificados` (precisa do SHA). Aqui fica o fato.
  registrar('QUEUE_NO_BLOCKED', {
    ok: impedidos.length === 0,
    bloqueante: false,
    detalhe: impedidos.length === 0
      ? 'nenhum item blocked/blocked_external'
      : `impedidos: ${impedidos.map((i) => `${i.id}(${i.status})`).join(', ')} — classificação exigida em QUEUE_BLOCKERS_CLASSIFIED`,
    dados: { impedidos: impedidos.map((i) => i.id) },
  });
  return { impedidos };
}

/**
 * Classificação dos bloqueios em QUATRO baldes separados (missão §6), com evidência executada.
 *
 * REGRA CENTRAL: `ACCEPTED_RISK` nunca aparece como `RESOLVED_VERIFIED`. O balde decide o veredito:
 * qualquer item em BLOCKED impede GO; os demais são reportados com o motivo e o dono da decisão.
 * @param {string} sha commit medido (HEAD)
 */
function checkBloqueiosClassificados(sha) {
  const fila = lerJson(QUEUE_PATH);
  const itens = Array.isArray(fila.items) ? fila.items : [];
  const impedidos = itens.filter((i) => IMPEDIDOS.has(String(i.status || '').toLowerCase()));

  const resolucao = riskAcceptance.resolverBloqueios({
    rootDir: ROOT,
    itensBloqueados: impedidos,
    sourceCommit: sha,
    decisao: 'ENGINEER_SUPERVISED_READINESS',
  });

  const bloqueados = resolucao.baldes.BLOCKED;
  registrar('QUEUE_BLOCKERS_CLASSIFIED', {
    ok: resolucao.problemas.length === 0 && bloqueados.length === 0,
    detalhe: resolucao.problemas.length > 0
      ? `problemas: ${resolucao.problemas.join(', ')}`
      : (bloqueados.length === 0
        ? `${impedidos.length} classificado(s): ${resolucao.baldes.RESOLVED_VERIFIED.length} resolvido(s), ${resolucao.baldes.ACCEPTED_RISK.length} aceito(s), ${resolucao.baldes.NOT_APPLICABLE.length} roteado(s)`
        : `ainda bloqueiam: ${bloqueados.map((b) => `${b.riskId}[${b.motivos.join('|')}]`).join(', ')}`),
    dados: {
      RESOLVED_VERIFIED: resolucao.baldes.RESOLVED_VERIFIED.map((i) => i.riskId),
      ACCEPTED_RISK: resolucao.baldes.ACCEPTED_RISK.map((i) => i.riskId),
      NOT_APPLICABLE: resolucao.baldes.NOT_APPLICABLE.map((i) => i.riskId),
      BLOCKED: bloqueados.map((i) => i.riskId),
    },
  });

  // Categoria não dispensável não pode ter sido "resolvida" por roteamento: reprova explícito.
  const roteamento = (() => {
    try { return lerJson(riskAcceptance.ROUTING_REL); } catch (_) { return null; }
  })();
  const naoDispensaveis = [];
  for (const [riskId, rota] of Object.entries((roteamento && roteamento.items) || {})) {
    for (const cat of (rota.categories || [])) {
      if (CATEGORIAS_NAO_DISPENSAVEIS.includes(cat)) naoDispensaveis.push(`${riskId}:${cat}`);
    }
  }
  registrar('NON_WAIVABLE_ABSENT', {
    ok: naoDispensaveis.length === 0,
    detalhe: naoDispensaveis.length === 0
      ? 'nenhuma categoria não dispensável declarada no roteamento'
      : `categorias não dispensáveis: ${naoDispensaveis.join(', ')}`,
    dados: { naoDispensaveis },
  });

  return { baldes: resolucao.baldes, problemas: resolucao.problemas };
}

/**
 * As três decisões existem, com escopo e validadores REAIS no disco (missão §5).
 * Não cria caminho paralelo: só confere que o que a decisão cita existe.
 */
function checkDecisoesSeparadas() {
  let cfg;
  try { cfg = lerJson(DECISIONS_CONFIG); } catch (err) {
    registrar('READINESS_DECISIONS_PRESENT', { ok: false, detalhe: `config ausente/ilegível: ${err.message}` });
    return;
  }
  const decisoes = Array.isArray(cfg.decisions) ? cfg.decisions : [];
  const ids = decisoes.map((d) => d.id);
  const esperados = Object.keys(DECISOES);
  const faltando = esperados.filter((id) => !ids.includes(id));
  const validadoresFantasma = [];
  for (const d of decisoes) {
    for (const rel of (d.validators || [])) {
      if (!fs.existsSync(path.join(ROOT, rel))) validadoresFantasma.push(`${d.id}:${rel}`);
    }
  }
  registrar('READINESS_DECISIONS_PRESENT', {
    ok: faltando.length === 0 && validadoresFantasma.length === 0,
    detalhe: faltando.length > 0
      ? `decisões ausentes: ${faltando.join(', ')}`
      : (validadoresFantasma.length > 0
        ? `validadores inexistentes: ${validadoresFantasma.join(', ')}`
        : `${decisoes.length} decisão(ões) declaradas com validadores reais`),
    dados: { decisoes: ids },
  });
}

// ── 2. Commits citados como prova existem no repositório ─────────────────────────────────────
function checkCommits() {
  let fila;
  try {
    fila = lerJson(QUEUE_PATH);
  } catch (_) {
    return; // já reprovado em QUEUE_READABLE
  }
  const items = (fila.items || []).filter((i) => typeof i.commit === 'string' && i.commit.trim());
  const inexistentes = [];
  for (const item of items) {
    const commit = item.commit.trim();
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
      inexistentes.push(`${item.id}(formato inválido: ${commit})`);
      continue;
    }
    try {
      git(['cat-file', '-e', `${commit}^{commit}`]);
    } catch (_) {
      inexistentes.push(`${item.id}(${commit})`);
    }
  }
  registrar('EVIDENCE_COMMITS_EXIST', {
    ok: inexistentes.length === 0,
    detalhe: inexistentes.length === 0
      ? `${items.length} commit(s) de prova verificados no git`
      : `commits inexistentes: ${inexistentes.join(', ')}`,
    dados: { verificados: items.length, inexistentes },
  });
}

// ── 3. Relatórios de segregação PASS (consumidos, não presumidos) ────────────────────────────
function checkSegregacao() {
  const alvos = [
    { id: 'SEGREGATION_VISIBILITY', rel: 'reports/visibility-policy-report.json' },
    { id: 'SEGREGATION_EXPERIENCE', rel: 'reports/experience-segregation-report.json' },
    { id: 'SEGREGATION_EXPERIENCE_API', rel: 'reports/experience-api-segregation-report.json' },
  ];
  for (const alvo of alvos) {
    try {
      const r = lerJson(alvo.rel);
      const violacoes = Number(r.violationCount ?? (Array.isArray(r.violations) ? r.violations.length : 0));
      const contadores = r.counts || null;
      const contadoresZerados = !contadores
        || Object.values(contadores).every((v) => Number(v) === 0);
      const ok = r.status === 'PASS' && violacoes === 0 && contadoresZerados
        && (!Array.isArray(r.blockingFindings) || r.blockingFindings.length === 0);
      registrar(alvo.id, {
        ok,
        detalhe: ok
          ? `status=PASS violations=0${contadores ? ` counts=${JSON.stringify(contadores)}` : ''}`
          : `status=${r.status} violations=${violacoes} counts=${JSON.stringify(contadores)}`,
        dados: { relatorio: alvo.rel, generatedAt: r.generatedAt || null },
      });
    } catch (err) {
      registrar(alvo.id, { ok: false, detalhe: `relatório ausente/ilegível (${alvo.rel}): ${err.message}` });
    }
  }
}

// ── 4. Documento de readiness íntegro (não esvaziado) ───────────────────────────────────────
function checkDocumento() {
  let texto;
  try {
    texto = fs.readFileSync(READINESS_DOC, 'utf8');
  } catch (err) {
    registrar('READINESS_DOC_PRESENT', { ok: false, detalhe: `documento ausente: ${err.message}` });
    return;
  }
  const ausentes = SECOES_OBRIGATORIAS.filter((s) => !texto.includes(s));
  registrar('READINESS_DOC_PRESENT', { ok: true, detalhe: 'ENGINEER_SUPERVISED_READINESS.md presente' });
  registrar('READINESS_DOC_SECTIONS', {
    ok: ausentes.length === 0,
    bloqueante: true,
    detalhe: ausentes.length === 0
      ? `${SECOES_OBRIGATORIAS.length} seções obrigatórias presentes`
      : `seções ausentes: ${ausentes.join(', ')}`,
    dados: { linhas: texto.split('\n').length },
  });
}

// ── 5. Aprovação humana REAL (não simulável) ────────────────────────────────────────────────
function checkAprovacaoHumana(sha) {
  const rel = path.relative(ROOT, APPROVAL_PATH);
  let doc;
  try {
    doc = lerJson(APPROVAL_PATH);
  } catch (_) {
    registrar('HUMAN_APPROVAL_PRESENT', {
      ok: false,
      // Ausência de assinatura NÃO é falha de check: o veredito correto é
      // PENDING_HUMAN_APPROVAL (exit 2). Assinatura presente e INVÁLIDA continua bloqueante
      // (HUMAN_APPROVAL_VALID).
      bloqueante: false,
      detalhe: `sem assinatura humana em ${rel} — o veredito fica PENDING_HUMAN_APPROVAL (nunca GO)`,
      dados: { caminho: rel },
    });
    return { aprovado: false };
  }
  const obrigatorios = ['approver', 'approvedAt', 'missionId', 'scope', 'statement'];
  const faltando = obrigatorios.filter((k) => !doc[k] || String(doc[k]).trim() === '');
  const simulada = doc.simulated === true || doc.approver === 'automation' || doc.approver === 'agent';
  const dataValida = !Number.isNaN(Date.parse(String(doc.approvedAt || '')));
  const okBasico = faltando.length === 0 && !simulada && dataValida;

  registrar('HUMAN_APPROVAL_PRESENT', { ok: true, detalhe: `assinatura encontrada em ${rel}` });

  // Pedido vigente: a aprovação só vale para a MISSÃO pedida e para o COMMIT medido.
  const pedidoRel = 'AI_MEMORY/evidence/engineer-supervised-approval-request.json';
  const pedido = (() => { try { return lerJson(pedidoRel); } catch (_) { return null; } })();
  const autoridadesDoc = (() => { try { return lerJson('governance/risk-acceptance/authorities.json'); } catch (_) { return null; } })();
  const autoridades = autoridadesDoc && Array.isArray(autoridadesDoc.authorities) ? autoridadesDoc.authorities : [];

  const validacao = require('../../governance/risk-acceptance/approval').validarAprovacaoHumana(doc, {
    sourceCommit: sha,
    missionId: pedido ? pedido.missionId : null,
    autoridades,
  });

  const ok = okBasico && validacao.ok;
  registrar('HUMAN_APPROVAL_VALID', {
    ok,
    detalhe: ok
      ? `aprovador=${doc.approver} em ${doc.approvedAt} (missão ${doc.missionId}, commit ${String(doc.sourceCommit).slice(0, 10)})`
      : `assinatura inválida: faltando=[${faltando.join(',')}] simulada=${simulada} dataValida=${dataValida} motivos=[${validacao.motivos.join(',')}]`,
    dados: { caminho: rel, approver: doc.approver || null, motivos: validacao.motivos },
  });
  return { aprovado: ok };
}

/**
 * Decisão PURA a partir dos checks e da aprovação humana. Extraída para que a semântica de
 * veredito seja testável sem git/banco/arquivos — e para que ninguém "simplifique" a regra
 * central: **sem aprovação humana real não existe GO**.
 *
 * @param {{checks:Array<{id:string,ok:boolean,bloqueante:boolean}>, aprovacaoHumana:boolean}} input
 * @returns {{veredito:string, exitCode:number, isGo:boolean, falhas:string[]}}
 */
function decidirVeredito({ checks = [], aprovacaoHumana = false } = {}) {
  const falhas = checks.filter((c) => c.bloqueante !== false && !c.ok).map((c) => c.id);
  if (falhas.length > 0) return { veredito: 'NOT_READY', exitCode: 1, isGo: false, falhas };
  if (!aprovacaoHumana) return { veredito: 'PENDING_HUMAN_APPROVAL', exitCode: 2, isGo: false, falhas: [] };
  return { veredito: 'ENGINEER_SUPERVISED_READY_GO', exitCode: 0, isGo: true, falhas: [] };
}

function main() {
  const sha = git(['rev-parse', 'HEAD']);
  const branch = (() => {
    try { return git(['rev-parse', '--abbrev-ref', 'HEAD']); } catch (_) { return null; }
  })();

  checkFila();
  const bloqueios = checkBloqueiosClassificados(sha);
  checkDecisoesSeparadas();
  checkCommits();
  checkSegregacao();
  checkDocumento();
  const aprovacao = checkAprovacaoHumana(sha);

  const decisao = decidirVeredito({ checks, aprovacaoHumana: Boolean(aprovacao.aprovado) });
  const { veredito, exitCode } = decisao;
  const falhas = checks.filter((c) => c.bloqueante && !c.ok);
  const checksOk = falhas.length === 0;

  const relatorio = {
    artifactType: 'ENGINEER_SUPERVISED_READINESS',
    artifactVersion: 1,
    status: checksOk ? 'PASS' : 'FAIL',
    veredito,
    exitCode,
    checks,
    /** Quatro baldes SEPARADOS (§6): aceite nunca aparece como resolução. */
    bloqueios: {
      RESOLVED_VERIFIED: (bloqueios.baldes.RESOLVED_VERIFIED || []).map((b) => ({ riskId: b.riskId, prova: b.detalhe && b.detalhe.probe, sha256Saida: b.detalhe && b.detalhe.sha256Saida })),
      ACCEPTED_RISK: (bloqueios.baldes.ACCEPTED_RISK || []).map((b) => ({ riskId: b.riskId, aprovadoPor: b.detalhe && b.detalhe.aprovadoPor, expiraEm: b.detalhe && b.detalhe.aceiteExpiraEm })),
      NOT_APPLICABLE: (bloqueios.baldes.NOT_APPLICABLE || []).map((b) => ({ riskId: b.riskId, classe: b.classe, dono: b.detalhe && b.detalhe.ownedBy })),
      BLOCKED: (bloqueios.baldes.BLOCKED || []).map((b) => ({ riskId: b.riskId, motivos: b.motivos })),
    },
    falhas: falhas.map((c) => c.id),
    aprovacaoHumana: { presente: checks.some((c) => c.id === 'HUMAN_APPROVAL_PRESENT' && c.ok), valida: Boolean(aprovacao.aprovado) },
    git: { commit: sha, branch },
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, `${JSON.stringify(relatorio, null, 2)}\n`);

  console.log(`[supervised-readiness] veredito=${veredito} (exit ${exitCode})`);
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.id} — ${c.detalhe}`);
  }
  console.log(`[supervised-readiness] relatório: ${path.relative(ROOT, JSON_OUT)}`);
  process.exitCode = exitCode;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[supervised-readiness] INFRA_ERROR: ${err.message}`);
    process.exitCode = 3;
  }
}

module.exports = { ABERTOS, IMPEDIDOS, SECOES_OBRIGATORIAS, decidirVeredito };
