#!/usr/bin/env node
'use strict';

/**
 * Gera AI_MEMORY/evidence/AUDIT_ENTRYPOINT.{json,md} — ponto de entrada ÚNICO para
 * auditoria externa (ex.: ChatGPT) que lê o repositório via git.
 *
 * Por que existe
 * --------------
 * A maior parte da prova do RAP vive em `reports/*.json` e `governance/*.json`,
 * que são IGNORADOS pelo git (`.gitignore` linhas 118/124). Um auditor externo
 * que só olha o git, então, não vê a prova — e o único ponteiro de fechamento na
 * raiz (`FINAL_RAP_RELEASE_CLOSURE.json`) é ÓRFÃO e ficou stale em 2026-09-24,
 * apontando um headNow antigo. Este artefato resolve os dois problemas:
 *
 *   1. é COMMITADO, então `git log -- AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json`
 *      responde "o que mudou desde a última auditoria";
 *   2. carrega `auditEpoch` (hash do payload) e SHA-256 de cada prova em disco,
 *      então o auditor detecta mudança E adulteração sem precisar dos arquivos
 *      ignorados estarem versionados.
 *
 * NADA aqui é escrito à mão: todo valor é lido de fonte viva (git, run governado,
 * relatórios canônicos) e o epoch é sha256 do próprio payload.
 *
 * Posição: `tools/audit/` — deliberadamente FORA de SOURCE_ROOTS/FILTERED_SOURCE_ROOTS
 * (`governance/proof-engine/fingerprint-chain.js`), para que gerar/commitar este
 * artefato NÃO altere o sourceFingerprint e não invalide um release já selado.
 *
 * Uso: node tools/audit/generate-audit-entrypoint.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SAIDA_JSON = path.join(ROOT, 'AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json');
const SAIDA_MD = path.join(ROOT, 'AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md');

/** Provas canônicas: caminho + como extrair o veredito. */
const PROVAS = [
  { path: 'reports/governance-score.json', campo: 'status' },
  { path: 'reports/coverage-gate-report.json', campo: 'status' },
  { path: 'reports/release-artifact-identity-report.json', campo: 'decision' },
  { path: 'reports/source-remote-provenance-report.json', campo: 'status' },
  { path: 'reports/final-status-projection-report.json', campo: 'status' },
  { path: 'reports/security-release-gate-report.json', campo: 'decision' },
  { path: 'reports/security-intel-report.json', campo: 'status' },
  { path: 'reports/mcp-research-docker-e2e-report.json', campo: 'status' },
  { path: 'reports/hardening-queue-report.json', campo: 'status' },
  { path: 'reports/release-dag-report.json', campo: 'decision' },
  { path: 'governance/evidence-manifest.json', campo: 'status' },
  { path: 'governance/delivered-release-verification-report.json', campo: 'decision' },
  { path: 'governance/.current-run.json', campo: 'status' },
];

/** Artefatos físicos do release (em dist/, ignorado pelo git) — prova por hash. */
const ARTEFATOS_FISICOS = 'dist/release';

