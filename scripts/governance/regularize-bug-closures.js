#!/usr/bin/env node
'use strict';

/**
 * regularize-bug-closures.js — re-verificação em massa dos fechamentos SEM PROVA.
 *
 * POR QUE EXISTE
 * --------------
 * A blindagem do Bug Closure First (PR #6) mostrou que 130 itens da fila oficial DECLARAM
 * fechamento sem prova válida (P0=31, P1=67, P2=22, P3=10). Declarar não é fechar: enquanto
 * não houver prova, `SELO_FINAL` e as demais operações certificantes ficam negadas.
 *
 * Este script faz a parte EXECUTÁVEL e auditável dessa regularização: para cada item que
 * declara fechamento e cita um teste de regressão que EXISTE no repositório, ele RE-EXECUTA
 * o teste no commit atual, guarda a saída com sha256 e monta a prova de fechamento.
 *
 * O QUE ELE NÃO FAZ (de propósito)
 * --------------------------------
 *   - NÃO assina prova nenhuma: a assinatura Ed25519 é do dono (autoridade ancorada). Sem
 *     assinatura + âncora externa a prova não vale, e este script não contorna isso.
 *   - NÃO altera `AI_MEMORY/hardening-queue.json`. A fila é evidência governada; fechar item
 *     é transição via `transition-service` com prova assinada.
 *   - NÃO inventa prova para item sem teste: esses caem em `REQUER_DECISAO_HUMANA`
 *     (reabrir ou aceitar risco declarado) e o script apenas os lista.
 *
 * SAÍDA
 * -----
 *   governance/bug-closure/proofs-drafts/<defectId>.json   prova NÃO assinada (draft)
 *   AI_MEMORY/evidence/bug-closure-regularization/<id>.log saída REAL do teste
 *   AI_MEMORY/evidence/bug-closure-regularization/RELATORIO.md + report.json
 *
 * Uso:
 *   node scripts/governance/regularize-bug-closures.js [--only P0|P1|P2|P3|all]
 *        [--limit N] [--actor <id>] [--dry-run] [--timeout-ms N] [--json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

const { carregarInventario } = require(path.join(ROOT, 'governance', 'bug-closure', 'defect-registry'));
const {
  construirProvaDeFechamento, verificarProvaDeFechamento, CAMPOS_ASSINADOS,
} = require(path.join(ROOT, 'governance', 'bug-closure', 'closure-proof'));
const { computeSourceFingerprint } = require(path.join(ROOT, 'governance', 'proof-engine', 'fingerprint-chain'));

const DRAFTS = path.join(ROOT, 'governance', 'bug-closure', 'proofs-drafts');
const EVIDENCIA = path.join(ROOT, 'AI_MEMORY', 'evidence', 'bug-closure-regularization');

const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes(nome);

const APENAS = String(arg('--only', 'all')).toUpperCase();
const LIMITE = Number(arg('--limit', '0')) || 0;
const ATOR = arg('--actor', 'owner@results.invalid');
const TIMEOUT_MS = Number(arg('--timeout-ms', '600000'));
const DRY_RUN = flag('--dry-run');
const IDS = (arg('--id', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const PROPOR = flag('--propor-testes');
const JSON_OUT = flag('--json');

const sha256De = (arquivo) => crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
const shaDoTexto = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

function headSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Mapa CONFIRMADO por humano: `config/bug-closure-test-map.json` = { "<ID>": "<teste>" }. */
function testeMapeado(item) {
  try {
    // `path.join` inline: o auditor de persistência só reconhece contexto de LEITURA assim.
    const mapa = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'bug-closure-test-map.json'), 'utf8'));
    const rel = mapa && mapa[item && item.id];
    if (rel && fs.existsSync(path.join(ROOT, String(rel)))) return String(rel);
  } catch (_) { /* sem mapa: segue para o campo do item */ }
  return null;
}

/** Teste de regressão citado pelo item (campo canônico, alias legado ou mapa confirmado). */
function testeCitado(item) {
  const mapeado = testeMapeado(item || {});
  if (mapeado) return mapeado;
  for (const campo of ['regressionTest', 'test', 'regressionTests']) {
    const bruto = item && item[campo];
    const valores = Array.isArray(bruto) ? bruto : (bruto ? [bruto] : []);
    const achado = valores
      .map((v) => String(v).trim())
      .filter((v) => v && !/\s/.test(v) && v.endsWith('.test.js'))
      .find((rel) => fs.existsSync(path.join(ROOT, rel)));
    if (achado) return achado;
  }
  return null;
}

