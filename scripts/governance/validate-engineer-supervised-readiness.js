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
const { carregarInventario } = require('../../governance/bug-closure/defect-registry');
const { verificarLivro } = require('../../governance/bug-closure/transition-ledger');
const { verificarCompletudeDoInventario, verificarConsistenciaDeRoteamento } = require('../../governance/bug-closure/authority-consistency');
const { classificarDefeitos } = require('../../governance/bug-closure/eligibility');
const {
  ancoraDoInventario, digestDoInventario, chaveDeAprovacaoAncorada, fingerprintDaChavePem,
} = require('../../governance/bug-closure/trusted-authorities');
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
  // ALERT 5 (revisor independente, P1): este check lia o `status` CRU. `state:"OPEN"` com
  // `status:"done"` passava por todos os checks novos. A autoridade do estado é o inventário
  // MIGRADO (mesma função que certifica), e divergência state×status é fato reportado.
  // Achado do revisor (2ª passada, P1): sem `queuePath`, em NODE_ENV=test o módulo lia o
  // fixture apontado por BUG_CLOSURE_INVENTORY_PATH — as duas metades do gate olhavam
  // inventários diferentes e um P0 real ficava invisível. O gate lê SEMPRE o oficial.
  const inventario = carregarInventario({ queuePath: QUEUE_PATH });
  const migrados = inventario.defeitos || [];
  const porId = new Map(migrados.map((d) => [d.id, d]));
  // 3ª passada do revisor, P1: `aberto` sozinho escondia `RISK_ACCEPTED` sem aceite válido
  // (o item não conta como aberto, mas também não pode certificar). A fila é classificada
  // pela MESMA régua que certifica: `classificarDefeitos` + validação do aceite.
  const classificacao = classificarDefeitos(migrados);
  const abertos = migrados.filter((d) => d.aberto === true
    || (classificacao.riscoAceitoIneficaz || []).some((x) => x.id === d.id)
    || (String(d.state || '').toUpperCase() === 'RISK_ACCEPTED'
      && !(classificacao.riscoAceito || []).some((x) => x.id === d.id)));
  const impedidos = items.filter((i) => IMPEDIDOS.has(String(i.status || '').toLowerCase()));

  // Divergência ESTRUTURAL entre o `state` DECLARADO e o `status` legado (independente de
  // prova). É exatamente o caso `state:"OPEN"` + `status:"done"`, que antes escapava de todos
  // os checks. Itens sem `state` (legado puro) não podem divergir: o status É o estado.
  const STATUS_FECHADOS = new Set(['done', 'verified', 'prevention_active', 'resolved', 'closed']);
  const ESTADOS_DECLARADOS_FECHADOS = new Set(['VERIFIED', 'RESOLVED', 'RISK_ACCEPTED']);
  const divergentes = items
    .map((i) => ({ item: i, canonico: porId.get(i && i.id) }))
    .filter(({ item }) => {
      if (!item || !item.state) return false;
      const declarado = String(item.state).toUpperCase();
      const status = String(item.status || '').toLowerCase();
      // `RISK_ACCEPTED` + `blocked_external` é a projeção legada correta de risco aceito.
      if (declarado === 'RISK_ACCEPTED' && status === 'blocked_external') return false;
      const declaradoFechado = ESTADOS_DECLARADOS_FECHADOS.has(declarado);
      return declaradoFechado !== STATUS_FECHADOS.has(status);
    });

  registrar('QUEUE_READABLE', { ok: items.length > 0, detalhe: `${items.length} item(ns)` });
  registrar('QUEUE_NO_OPEN_DEFECT', {
    ok: abertos.length === 0,
    detalhe: abertos.length === 0
      ? 'nenhum defeito aberto no inventário canônico'
      : `abertos: ${abertos.map((d) => `${d.id}(${d.stateEfetivo || d.state})`).join(', ')}`,
    dados: { abertos: abertos.map((d) => d.id) },
  });
  // Pertença do inventário: o gate de readiness também deriva veredito formal, então exige a
  // MESMA âncora externa usada na certificação.
  {
    const ancora = ancoraDoInventario();
    const digest = digestDoInventario(migrados);
    let okAncora = false;
    let detalheAncora;
    if (!ancora) {
      detalheAncora = 'sem RAP_CLOSURE_INVENTORY_SHA256: pertença dos itens não autenticada';
    } else if (ancora !== digest) {
      detalheAncora = `digest ${digest.slice(0, 12)}… difere da âncora externa ${ancora.slice(0, 12)}…`;
    } else {
      okAncora = true;
      detalheAncora = `digest do inventário casa com a âncora externa (${digest.slice(0, 12)}…)`;
    }
    registrar('QUEUE_INVENTORY_ANCHORED', { ok: okAncora, detalhe: detalheAncora, dados: { digest } });
  }

  registrar('QUEUE_STATE_STATUS_COHERENT', {
    ok: divergentes.length === 0,
    detalhe: divergentes.length === 0
      ? 'state canônico projetado sem divergência em todos os itens'
      : `divergentes: ${divergentes.map(({ item, canonico }) => `${item.id}(declarado=${item.state || '-'} canonico=${canonico.state})`).join(', ')}`,
    dados: { divergentes: divergentes.map(({ item }) => item.id) },
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

  // ── CAMADA B (missão P0 2026-10-22): inventário x livro x roteamento ──────
  // Um defeito P0/P1 que DECLARA fechamento sem prova válida continua bloqueando
  // certificação. Aqui isso é medido e reportado: não há caminho em que editar o JSON
  // (ou apagar a linha, ou remover a rota) produza "pronto".
  let inventario = null;
  try {
    inventario = carregarInventario({ queuePath: QUEUE_PATH });
  } catch (erro) {
    registrar('QUEUE_EVIDENCE_READABLE', { ok: false, detalhe: `inventário ilegível: ${erro.message}` });
  }
  if (inventario) {
    // Medido explicitamente também no caminho feliz: o catálogo da decisão exige COBERTURA
    // declarada de cada check, e "não registrei porque deu certo" é indistinguível de
    // "não medi". Registrado como não-bloqueante: quem decide bloqueio é o conteúdo.
    registrar('QUEUE_EVIDENCE_READABLE', {
      ok: true,
      bloqueante: false,
      detalhe: `inventário carregado: ${inventario.defeitos.length} defeito(s)`,
    });
    const livro = verificarLivro(ROOT);
    const naoProvados = inventario.defeitos.filter((d) => d.fechamentoNaoProvado === true);
    registrar('QUEUE_CLOSURE_EVIDENCE', {
      ok: naoProvados.length === 0,
      bloqueante: true,
      detalhe: naoProvados.length === 0
        ? 'todo fechamento declarado tem prova válida (SHA, fingerprint, testes, livro e assinatura)'
        : `${naoProvados.length} fechamento(s) declarado(s) SEM prova válida: ` +
          `${naoProvados.slice(0, 8).map((d) => `${d.id}(${d.provaDeFechamento && d.provaDeFechamento.code})`).join(', ')}` +
          (naoProvados.length > 8 ? ' …' : ''),
      dados: { total: naoProvados.length, exemplo: naoProvados.slice(0, 20).map((d) => d.id) },
    });

    const completude = verificarCompletudeDoInventario({ defeitos: inventario.defeitos, livro });
    registrar('QUEUE_INVENTORY_COMPLETE', {
      ok: completude.ok,
      bloqueante: true,
      detalhe: completude.ok ? 'nenhum defeito do livro desapareceu do inventário' : completude.violations.map((v) => `${v.code}:${v.defectId}`).join(', '),
    });

    let roteamentoAtual = null;
    try { roteamentoAtual = lerJson(riskAcceptance.ROUTING_REL); } catch (_) { roteamentoAtual = null; }
    const consistencia = verificarConsistenciaDeRoteamento({ defeitos: inventario.defeitos, roteamento: roteamentoAtual });
    registrar('ROUTING_CONSISTENT_WITH_AUTHORITY', {
      ok: consistencia.ok,
      bloqueante: true,
      detalhe: consistencia.ok
        ? 'roteamento coerente com a autoridade canônica (inventário + prova)'
        : consistencia.violations.map((v) => `${v.code}:${v.defectId}`).join(', '),
      dados: { violacoes: consistencia.violations.length },
    });
  }

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
    // Cobertura EXPLÍCITA do catálogo: sem assinatura não há o que ancorar/validar, e isso é
    // medido como "não aplicável" (não-bloqueante) — nunca como ausência silenciosa de check.
    registrar('HUMAN_APPROVAL_ANCHORED', {
      ok: false, bloqueante: false, status: 'NOT_EXECUTED',
      detalhe: 'não medido: não há assinatura humana para ancorar',
    });
    registrar('HUMAN_APPROVAL_VALID', {
      ok: false, bloqueante: false, status: 'NOT_EXECUTED',
      detalhe: 'não medido: não há assinatura humana para validar',
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

  // 3ª passada do revisor, P1: validar a assinatura contra `authorities.json` (editável pelo
  // mesmo ator) não prova autoria humana. A chave de aprovação precisa estar ANCORADA.
  const autoridadeAprovadora = autoridades.find(
    (a) => a && a.identity === String(doc.approverIdentity || doc.approver || ''),
  );
  const ancoragem = autoridadeAprovadora && autoridadeAprovadora.publicKeyPem
    ? chaveDeAprovacaoAncorada(autoridadeAprovadora.publicKeyPem)
    : { ok: false, motivo: 'AUTORIDADE_NAO_REGISTRADA', fingerprint: null };
  registrar('HUMAN_APPROVAL_ANCHORED', {
    ok: ancoragem.ok === true,
    detalhe: ancoragem.ok
      ? `chave de aprovação ancorada (${String(ancoragem.fingerprint).slice(0, 12)}…)`
      : `chave de aprovação NÃO ancorada: ${ancoragem.motivo} — RAP_APPROVAL_TRUST_ANCHOR_SHA256 `
        + 'e pin versionado são obrigatórios para que a aprovação valha como humana',
    dados: { fingerprint: fingerprintDaChavePem(autoridadeAprovadora && autoridadeAprovadora.publicKeyPem) },
  });

  const ok = okBasico && validacao.ok && ancoragem.ok === true;
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
/**
 * CATÁLOGO CANÔNICO dos checks que o gate pode produzir. A decisão exige COBERTURA EXPLÍCITA
 * deste conjunto: `checks` vazio, parcial, desconhecido ou com resultado inconclusivo não é
 * "nada falhou", é "nada foi medido".
 */
const CHECKS_OBRIGATORIOS = Object.freeze([
  'QUEUE_READABLE',
  'QUEUE_NO_OPEN_DEFECT',
  'QUEUE_INVENTORY_ANCHORED',
  'QUEUE_STATE_STATUS_COHERENT',
  'QUEUE_NO_BLOCKED',
  'QUEUE_BLOCKERS_CLASSIFIED',
  'QUEUE_EVIDENCE_READABLE',
  'QUEUE_CLOSURE_EVIDENCE',
  'QUEUE_INVENTORY_COMPLETE',
  'ROUTING_CONSISTENT_WITH_AUTHORITY',
  'NON_WAIVABLE_ABSENT',
  'READINESS_DECISIONS_PRESENT',
  'EVIDENCE_COMMITS_EXIST',
  'SEGREGATION_VISIBILITY',
  'SEGREGATION_EXPERIENCE',
  'SEGREGATION_EXPERIENCE_API',
  'READINESS_DOC_PRESENT',
  'READINESS_DOC_SECTIONS',
  'HUMAN_APPROVAL_PRESENT',
  'HUMAN_APPROVAL_ANCHORED',
  'HUMAN_APPROVAL_VALID',
]);

/**
 * Resultados que NÃO são aprovação. Um check com `ok:true` e status inconclusivo é contraditório
 * e reprova: nunca se converte UNKNOWN/NOT_EXECUTED/TIMEOUT/SKIPPED em PASS.
 */
const STATUS_INCONCLUSIVOS = Object.freeze(new Set([
  'UNKNOWN', 'NOT_EXECUTED', 'TIMEOUT', 'SKIPPED', 'BLOCKED', 'ERROR', 'PENDING', 'INCONCLUSIVO', 'FLAKY',
]));

/**
 * Decide o veredito a partir dos checks MEDIDOS.
 *
 * P1-D: a versão anterior devolvia `ENGINEER_SUPERVISED_READY_GO` com `checks=[]` (ou `undefined`,
 * ou um único check inventado) desde que `aprovacaoHumana === true` — aprovação humana
 * substituía teste técnico, exatamente o que o princípio "ausência de evidência não é aprovação"
 * proíbe. O contrato agora é seguro MESMO quando chamado fora do script principal:
 *
 *   - `checks` precisa ser array não vazio;
 *   - todo check precisa de `id` de string, `ok` booleano e `detalhe` (evidência textual);
 *   - id duplicado, desconhecido (fora do catálogo) ou ausente do catálogo ⇒ NOT_READY;
 *   - status inconclusivo ⇒ NOT_READY (mesmo com `ok:true`);
 *   - `identidade` (commit/fingerprint) é conferida contra a declarada por cada check;
 *   - aprovação humana continua NECESSÁRIA para GO, mas nunca suficiente.
 *
 * @returns {{veredito:string, exitCode:number, isGo:boolean, falhas:string[], problemas:string[], checksAusentes:string[]}}
 */
function decidirVeredito({ checks, aprovacaoHumana = false, catalogo = CHECKS_OBRIGATORIOS, identidade = null } = {}) {
  const catalogoEfetivo = Array.isArray(catalogo) ? catalogo : [];
  const problemas = [];
  const falhas = [];

  if (!Array.isArray(checks) || checks.length === 0) {
    return {
      veredito: 'NOT_READY',
      exitCode: 1,
      isGo: false,
      falhas: [],
      problemas: [Array.isArray(checks) ? 'CHECKS_VAZIOS' : 'CHECKS_AUSENTES'],
      checksAusentes: [...catalogoEfetivo],
    };
  }

  const vistos = new Set();
  const porId = new Map();
  for (const check of checks) {
    if (!check || typeof check !== 'object' || typeof check.id !== 'string' || check.id.trim() === '') {
      problemas.push('CHECK_SEM_ID');
      continue;
    }
    const id = check.id.trim();
    if (vistos.has(id)) { problemas.push(`CHECK_DUPLICADO:${id}`); continue; }
    vistos.add(id);
    porId.set(id, check);

    if (catalogoEfetivo.length > 0 && !catalogoEfetivo.includes(id)) problemas.push(`CHECK_DESCONHECIDO:${id}`);
    if (typeof check.ok !== 'boolean') problemas.push(`CHECK_SEM_RESULTADO_BOOLEANO:${id}`);
    if (typeof check.detalhe !== 'string' || check.detalhe.trim() === '') problemas.push(`CHECK_SEM_EVIDENCIA:${id}`);

    const status = String(check.status || '').toUpperCase();
    if (status && STATUS_INCONCLUSIVOS.has(status)) problemas.push(`CHECK_INCONCLUSIVO:${id}:${status}`);

    if (identidade && check.identidade) {
      for (const campo of ['commit', 'sourceFingerprint']) {
        if (identidade[campo] !== undefined && check.identidade[campo] !== undefined
          && String(check.identidade[campo]) !== String(identidade[campo])) {
          problemas.push(`CHECK_DE_OUTRO_COMMIT:${id}:${campo}`);
        }
      }
    }

    if (check.ok !== true && check.bloqueante !== false) falhas.push(id);
  }

  const checados = [...vistos];
  const checksAusentes = catalogoEfetivo.filter((id) => !vistos.has(id));
  for (const id of checksAusentes) problemas.push(`CHECK_OBRIGATORIO_AUSENTE:${id}`);

  if (falhas.length > 0 || problemas.length > 0 || checksAusentes.length > 0) {
    return { veredito: 'NOT_READY', exitCode: 1, isGo: false, falhas, problemas, checksAusentes, checados };
  }

  // Aprovação humana é NECESSÁRIA, nunca suficiente: os checks técnicos acima já foram exigidos.
  if (!aprovacaoHumana) {
    return { veredito: 'PENDING_HUMAN_APPROVAL', exitCode: 2, isGo: false, falhas: [], problemas: [], checksAusentes: [], checados };
  }
  return { veredito: 'ENGINEER_SUPERVISED_READY_GO', exitCode: 0, isGo: true, falhas: [], problemas: [], checksAusentes: [], checados };
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

  const decisao = decidirVeredito({
    checks,
    aprovacaoHumana: Boolean(aprovacao.aprovado),
    // Identidade de execução: qualquer check que declare commit/fingerprint tem de casar.
    identidade: { commit: sha },
  });
  const { veredito, exitCode } = decisao;
  const falhas = checks.filter((c) => c.bloqueante && !c.ok);
  const checksOk = falhas.length === 0;

  const relatorio = {
    artifactType: 'ENGINEER_SUPERVISED_READINESS',
    artifactVersion: 1,
    status: checksOk && decisao.veredito === 'ENGINEER_SUPERVISED_READY_GO' ? 'PASS' : 'FAIL',
    veredito,
    exitCode,
    // Problemas estruturais da decisão (cobertura incompleta, duplicidade, inconclusivo).
    problemasDaDecisao: decisao.problemas || [],
    checksAusentes: decisao.checksAusentes || [],
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
  for (const p of decisao.problemas || []) console.log(`  PROBLEMA ${p}`);
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

module.exports = {
  ABERTOS,
  IMPEDIDOS,
  SECOES_OBRIGATORIAS,
  CHECKS_OBRIGATORIOS,
  STATUS_INCONCLUSIVOS,
  decidirVeredito,
};