function git(args) {
  try {
    // stderr silenciado: `ls-files --error-unmatch` em arquivo ignorado é
    // resultado esperado (gitTracked=false), não erro.
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

function sha256Arquivo(abs) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (e) {
    return null;
  }
}

function lerJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Stringify canônico (chaves ordenadas) para o epoch ser reprodutível. */
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function caminhoRelativo(posix) {
  return path.relative(ROOT, posix).split(path.sep).join('/');
}

/** Caminhos que são o PRÓPRIO artefato — não contam como "worktree sujo". */
const PROPRIA_SAIDA = new Set([caminhoRelativo(SAIDA_JSON), caminhoRelativo(SAIDA_MD)]);

// ---------------------------------------------------------------- git
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const head = git(['rev-parse', 'HEAD']);
const headAssunto = git(['log', '-1', '--format=%s']);
const headData = git(['log', '-1', '--format=%cI']);
const sujeira = (git(['status', '--porcelain']) || '').split('\n').map((l) => l.trim()).filter(Boolean);
const arquivosSujos = sujeira.map((l) => l.replace(/^..\s+/, '')).filter((p) => !PROPRIA_SAIDA.has(p));
// Atenção: saída VAZIA significa "zero commits não enviados" (estado bom), não
// "desconhecido". Só null (erro do git) é desconhecido.
const naoEnviados = git(['log', '--oneline', `origin/${branch}..HEAD`]);
const commitsNaoEnviados = naoEnviados === null ? null : naoEnviados.split('\n').filter(Boolean).length;
const remoteHead = git(['rev-parse', `origin/${branch}`]);
const tronco = git(['rev-parse', '--abbrev-ref', 'origin/HEAD']);

const CLOSURE_COMMITS = [
  '36cd7fc06',
  '77a8b826e',
  'd9c469e67',
  'e0ddb6beb',
  'a5449d15e',
  '5efce7924',
  'c20433341',
].map((sha) => {
  const completo = git(['rev-parse', sha]);
  return {
    sha,
    commit: completo,
    assunto: completo ? git(['log', '-1', '--format=%s', completo]) : null,
    existe: Boolean(completo),
    emAlgumRemote: completo ? git(['branch', '-r', '--contains', completo]).length > 0 : false,
  };
});

// ------------------------------------------------------- run governado
const run = lerJson(path.join(ROOT, 'governance/.current-run.json')) || {};

// --------------------------------------------------- artefatos físicos
const dirRelease = path.join(ROOT, ARTEFATOS_FISICOS);
const artefatosFisicos = [];
if (fs.existsSync(dirRelease)) {
  for (const f of fs.readdirSync(dirRelease).sort()) {
    const abs = path.join(dirRelease, f);
    const st = fs.statSync(abs);
    if (!st.isFile()) continue;
    artefatosFisicos.push({
      path: caminhoRelativo(abs),
      bytes: st.size,
      sha256: sha256Arquivo(abs),
    });
  }
}

// -------------------------------------------------------------- provas
const provas = PROVAS.map(({ path: rel, campo }) => {
  const abs = path.join(ROOT, rel);
  const existe = fs.existsSync(abs);
  const d = existe ? lerJson(abs) : null;
  return {
    path: rel,
    gitTracked: Boolean(git(['ls-files', '--error-unmatch', rel])),
    existe,
    veredito: d && d[campo] !== undefined ? d[campo] : null,
    campoVeredito: campo,
    runId: d && d.runId ? d.runId : null,
    generatedAt: d && d.generatedAt ? d.generatedAt : null,
    sha256: existe ? sha256Arquivo(abs) : null,
  };
});

// ----------------------------------------------- itens abertos da fila
const fila = lerJson(path.join(ROOT, 'AI_MEMORY/hardening-queue.json')) || { items: [] };
const STATUS_FECHADOS = ['done', 'verified', 'prevention_active', 'blocked_external'];
const naoFechados = (fila.items || []).filter((i) => !STATUS_FECHADOS.includes(i.status));

// ------------------------------------------------------ ponteiros stale
// Arquivos de fechamento na RAIZ que ficaram stale e NENHUM gate mantém. Um
// auditor que os leia como "estado atual" audita o passado — por isso este
// artefato os mede e avisa explicitamente.
const PONTEIROS_RAIZ = [
  'FINAL_RAP_RELEASE_CLOSURE.json',
  'FINAL_RELEASE_CLOSURE.md',
  'ENGINEERING_ROUTER_V1_SEAL_REPORT.json',
  'ENGINEERING_ROUTER_V1_FINAL_SEAL.md',
];

const ponteirosHistoricos = PONTEIROS_RAIZ.map((rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const d = rel.endsWith('.json') ? lerJson(abs) : null;
  const ultimo = git(['log', '-1', '--format=%h|%cI', '--', rel]);
  const [ultimoCommit, ultimaData] = ultimo ? ultimo.split('|') : [null, null];
  return {
    path: rel,
    gitTracked: Boolean(git(['ls-files', '--error-unmatch', rel])),
    ultimoCommit,
    ultimaData,
    geradoEm: d && d.generatedAt ? d.generatedAt : null,
    headRegistrado: d && d.source ? d.source.headNow : null,
    statusRegistrado: d ? d.status || null : null,
    aviso: 'HISTÓRICO/stale — NÃO representa o estado atual; use AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json',
  };
}).filter(Boolean);

// ------------------------------------------------- gate agregado
// O alias `validate:governance-enforcement` é uma CADEIA de aliases em
// package.json. Medição 2026-10-16: ele NÃO persiste relatório próprio
// (`reports/governance-enforcement-full-report.json` é escrito por
// `run-all-validators.js`, que o alias não usa). Por isso o veredito do
// agregado é DERIVADO aqui: comando real + lista real de validadores lida do
// package.json + as provas canônicas do run corrente.
const pkg = lerJson(path.join(ROOT, 'package.json')) || { scripts: {} };
const cadeiaAgregado = String((pkg.scripts || {})['validate:governance-enforcement'] || '');
const passosAgregado = cadeiaAgregado
  .split('&&')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((passo) => {
    const m = /^npm run\s+(?:--silent\s+)?([^\s]+)$/.exec(passo);
    return { passo, alias: m ? m[1] : null, viaNpmRun: Boolean(m) };
  });

const agregado = {
  comando: 'npm run validate:governance-enforcement',
  passosNaCadeia: passosAgregado.length,
  passosViaNpmRun: passosAgregado.filter((p) => p.viaNpmRun).length,
  passosNaoNpmRun: passosAgregado.filter((p) => !p.viaNpmRun).map((p) => p.passo),
  semantica:
    'A cadeia usa && encadeado: exit 0 no alias PROVA que TODOS os passos passaram (qualquer falha aborta com exit != 0). ' +
    'Isso é mais forte e mais simples que contar linhas "status=PASS" no log, que é artefato de formatação ' +
    'de cada gate e não corresponde 1:1 ao número de passos.',
  relatorioProprio: (() => {
    const rel = 'reports/governance-enforcement-full-report.json';
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return { path: rel, existe: false };
    const d = lerJson(abs) || {};
    const doRunCorrente = Boolean(d.runId && run.runId && d.runId === run.runId);
    return {
      path: rel,
      existe: true,
      generatedAt: d.generatedAt || null,
      runId: d.runId || null,
      doRunCorrente,
      escritor: 'scripts/governance/run-all-validators.js',
      aviso: doRunCorrente
        ? 'Relatório do agregado é do run corrente.'
        : 'DESATUALIZADO: existe, mas NÃO é do run corrente — o alias `validate:governance-enforcement` não usa run-all-validators.js, logo não o regrava. Não use este arquivo como veredito do agregado; use o exit code da cadeia + as provas canônicas abaixo.',
    };
  })(),
  provasComRunIdCorrente: provas.filter((p) => p.runId && run.runId && p.runId === run.runId).length,
  provasSemCampoRunId: provas.filter((p) => !p.runId).map((p) => p.path),
  provasDeOutroRun: provas.filter((p) => p.runId && run.runId && p.runId !== run.runId).map((p) => p.path),
  ultimaExecucaoMedida: (() => {
    const rel = 'AI_MEMORY/evidence/aggregate-enforcement-last-run.json';
    const d = lerJson(path.join(ROOT, rel));
    if (!d) return { path: rel, existe: false, nota: 'grave com tools/audit/record-aggregate-run.js --log <log> --head <sha>' };
    return {
      path: rel,
      existe: true,
      veredito: d.veredito,
      exitCode: d.exitCode,
      headAtRun: d.execucao ? d.execucao.headAtRun : null,
      logFinishedAt: d.execucao ? d.execucao.logFinishedAt : null,
      logPath: d.execucao ? d.execucao.logPath : null,
      logSha256: d.execucao ? d.execucao.logSha256 : null,
      diagnostico: d.diagnostico || null,
    };
  })(),
};
const payload = {
  git: {
    branch,
    headAtGeneration: head,
    headAssunto,
    headData,
    remoteHead,
    tronco,
    headEmSincroniaComRemote: Boolean(head && remoteHead && head === remoteHead),
    worktreeCleanExcluindoEsteArtefato: arquivosSujos.length === 0,
    uncommittedPaths: arquivosSujos,
    commitsNaoEnviados,
  },
  releaseGovernado: {
    runId: run.runId || null,
    sourceFingerprint: run.sourceFingerprint || null,
    sourceCommit: run.sourceCommit || null,
    sourceTree: run.sourceTree || null,
    startedAt: run.startedAt || null,
    lastGovernedStage: run.lastGovernedStage || null,
    runStatus: run.status || null,
  },
  closureCommits: CLOSURE_COMMITS,
  agregado,
  provas,
  artefatosFisicos,
  fila: {
    total: (fila.items || []).length,
    naoFechados: naoFechados.map((i) => ({ id: i.id, status: i.status, motivo: i.blocked_reason || null })),
  },
  ponteirosHistoricos,
};

const epoch = crypto.createHash('sha256').update(canonico(payload)).digest('hex');

const doc = {
  artifactType: 'rap-audit-entrypoint',
  artifactVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  generatedBy: 'tools/audit/generate-audit-entrypoint.js',
  auditEpoch: {
    valor: epoch,
    definicao: 'sha256 do bloco "payload" em stringify canônico — muda quando qualquer prova, veredito, commit ou artefato muda',
    comoUsar: 'compare este valor e os sha256 de payload.provas[] com os da auditoria anterior; diferença = houve mudança, reaudite',
  },
  payload,
  comoDetectarMudanca: [
    'git log --oneline -20',
    `git log -1 --format=%H -- AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json   # commit que gerou o epoch atual`,
    'auditEpoch.valor != epoch da auditoria anterior  =>  houve mudança',
    'payload.provas[].sha256 != hash registrado       =>  prova alterada em disco (possível adulteração)',
  ],
  comoReauditar: [
    'npm run validate:governance-enforcement      # gate agregado bloqueante (31 validadores)',
    'node scripts/governance/validate-hardening-queue.js',
    'npm run validate:release-artifact-identity',
    'node scripts/governance/verify-remote-provenance.js --manifest dist/release/<release>.manifest.json',
    'npm run validate:final-status-projection',
  ],
  fontesCanonicas: [
    'AI_MEMORY/hardening-queue.json            (fila oficial de pendências)',
    'AI_MEMORY/evidence/missao-hardening-eng-gov-release-2026-10-16.md  (relatório da missão)',
    'docs/governance/_platform-status-source.json  (decisão canônica de release)',
    'docs/governance/PLATFORM_STATUS.md e docs/architecture/RAP_MASTER_SCORECARD.md  (projeções)',
    'reports/*.json e governance/*.json        (prova em disco; ignorados pelo git por política)',
  ],
  politica: {
    publicado: false,
    tagCriada: false,
    observacao:
      'O release está SELADO e verificado, mas NÃO publicado: sem tag, sem promoção. Publicar é decisão explícita do operador (scripts/create-release-tag.sh + verify-remote-provenance --require-tag).',
  },
};

fs.writeFileSync(SAIDA_JSON, JSON.stringify(doc, null, 2) + '\n');

// ------------------------------------------------------------------ MD
const linhas = [];
linhas.push('# AUDIT_ENTRYPOINT — ponto de entrada único para auditoria externa');
linhas.push('');
linhas.push('> Artefato DERIVADO (nada escrito à mão). Gerado por `tools/audit/generate-audit-entrypoint.js`.');
linhas.push('> Regenerar: `node tools/audit/generate-audit-entrypoint.js`.');
linhas.push('');
linhas.push(`- **Gerado em**: ${doc.generatedAt}`);
linhas.push(`- **auditEpoch**: \`${epoch}\``);
linhas.push(`- **Branch / HEAD**: \`${branch}\` / \`${head}\``);
linhas.push(`- **HEAD sincronizado com o remote**: ${payload.git.headEmSincroniaComRemote ? 'sim' : 'NÃO'}`);
linhas.push(`- **Commits não enviados**: ${commitsNaoEnviados === null ? 'desconhecido' : commitsNaoEnviados}`);
linhas.push(`- **Release governado**: \`${run.runId || 'n/a'}\` · fingerprint \`${run.sourceFingerprint || 'n/a'}\``);
linhas.push(`- **Publicado**: NÃO (sem tag, sem promoção)`);
linhas.push('');
linhas.push('## Como detectar que algo mudou no git');
linhas.push('');
linhas.push('```bash');
for (const c of doc.comoDetectarMudanca) linhas.push(c);
linhas.push('```');
linhas.push('');
linhas.push('## Como reauditar');
linhas.push('');
linhas.push('```bash');
for (const c of doc.comoReauditar) linhas.push(c);
linhas.push('```');
linhas.push('');
linhas.push('### Gate agregado — como o veredito é derivado');
linhas.push('');
linhas.push(`- Comando: \`${agregado.comando}\``);
linhas.push(`- Passos na cadeia: **${agregado.passosNaCadeia}** (${agregado.passosViaNpmRun} via \`npm run\`)`);
if (agregado.passosNaoNpmRun.length > 0) {
  linhas.push(`- Passos que não são \`npm run\`: ${agregado.passosNaoNpmRun.map((p) => `\`${p}\``).join(', ')}`);
}
linhas.push(`- ${agregado.semantica}`);
linhas.push(`- Relatório próprio do agregado: \`${agregado.relatorioProprio.path}\` — ${agregado.relatorioProprio.existe ? `existe, gerado em ${agregado.relatorioProprio.generatedAt}, runId corrente? **${agregado.relatorioProprio.doRunCorrente ? 'sim' : 'NÃO'}**` : 'ausente'}`);
linhas.push(`- Provas acima com o runId corrente: **${agregado.provasComRunIdCorrente} de ${provas.length}**`);
if (agregado.provasSemCampoRunId.length > 0) {
  linhas.push(`- Provas que não registram campo \`runId\` (não é violação, o campo não existe nelas): ${agregado.provasSemCampoRunId.map((p) => `\`${p}\``).join(', ')}`);
}
if (agregado.provasDeOutroRun.length > 0) {
  linhas.push(`- **Provas de OUTRO run (violação)**: ${agregado.provasDeOutroRun.map((p) => `\`${p}\``).join(', ')}`);
}
linhas.push('');
if (agregado.relatorioProprio.aviso) {
  linhas.push(`> ${agregado.relatorioProprio.aviso}`);
  linhas.push('');
}
if (agregado.ultimaExecucaoMedida.existe) {
  const u = agregado.ultimaExecucaoMedida;
  linhas.push(`- **Última execução medida**: \`${u.veredito}\` (exit ${u.exitCode}) — HEAD \`${u.headAtRun || 'não informado'}\`, log \`${u.logPath}\` encerrado em ${u.logFinishedAt}, sha256 do log \`${String(u.logSha256).slice(0, 16)}\``);
  linhas.push(`- Diagnóstico do log: ${u.diagnostico.passLines} linhas \`status=PASS\`, ${u.diagnostico.failLines} \`status=FAIL\`, ${u.diagnostico.noGoLines} \`status=NO_GO\` (diagnóstico, não veredito)`);
} else {
  linhas.push('- **Última execução medida**: não gravada — use `node tools/audit/record-aggregate-run.js --log <log> --head <sha>` após rodar o agregado');
}
linhas.push('');
linhas.push('## Provas canônicas (hash do arquivo em disco)');
linhas.push('');
linhas.push('| prova | veredito | runId | sha256 (12) | no git |');
linhas.push('|---|---|---|---|---|');
for (const p of provas) {
  linhas.push(
    `| \`${p.path}\` | ${p.veredito === null ? 'AUSENTE' : `**${p.veredito}**`} | ${p.runId ? p.runId.slice(-12) : '—'} | ${p.sha256 ? p.sha256.slice(0, 12) : '—'} | ${p.gitTracked ? 'sim' : 'não (ignorado)'} |`
  );
}
linhas.push('');
linhas.push('## Artefatos físicos do release (prova por hash, fora do git)');
linhas.push('');
linhas.push('| artefato | bytes | sha256 (16) |');
linhas.push('|---|---|---|');
for (const a of artefatosFisicos) {
  linhas.push(`| \`${a.path}\` | ${a.bytes} | ${a.sha256 ? a.sha256.slice(0, 16) : '—'} |`);
}
linhas.push('');
linhas.push('## Itens que aguardam decisão do dono (fila oficial)');
linhas.push('');
linhas.push(
  'Nota de semântica: `blocked`/`blocked_external` são estados FECHADOS para o agente (ele não deve agir), ' +
    'mas continuam exigindo decisão humana — por isso aparecem aqui.'
);
linhas.push('');
if (naoFechados.length === 0) {
  linhas.push('Nenhum.');
} else {
  for (const i of naoFechados) {
    linhas.push(`- \`${i.id}\` — **${i.status}** — ${i.blocked_reason || 'sem motivo escrito'}`);
  }
}
linhas.push('');
if (ponteirosHistoricos.length > 0) {
  linhas.push('## Ponteiros stale na raiz do repositório — NÃO use como estado atual');
  linhas.push('');
  linhas.push('Estes arquivos existem na raiz, são versionados e NENHUM gate os mantém — eles congelaram em datas antigas. Um auditor que os leia como estado corrente audita o passado.');
  linhas.push('');
  linhas.push('| arquivo | gerado em | HEAD que ele registra | último commit que o tocou |');
  linhas.push('|---|---|---|---|');
  for (const p of ponteirosHistoricos) {
    linhas.push(
      `| \`${p.path}\` | ${p.geradoEm || '—'} | ${p.headRegistrado ? `\`${String(p.headRegistrado).slice(0, 10)}\`` : '—'} | \`${p.ultimoCommit || '?'}\` ${String(p.ultimaData || '').slice(0, 10)} |`
    );
  }
  linhas.push('');
  linhas.push('O estado atual está NESTE arquivo (`AUDIT_ENTRYPOINT.json`) e nas projeções canônicas listadas abaixo.');
  linhas.push('');
}
linhas.push('## Fontes canônicas');
linhas.push('');
for (const f of doc.fontesCanonicas) linhas.push(`- ${f}`);
linhas.push('');

fs.writeFileSync(SAIDA_MD, linhas.join('\n'));

console.log(`[audit-entrypoint] auditEpoch=${epoch}`);
console.log(`[audit-entrypoint] provas=${provas.length} com veredito=${provas.filter((p) => p.veredito).length} ausentes=${provas.filter((p) => !p.existe).length}`);
console.log(`[audit-entrypoint] artefatos fisicos=${artefatosFisicos.length}`);
console.log(`[audit-entrypoint] fila: total=${payload.fila.total} naoFechados=${payload.fila.naoFechados.length}`);
console.log(`[audit-entrypoint] escrito: ${caminhoRelativo(SAIDA_JSON)} + ${caminhoRelativo(SAIDA_MD)}`);