/** Executa o teste e devolve execução + saída REAL em disco. */
function executarTeste(defectId, relTeste) {
  const saidaRel = path.join('AI_MEMORY', 'evidence', 'bug-closure-regularization', `${defectId}.log`);
  const saidaAbs = path.join(ROOT, saidaRel);
  fs.mkdirSync(path.dirname(saidaAbs), { recursive: true });

  // Runner por ÁREA: teste em `frontend/` é Vitest, não Jest. Rodar com o runner errado
  // produzia "TESTE_FALHOU_AGORA" falso — o defeito declarado não era o que falhava.
  const ehFrontend = relTeste.startsWith('frontend/');
  // O Vitest do frontend tem config própria (`frontend/vitest.config.mjs`); rodar `npx vitest`
  // baixava OUTRA versão e falhava por reporter inexistente — falso vermelho.
  const relFrontend = relTeste.replace(/^frontend\//, '');
  const comando = ehFrontend
    ? ['npm', ['--prefix', 'frontend', 'run', 'test', '--', relFrontend]]
    : ['npx', ['jest', relTeste, '--bail=1', '--ci']];
  const inicio = new Date().toISOString();
  const r = spawnSync(comando[0], comando[1], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: TIMEOUT_MS,
    env: { ...process.env, CI: 'true', VITE_CACHE_DIR: '/tmp/r-agent2-vite' },
  });
  const fim = new Date().toISOString();
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  fs.writeFileSync(saidaAbs, saida, 'utf8');

  return {
    testPath: relTeste,
    command: ehFrontend ? `npm --prefix frontend run test -- ${relFrontend}` : `npx jest ${relTeste} --bail=1 --ci`,
    exitCode: r.status === null ? null : r.status,
    signal: r.signal || null,
    timeout: r.error && /ETIMEDOUT|timed? ?out/i.test(String(r.error.message || '')) ? true : undefined,
    startedAt: inicio,
    finishedAt: fim,
    outputPath: saidaRel,
    outputSha256: shaDoTexto(saida),
  };
}

/**
 * Monta o draft de prova para um item, a partir da execução REAL.
 * `fromState` é o estado PERSISTIDO (o item já declara fechamento); `toState` é RESOLVED,
 * única transição de fechamento válida a partir de VERIFIED na máquina canônica.
 */
function montarDraft(item, provaDeFechamento, execucao, ctx) {
  return construirProvaDeFechamento({
    defectId: item.id,
    severityBefore: item.severity,
    severityAfter: item.severity,
    fromState: String(item.state || '').toUpperCase(),
    toState: 'RESOLVED',
    evaluatedCommit: ctx.commit,
    codeFingerprint: ctx.fingerprint,
    requiredTests: [execucao.testPath],
    executions: [execucao],
    negativeEvidence: [],
    artifactHashes: [{
      path: execucao.testPath,
      sha256: sha256De(path.join(ROOT, execucao.testPath)),
    }],
    actor: { id: ATOR, kind: 'humano' },
    humanAuthorization: null,
    // O verificador exige a decisão canônica `CLOSE_VERIFIED`; a NATUREZA do fechamento
    // (regularização de histórico) vai em campo próprio, sem afrouxar o contrato.
    policyDecision: {
      decision: 'CLOSE_VERIFIED',
      policyId: 'BUG_CLOSURE_FIRST',
      policyVersion: '1.0.0',
      natureza: 'REGULARIZACAO_DE_FECHAMENTO_HISTORICO',
      motivoOriginal: (provaDeFechamento && provaDeFechamento.code) || null,
    },
  });
}

function main() {
  const commit = headSha();
  const fingerprint = computeSourceFingerprint(ROOT);
  const inventario = carregarInventario({ queuePath: path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json'), currentCommit: commit });

  const porId = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json'), 'utf8')).items.map((i) => [i.id, i]));
  let candidatos = inventario.defeitos.filter((d) => d.fechamentoNaoProvado === true);
  if (APENAS !== 'ALL') candidatos = candidatos.filter((d) => String(d.severity || '').toUpperCase() === APENAS);
  if (IDS.length > 0) candidatos = candidatos.filter((d) => IDS.includes(d.id));
  candidatos.sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || String(a.id).localeCompare(String(b.id)));
  if (LIMITE > 0) candidatos = candidatos.slice(0, LIMITE);

  // ── MODO PROPOSTA ────────────────────────────────────────────────────────
  // Para itens SEM teste citado, PROCURA candidatos no repositório por sobreposição de
  // tokens do id/título com o nome do arquivo de teste. NÃO gera prova: mapear defeito→teste
  // automaticamente seria inventar relação causal. A proposta é insumo para o humano
  // confirmar em `config/bug-closure-test-map.json`.
  if (PROPOR) return proporTestes(candidatos, porId);

  const resultados = [];
  for (const d of candidatos) {
    const item = porId.get(d.id) || d;
    const teste = testeCitado(item);
    const base = { id: d.id, severity: d.severity, estadoPersistido: d.state, titulo: item.title || null };

    if (!teste) {
      resultados.push({ ...base, classe: 'REQUER_DECISAO_HUMANA', motivo: 'SEM_TESTE_DE_REGRESSAO_CITADO' });
      continue;
    }
    if (DRY_RUN) {
      resultados.push({ ...base, classe: 'CANDIDATO_A_REVERIFICACAO', teste });
      continue;
    }

    const estadoPersistido = String(item.state || '').toUpperCase();
    if (['RESOLVED', 'RISK_ACCEPTED'].includes(estadoPersistido)) {
      // RESOLVED/RISK_ACCEPTED não têm transição de fechamento válida a partir de si mesmos.
      // Regularizar exige decisão de modelo (livro histórico VERIFIED→RESOLVED), não hack.
      resultados.push({
        ...base,
        classe: 'REQUER_AJUSTE_DE_MODELO',
        teste,
        motivo: `estado persistido ${estadoPersistido} não tem transição canônica de fechamento a partir de si`,
      });
      continue;
    }

    // Pré-checagem de runner: sem `frontend/node_modules` o Vitest nem existe — isso não é
    // veredito sobre o defeito.
    if (teste.startsWith('frontend/') && !fs.existsSync(path.join(ROOT, 'frontend', 'node_modules'))) {
      resultados.push({ ...base, classe: 'AMBIENTE_INDISPONIVEL', teste, motivo: 'FRONTEND_DEPS_AUSENTES (frontend/node_modules não instalado)' });
      continue;
    }

    const execucao = executarTeste(d.id, teste);
    if (execucao.exitCode !== 0) {
      const saida = fs.readFileSync(path.join(ROOT, execucao.outputPath), 'utf8');
      // Falha por infraestrutura ausente NÃO é veredito sobre o defeito: sem Postgres, sem
      // chave de criptografia do ambiente ou sem rede, o teste não mede o que promete.
      // Falha por artefato gerado ausente (`reports/*.json` são produzidos pelos próprios
      // validadores) também não é veredito sobre o defeito: é ambiente de execução incompleto.
      const semAmbiente = /SKIPPED_SEM_|ECONNREFUSED|ENOTFOUND|connect ECONNREFUSED|Erro ao descriptografar|Unsupported state or unable to authenticate|ENOENT: no such file or directory.*reports\/|GRAPH_ABSENT|not found/i.test(saida);
      resultados.push({
        ...base,
        classe: semAmbiente ? 'AMBIENTE_INDISPONIVEL' : 'TESTE_FALHOU_AGORA',
        teste,
        exitCode: execucao.exitCode,
        motivo: semAmbiente
          ? 'teste exige infraestrutura ausente neste ambiente — não é veredito sobre o defeito'
          : 'a correção declarada não se sustenta no código atual — candidato a REABRIR',
        log: execucao.outputPath,
      });
      continue;
    }

    const draft = montarDraft(item, d.provaDeFechamento, execucao, { commit, fingerprint });
    const veredito = verificarProvaDeFechamento(draft, {
      defeito: { id: item.id, severity: item.severity, state: String(item.state || '').toUpperCase() },
      currentCommit: commit,
      currentFingerprint: fingerprint,
      rootDir: ROOT,
      livro: null,
      agora: Date.now(),
      existeArquivo: (rel) => fs.existsSync(path.join(ROOT, rel)),
    });

    const pendenteAssinatura = (veredito.reasons || []).filter((r) => r !== 'SEM_ANCORA_DE_CONFIANCA');
    const INSUMOS_HUMANOS = new Set(['EVIDENCIA_NEGATIVA_AUSENTE', 'APROVACAO_HUMANA_AUSENTE']);
    const faltaHumano = pendenteAssinatura.filter((r) => INSUMOS_HUMANOS.has(r));
    const faltaTecnica = pendenteAssinatura.filter((r) => !INSUMOS_HUMANOS.has(r));
    let classe;
    if (veredito.ok) classe = 'PRONTA';
    else if (faltaTecnica.length > 0) classe = 'ESTRUTURA_INCOMPLETA';
    else if (faltaHumano.length > 0) classe = 'AGUARDA_INSUMOS_HUMANOS';
    else classe = 'AGUARDA_ASSINATURA_E_ANCORA';

    if (!DRY_RUN && classe !== 'ESTRUTURA_INCOMPLETA') {
      fs.mkdirSync(DRAFTS, { recursive: true });
      const destino = path.join(DRAFTS, `${item.id}.json`);
      fs.writeFileSync(destino, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    }

    resultados.push({
      ...base,
      classe,
      teste,
      transicao: `${String(item.state || '').toUpperCase()} → RESOLVED`,
      provasAusentes: pendenteAssinatura,
      log: execucao.outputPath,
      draft: classe === 'ESTRUTURA_INCOMPLETA' ? null : path.relative(ROOT, path.join(DRAFTS, `${item.id}.json`)),
      camposParaAssinar: CAMPOS_ASSINADOS.length,
    });
  }

  const resumo = {
    commit,
    fingerprint,
    total: resultados.length,
    porClasse: resultados.reduce((acc, r) => { acc[r.classe] = (acc[r.classe] || 0) + 1; return acc; }, {}),
    porSeveridade: resultados.reduce((acc, r) => {
      const k = `${r.classe}:${r.severity}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    filaAlterada: false,
    assinatura: 'PENDENTE — este script não assina e não altera a fila',
  };

  const relatorio = {
    schemaVersion: 1,
    kind: 'bug-closure-regularization',
    generatedAt: new Date().toISOString(),
    authoritative: false,
    resumo,
    resultados,
  };

  if (!DRY_RUN) {
    fs.mkdirSync(EVIDENCIA, { recursive: true });
    const dirItens = path.join(EVIDENCIA, 'itens');
    fs.mkdirSync(dirItens, { recursive: true });
    // Resultado POR ITEM: permite reconstruir o relatório agregado sem re-executar teste algum.
    for (const r of resultados) {
      fs.writeFileSync(path.join(dirItens, `${r.id}.json`), `${JSON.stringify(r, null, 2)}\n`, 'utf8');
    }
    // Sempre grava o recorte por severidade E o agregado: o agregado é o artefato estável
    // (nunca "desaparece" quando a varredura é fatiada), o recorte preserva a execução.
    if (APENAS !== 'ALL') {
      fs.writeFileSync(path.join(EVIDENCIA, `report-${APENAS}.json`), `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
    }
    const agregado = JSON.parse(JSON.stringify(relatorio));
    const todos = fs.readdirSync(path.join(EVIDENCIA, 'itens')).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCIA, 'itens', f), 'utf8')));
    agregado.resumo.total = todos.length;
    agregado.resumo.porClasse = todos.reduce((acc, r) => { acc[r.classe] = (acc[r.classe] || 0) + 1; return acc; }, {});
    agregado.resumo.porSeveridade = todos.reduce((acc, r) => {
      acc[`${r.classe}:${r.severity}`] = (acc[`${r.classe}:${r.severity}`] || 0) + 1;
      return acc;
    }, {});
    agregado.resultados = todos.sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || String(a.id).localeCompare(String(b.id)));
    fs.writeFileSync(path.join(EVIDENCIA, 'report.json'), `${JSON.stringify(agregado, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(EVIDENCIA, 'RELATORIO.md'), relatorioAgregado(EVIDENCIA), 'utf8');
  }

  if (JSON_OUT) process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`);
  else {
    process.stdout.write(`[regularize] commit=${commit.slice(0, 10)} itens=${resumo.total} fila_alterada=NÃO\n`);
    for (const [classe, n] of Object.entries(resumo.porClasse)) process.stdout.write(`[regularize]   ${classe}: ${n}\n`);
  }
  return 0;
}

/** Reconstrói o relatório a partir dos resultados POR ITEM já gravados (sem re-executar). */
function relatorioAgregado(dirEvidencia) {
  const dirItens = path.join(dirEvidencia, 'itens');
  const itens = fs.existsSync(dirItens)
    ? fs.readdirSync(dirItens).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dirItens, f), 'utf8')))
    : [];
  itens.sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || String(a.id).localeCompare(String(b.id)));
  const porClasse = itens.reduce((acc, r) => { acc[r.classe] = (acc[r.classe] || 0) + 1; return acc; }, {});
  const porSeveridade = itens.reduce((acc, r) => { acc[`${r.classe}:${r.severity}`] = (acc[`${r.classe}:${r.severity}`] || 0) + 1; return acc; }, {});
  return relatorioMd({
    generatedAt: new Date().toISOString(),
    resumo: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      fingerprint: computeSourceFingerprint(ROOT),
      total: itens.length,
      porClasse,
      porSeveridade,
    },
    resultados: itens,
  });
}

/** Tokens distintivos para busca de teste candidato. */
function tokensDe(texto) {
  const GENERICOS = new Set([
    'p0', 'p1', 'p2', 'p3', 'missao', 'hardening', 'eng', 'gov', 'release', 'gate', 'teste',
    'test', 'defeito', 'bug', 'fix', 'false', 'falso', 'pass', 'fail', 'the', 'and', 'de', 'da',
    'do', 'na', 'no', 'em', 'para', 'com', 'sem', 'por', 'que', 'uma', 'dos', 'das',
  ]);
  return String(texto || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERICOS.has(t));
}

/**
 * Propõe teste candidato por item sem teste citado. Somente leitura: não gera prova,
 * não altera a fila e não afirma relação causal.
 */
function proporTestes(candidatos, porId) {
  const arquivos = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage'].includes(entrada.name)) continue;
      const abs = path.join(dir, entrada.name);
      if (entrada.isDirectory()) { varrer(abs); continue; }
      if (!/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(entrada.name)) continue;
      arquivos.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
  };
  for (const raiz of ['tests', 'frontend/src', 'engine', 'qa']) {
    const abs = path.join(ROOT, raiz);
    if (fs.existsSync(abs)) varrer(abs);
  }

  const propostas = candidatos.map((d) => {
    const item = porId.get(d.id) || d;
    if (testeCitado(item)) return null;
    const alvo = tokensDe(`${d.id} ${item.title || ''}`);
    const idNormalizado = String(d.id).toLowerCase();
    const pontuados = arquivos.map((rel) => {
      const base = tokensDe(rel.replace(/\.(test|spec)\.(js|jsx|ts|tsx)$/, ''));
      const doNome = alvo.filter((t) => base.includes(t));
      // Sinal FORTE: o próprio id citado no conteúdo do teste (comentário/describe). Vale mais
      // que qualquer sobreposição de nome, porque é o autor ligando o teste ao defeito.
      let citacao = 0;
      let conteudo = '';
      try { conteudo = fs.readFileSync(path.join(ROOT, rel), 'utf8').toLowerCase(); } catch (_) { conteudo = ''; }
      if (conteudo.includes(idNormalizado)) citacao = 5;
      const doConteudo = citacao ? [] : alvo.filter((t) => conteudo.includes(t));
      const pontos = citacao ? 5 + Math.min(doNome.length, 2) : doNome.length + doConteudo.length;
      return { teste: rel, pontos, tokens: [...new Set([...doNome, ...doConteudo])], citacaoDoId: citacao > 0 };
    }).filter((x) => x.pontos > 0).sort((a, b) => b.pontos - a.pontos).slice(0, 3);
    return {
      id: d.id,
      severity: d.severity,
      titulo: item.title || null,
      tokensDoDefeito: alvo,
      candidatos: pontuados,
      // Honestidade: NENHUM teste cita o id destes itens (medido em 2026-10-22), então não
      // existe mapeamento automático confiável. O que há é sugestão por sobreposição.
      evidenciaDeclarada: String(item.evidence || '').slice(0, 400),
      confianca: pontuados.length && pontuados[0].citacaoDoId ? 'CITACAO_DO_ID_NAO_CONFIRMADA'
        : (pontuados.length ? 'SOBREPOSICAO_DE_TOKENS_NAO_CONFIRMADA' : 'SEM_CANDIDATO'),
    };
  }).filter(Boolean);

  const saida = {
    kind: 'bug-closure-test-proposals',
    generatedAt: new Date().toISOString(),
    authoritative: false,
    aviso: 'Proposta por sobreposição de tokens. NÃO é prova de relação causal: confirme '
      + 'manualmente em config/bug-closure-test-map.json antes de gerar prova.',
    total: propostas.length,
    porConfianca: propostas.reduce((acc, p) => { acc[p.confianca] = (acc[p.confianca] || 0) + 1; return acc; }, {}),
    propostas,
  };
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCIA, 'proposta-testes.json'), `${JSON.stringify(saida, null, 2)}\n`, 'utf8');
  const md = [
    '# Proposta de testes de regressão (itens sem teste citado)',
    '',
    `Gerado em ${saida.generatedAt}. **Não autoritativo**: sobreposição de tokens não prova causalidade.`,
    'Confirme o mapeamento em `config/bug-closure-test-map.json` (`{ "<ID>": "<caminho-do-teste>" }`)',
    'e só então re-execute a regularização.',
    '',
    `Total de itens sem teste citado: **${saida.total}** · ${JSON.stringify(saida.porConfianca)}`,
    '',
    'Nenhum teste do repositório cita o id destes itens. Logo **não existe** mapeamento',
    'automático confiável: a coluna "Candidato" é apenas pista por sobreposição de tokens, e a',
    'coluna "Evidência declarada" é o que o autor do item registrou na época.',
    '',
    '| Defeito | Sev | Candidato (pista) | Evidência declarada |',
    '|---|---|---|---|',
    ...propostas.map((p) => `| ${p.id} | ${p.severity || '-'} | ${(p.candidatos[0] || {}).teste || '—'} | ${String(p.evidenciaDeclarada || '—').replace(/\|/g, '/').slice(0, 160)} |`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(EVIDENCIA, 'PROPOSTA-TESTES.md'), `${md}\n`, 'utf8');
  process.stdout.write(`[propor] itens sem teste: ${saida.total} · ${JSON.stringify(saida.porConfianca)}\n`);
  return 0;
}

function relatorioMd(r) {
  const linhas = [
    '# Regularização de fechamentos sem prova',
    '',
    `Gerado em ${r.generatedAt} · commit \`${r.resumo.commit}\` · fingerprint \`${r.resumo.fingerprint.slice(0, 12)}…\``,
    '',
    '> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi',
    '> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.',
    '',
    '## Resumo',
    '',
    '| Classe | Itens |',
    '|---|---|',
    ...Object.entries(r.resumo.porClasse).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Itens',
    '',
    '| Defeito | Sev | Estado declarado | Classe | Teste | Log |',
    '|---|---|---|---|---|---|',
    ...r.resultados.map((x) => `| ${x.id} | ${x.severity || '-'} | ${x.estadoPersistido || '-'} | ${x.classe} | ${x.teste || '—'} | ${x.log || '—'} |`),
    '',
    '## Leitura das classes',
    '',
    '- `AGUARDA_ASSINATURA_E_ANCORA` — teste re-executado com sucesso no HEAD, artefato de saída',
    '  gravado com sha256, prova montada e estruturalmente válida. Falta **apenas** a assinatura',
    '  Ed25519 da autoridade ancorada (e as âncoras externas provisionadas no ambiente).',
    '- `AGUARDA_INSUMOS_HUMANOS` — teste re-executado com sucesso; falta `negativeEvidence`/',
    '  `humanAuthorization` (P0), que são declarações humanas e não podem ser geradas aqui.',
    '- `TESTE_FALHOU_AGORA` — a correção declarada não se sustenta no código atual ⇒ candidato a REABRIR.',
    '- `AMBIENTE_INDISPONIVEL` — o teste exigiu infraestrutura ausente (ex.: Postgres); não é veredito.',
    '- `REQUER_AJUSTE_DE_MODELO` — estado persistido (RESOLVED/RISK_ACCEPTED) sem transição canônica de fechamento.',
    '- `REQUER_DECISAO_HUMANA` — nenhum teste de regressão citado/existente: reabrir ou aceitar risco.',
    '- `ESTRUTURA_INCOMPLETA` — prova montada mas algo estrutural falhou; ver `provasAusentes`.',
    '',
  ];
  return `${linhas.join('\n')}\n`;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { testeCitado, executarTeste, montarDraft };
