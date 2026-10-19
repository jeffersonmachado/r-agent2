#!/usr/bin/env node
'use strict';

/**
 * Gate da branch de desenvolvimento auditável (`dev/engineering-hardening`),
 * agora em FASES com autorização prévia por elegibilidade (BUG CLOSURE FIRST).
 *
 * POR QUE EXISTE
 * --------------
 * DEFEITO MEDIDO (2026-10-16): nenhum workflow do repositório dispara para
 * `dev/engineering-hardening` (`jest.yml` e `release-governance.yml` listam apenas
 * `main`, `develop`, `release/**`, `hotfix/**`):
 *
 *     gh run list --branch dev/engineering-hardening   ->   []
 *
 * E o runner do GitHub não inicia jobs (limite de gastos da conta):
 *
 *     gh run view 38881780959  ->  "The job was not started because an Actions
 *     budget is preventing further use."
 *
 * Um workflow que não roda não é gate. A proteção EFETIVA é este runner LOCAL.
 *
 * O QUE MUDOU NESTA VERSÃO (missão BUG CLOSURE FIRST, 2026-10-17)
 * --------------------------------------------------------------
 * A versão anterior rodava TODOS os passos de uma vez (L0 completo + 7 gates de
 * governança) independentemente do estado dos defeitos. Isso é exatamente o que a
 * missão proíbe: "nenhum mecanismo de engenharia poderá executar processos de
 * validação extensivos, convergência completa, QA Waves massivas, replay de
 * certificação, selagem ou empacotamento enquanto existirem defeitos P0 ou P1
 * bloqueantes".
 *
 * Agora o gate é sequencial e cada fase pede AUTORIZAÇÃO ao motor de
 * elegibilidade (`governance/bug-closure/eligibility.js`) antes de começar:
 *
 *   A  pré-voo      — identidade do commit, inventário de defeitos, árvore de
 *                     trabalho, dependências, regras preventivas, evidência velha
 *   B  direcionado  — testes de regressão declarados pelos defeitos em escopo
 *   C  L0           — suíte oficial (`npm test`)        exige L0_COMPLETO
 *   D  L1           — gates de governança offline       exige L1_AMPLO
 *   E  L2/L3        — `test:system` (extensivo)         exige L2_L3_EXTENSIVO
 *   F  release      — gate agregado (63 passos)         exige SELO_FINAL
 *
 * Se a autorização for NEGADA, o gate PARA naquele ponto e o veredito é
 * `BLOQUEADO_POR_DEFEITOS` (exit 2). Ele não "pula" a validação e não inventa
 * aprovação: o que não rodou não conta como verde.
 *
 * Escopo parcial (`--rapido`, `--fases`) NUNCA produz `PASS`: produz
 * `PASS_PARCIAL` com `equivalenteAValidacaoCompleta: false`. É a correção do
 * defeito de "modo rápido parece validação completa".
 *
 * O QUE ESTE RUNNER NUNCA FAZ
 * ---------------------------
 *  - não publica release, não cria tag, não faz push, não faz deploy, não
 *    empacota (`zip:release` fica fora daqui de propósito);
 *  - não lê segredo algum e não imprime variável de ambiente;
 *  - não altera artefato governado (só leitura + os dois relatórios abaixo).
 *
 * SAÍDA
 * -----
 *  - `reports/dev-branch-ci-evidence.json` (máquina, .gitignore);
 *  - `AI_MEMORY/evidence/dev-branch-ci-<sha-curto>-<escopo>.md` (versionado).
 *
 * Uso:
 *   node scripts/ci/dev-branch-gate.js [--out <json>] [--espera-sha <sha>]
 *                                      [--escopo <defeito[,defeito]>]
 *                                      [--fases A,B,C,D,E,F] [--rapido]
 *                                      [--requer-limpo] [--extensivo]
 *
 * Códigos de saída: 0 = PASS/PASS_PARCIAL, 1 = FAIL, 2 = BLOQUEADO_POR_DEFEITOS.
 */

const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const { evaluateExecutionEligibility, OPERACOES } = require('../../governance/bug-closure/eligibility');
const { carregarInventario } = require('../../governance/bug-closure/defect-registry');
const { ESTADOS } = require('../../governance/bug-closure/defect-states');

/**
 * Passos de cada fase técnica.
 *
 * L1 = gates de governança que não dependem de infraestrutura viva (Postgres,
 * Redis, browser) e que decidem sobre o estado REAL medido em disco.
 * A ordem importa: primeiro o que quebra por código, depois o que quebra por
 * governança — assim o primeiro erro exibido é o mais acionável.
 */
const PASSOS = Object.freeze({
  C: [
    {
      id: 'L0-suite-oficial',
      nivel: 'L0',
      comando: 'npm test',
      descricao: 'Suíte oficial Jest (unit + flow + rpa sem browser)',
      // MEDIDO (2026-10-18): a suíte oficial passou de 20 min e o passo foi morto com
      // exit=null; o veredito saía FAIL — um TIMEOUT era reportado como se fosse defeito.
      // Duas correções: orçamento real (ver `executar`) e timeout NÃO é FAIL. O default
      // sobe para 45 min (a suíte roda unit + flow + rpa:jest de uma vez) e pode ser
      // ajustado por `L0_ORCAMENTO_MS` — sempre auditável no relatório.
      orcamentoMs: Number(process.env.L0_ORCAMENTO_MS) || 45 * 60 * 1000,
    },
  ],
  D: [
    {
      id: 'L1-cadeia-criptografica',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-governance-chain.js',
      descricao: 'Cadeia de governança RECALCULADA dos bytes atuais (e declaração auditável)',
      orcamentoMs: 120 * 1000,
    },
    {
      id: 'L1-self-proving',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-self-proving.js',
      descricao: 'Self-proving sobre a cadeia recalculada',
      orcamentoMs: 120 * 1000,
    },
    {
      id: 'L1-release-dag',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-release-dag.js',
      descricao: 'DAG do release sem ciclo e sem violação de ordem de fase',
      orcamentoMs: 120 * 1000,
    },
    {
      id: 'L1-decisao-canonica',
      nivel: 'L1',
      comando: 'node scripts/governance/assert-canonical-release-decision.js',
      descricao: 'Decisão canônica de release (autoridade única) coerente com os artefatos',
      orcamentoMs: 120 * 1000,
    },
    {
      id: 'L1-fila-oficial',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-hardening-queue.js',
      descricao: 'Fila oficial de hardening sem item aberto nem estado não canônico',
      orcamentoMs: 60 * 1000,
    },
    {
      id: 'L1-ai-memory',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-ai-memory.js',
      descricao: 'Memória operacional íntegra',
      orcamentoMs: 60 * 1000,
    },
    {
      id: 'L1-aderencia-agente',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-agent-adherence.js',
      descricao: 'Aderência do agente à Constituição',
      orcamentoMs: 60 * 1000,
    },
  ],
  E: [
    {
      id: 'L2-test-system',
      nivel: 'L2',
      comando: 'npm run test:system',
      descricao: 'Contratos, governança, CI, runtime, organizacional, stress e rate-limit',
      orcamentoMs: 40 * 60 * 1000,
    },
  ],
  F: [
    {
      id: 'L3-gate-agregado',
      nivel: 'L3',
      comando: 'npm run validate:governance-enforcement',
      descricao: 'Gate agregado de governança (63 passos)',
      orcamentoMs: 90 * 60 * 1000,
    },
  ],
});

/** Operação de elegibilidade exigida para começar cada fase. */
const AUTORIZACAO_DA_FASE = Object.freeze({
  A: null, // pré-voo é diagnóstico: nunca é bloqueado
  B: OPERACOES.TESTES_NEGATIVOS_REGRESSAO,
  C: OPERACOES.L0_COMPLETO,
  D: OPERACOES.L1_AMPLO,
  E: OPERACOES.L2_L3_EXTENSIVO,
  F: OPERACOES.SELO_FINAL,
});

/** Arquivos cuja existência é regra preventiva (defeito corrigido não volta a existir mudo). */
const REGRAS_PREVENTIVAS = Object.freeze([
  'governance/RAP_AGENT_CONSTITUTION.md',
  'config/journey-criticality.json',
  'governance/bug-closure/defect-states.js',
  'governance/bug-closure/eligibility.js',
  'scripts/governance/evaluate-execution-eligibility.js',
  'tests/unit/governance/governanceChainContract.test.js',
  'tests/unit/governance/bugClosureFirst.test.js',
]);

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function executar(passo) {
  const inicio = Date.now();
  // O ORÇAMENTO PRECISA MATAR O PROCESSO. Com `shell: true`, o `timeout` do spawnSync
  // encerrava apenas o shell e deixava o processo filho vivo — medido: passo com orçamento
  // de 20 min levou 1670,7s e ainda assim sobrou processo. `timeout(1)` do coreutils encerra
  // o GRUPO do comando: o orçamento passa a ser real, e o exit 124 identifica o estouro.
  const orcamentoSeg = Math.max(1, Math.round(Number(passo.orcamentoMs || 0) / 1000));
  const comandoComOrcamento = orcamentoSeg > 0
    ? `timeout -k 15 ${orcamentoSeg} ${passo.comando}`
    : passo.comando;
  const r = spawnSync(comandoComOrcamento, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    // Backstop: se até o `timeout` falhar, o spawnSync encerra.
    timeout: Number(passo.orcamentoMs || 0) + 30 * 1000,
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const exitCode = r.status === null ? null : r.status;
  // 124 = timeout(1); 137 = SIGKILL. Ambos são "sem veredito", nunca "reprovado".
  const estourouOrcamento = exitCode === 124 || exitCode === 137 || r.status === null;
  return {
    id: passo.id,
    fase: passo.fase,
    nivel: passo.nivel,
    descricao: passo.descricao,
    comando: passo.comando,
    orcamentoMs: Number(passo.orcamentoMs || 0) || null,
    // `status === null` significa morte por sinal/timeout: NUNCA é sucesso.
    exitCode: estourouOrcamento ? null : exitCode,
    timeout: estourouOrcamento,
    duracaoMs: Date.now() - inicio,
    sha256Saida: sha256(saida),
    saidaFinal: saida.trim().split('\n').slice(-12).join('\n'),
  };
}

/**
 * FASE A — pré-voo. Só leitura; qualquer item aqui é barato e acionável.
 */
function preVoo({ esperaSha, requerLimpo, sha, branch }) {
  const achados = [];
  const checks = [];

  const registrar = (id, ok, detalhe) => {
    checks.push({ id, ok, detalhe });
    if (!ok) achados.push({ code: id, detail: detalhe });
    return ok;
  };

  /** Check informativo: reprovado NÃO bloqueia a fase (ex.: evidência velha). */
  const registrarNota = (id, ok, detalhe) => {
    checks.push({ id, ok, detalhe, bloqueante: false });
  };

  registrar('A1-identidade-commit', Boolean(sha) && sha.length === 40, `HEAD=${sha}`);

  if (esperaSha) {
    registrar('A2-sha-esperado', esperaSha === sha, `esperado=${esperaSha} atual=${sha}`);
  } else {
    checks.push({ id: 'A2-sha-esperado', ok: true, detalhe: 'não exigido nesta execução' });
  }

  const limpo = git(['status', '--porcelain']) || '';
  const sujo = limpo.length > 0;
  const arquivosSujos = sujo ? limpo.split('\n').slice(0, 20) : [];
  if (requerLimpo) {
    registrar('A3-arvore-limpa', !sujo, sujo ? `${arquivosSujos.length}+ arquivo(s) não commitado(s)` : 'limpa');
  } else {
    checks.push({
      id: 'A3-arvore-limpa',
      ok: true,
      detalhe: sujo ? `NÃO exigida nesta execução; árvore SUJA (${arquivosSujos.length}+)` : 'limpa',
    });
  }

  // Inventário de defeitos: ausência de fila NUNCA vira "sem defeitos".
  let inventario = null;
  let erroInventario = null;
  try {
    inventario = carregarInventario();
    registrar('A4-inventario-defeitos', true, `${inventario.resumo.total} item(ns)`);
  } catch (e) {
    erroInventario = String(e.message || e);
    registrar('A4-inventario-defeitos', false, erroInventario);
  }

  // Dependências mínimas para rodar L0.
  registrar('A5-dependencias', fs.existsSync(path.join(ROOT, 'node_modules')),
    fs.existsSync(path.join(ROOT, 'node_modules')) ? 'node_modules presente' : 'node_modules AUSENTE (npm ci)');
  registrar('A5b-jest', fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'jest')),
    'binário do Jest');

  const versaoNode = process.versions.node || '';
  const [nMajor, nMinor] = versaoNode.split('.').map(Number);
  const nodeOk = (nMajor === 20 && nMinor >= 19) || (nMajor === 22 && nMinor >= 12) || nMajor > 22;
  registrar('A6-node', nodeOk, `node ${versaoNode}`);

  // Regras preventivas: cada defeito fechado deixa um arquivo que o mantém fechado.
  const ausentes = REGRAS_PREVENTIVAS.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  registrar('A7-regras-preventivas', ausentes.length === 0, ausentes.length ? `ausentes: ${ausentes.join(', ')}` : `${REGRAS_PREVENTIVAS.length} presentes`);

  // Evidência velha: relatório anterior de OUTRO commit não pode ser confundido com atual.
  let evidenciaAnterior = null;
  const caminhoEvidencia = path.join(ROOT, 'reports', 'dev-branch-ci-evidence.json');
  if (fs.existsSync(caminhoEvidencia)) {
    try {
      const anterior = JSON.parse(fs.readFileSync(caminhoEvidencia, 'utf8'));
      evidenciaAnterior = { sha: anterior.sha || null, veredito: anterior.veredito || null, escopo: anterior.escopo || null };
      registrarNota(
        'A8-evidencia-anterior',
        anterior.sha === sha,
        anterior.sha === sha ? 'do mesmo commit' : `de OUTRO commit (${String(anterior.sha).slice(0, 12)}) — STALE, não conta como evidência do código atual`
      );
    } catch (_) {
      registrarNota('A8-evidencia-anterior', false, 'relatório anterior ilegível — não conta');
    }
  } else {
    registrarNota('A8-evidencia-anterior', true, 'não existe relatório anterior');
  }

  // A9 — coerência de LINEAGE local: `governance/.current-run.json` (run aberto)
  // vs `dev/platform-readiness/latest.json` (projeção).
  //
  // INVESTIGAÇÃO 2026-10-17 (não presumir "drift ambiental"): o incidente que
  // deixou o teste `convergenceFixpoint` vermelho tinha causa concreta —
  // `create-governed-run` criou um run novo (11:18:58) e a projeção continuava
  // do run anterior (11:12:00); o ciclo de selagem foi interrompido ANTES da
  // fase que regenera a projeção. O invariante "projeção.runId == run.runId"
  // só vale depois que o produtor canônico roda — então o gate passa a MEDIR e
  // NOMEAR esse estado em vez de deixá-lo silencioso.
  try {
    const caminhoRun = path.join(ROOT, 'governance', '.current-run.json');
    const caminhoProjecao = path.join(ROOT, 'dev', 'platform-readiness', 'latest.json');
    if (fs.existsSync(caminhoRun) && fs.existsSync(caminhoProjecao)) {
      const run = JSON.parse(fs.readFileSync(caminhoRun, 'utf8'));
      const projecao = JSON.parse(fs.readFileSync(caminhoProjecao, 'utf8'));
      const fechado = ['SUPERSEDED', 'ABANDONED'].includes(String(run.status || '').toUpperCase());
      if (fechado) {
        // Run encerrado (close-run-context.js): coerência não é exigível, mas o
        // fechamento tem de estar DECLARADO — fechar não pode esconder divergência.
        const declarado = Boolean(run.closedAt && run.closedBy && run.closedReason && run.closedEvidence);
        registrarNota(
          'A9-lineage-run-projecao',
          declarado,
          declarado
            ? `run ${run.runId} FECHADO (${run.status}) com motivo e evidência declarados — projeção do último ciclo concluído`
            : `run ${run.runId} marcado ${run.status} SEM closedAt/closedBy/closedReason/closedEvidence`
        );
      } else {
        const coerente = run.runId === projecao.runId;
        registrarNota(
          'A9-lineage-run-projecao',
          coerente,
          coerente
            ? `projeção no run corrente (${run.runId})`
            : `PROJECAO_STALE: projeção=${projecao.runId} run=${run.runId} — conclua o ciclo (o produtor canônico regenera a projeção) ou encerre o run com scripts/governance/close-run-context.js`
        );
      }
    } else {
      registrarNota('A9-lineage-run-projecao', true, 'sem run aberto ou sem projeção (nada a comparar)');
    }
  } catch (erro) {
    registrarNota('A9-lineage-run-projecao', false, `ilegível: ${String(erro.message || erro).slice(0, 120)}`);
  }

  return {
    sha, branch, checks, achados,
    arvoreSuja: sujo,
    arquivosSujos,
    inventario: inventario
      ? {
        total: inventario.resumo.total,
        abertos: inventario.resumo.abertos,
        bloqueantesParaCertificacao: inventario.resumo.bloqueantesParaCertificacao,
        semSeveridadeAbertos: inventario.resumo.semSeveridadeAbertos,
        bloqueioExterno: inventario.resumo.bloqueioExterno,
        riscoAceito: inventario.resumo.riscoAceito,
        porEstado: inventario.resumo.porEstado,
        porSeveridade: inventario.resumo.porSeveridade,
      }
      : null,
    erroInventario,
    evidenciaAnterior,
  };
}

/**
 * FASE B — testes direcionados dos defeitos em escopo.
 *
 * Só roda os `regressionTest` declarados na fila para os itens em escopo (ou, sem
 * escopo, para os itens em FIXED_PENDING_VERIFICATION, que são exatamente os que
 * estão esperando verificação). Sem teste declarado não há o que executar — e o
 * relatório registra isso como achado, não como aprovação.
 */
function planejarFaseB(inventario, escopo) {
  if (!inventario) return { passos: [], semTeste: [], naoExecutada: 'INVENTARIO_AUSENTE' };
  const alvo = escopo && escopo.length
    ? inventario.defeitos.filter((d) => escopo.includes(d.id))
    : inventario.defeitos.filter((d) => d.state === ESTADOS.FIXED_PENDING_VERIFICATION);

  const semTeste = alvo.filter((d) => !d.regressionTest).map((d) => d.id);
  const testes = [...new Set(alvo.map((d) => d.regressionTest).filter(Boolean))];

  const passos = testes.map((alvoTeste, i) => ({
    id: `B${i + 1}-${String(alvoTeste).split('/').pop()}`.slice(0, 60),
    fase: 'B',
    nivel: 'B',
    comando: `npx jest ${alvoTeste} --bail=0`,
    descricao: `Teste de regressão declarado: ${alvoTeste}`,
    orcamentoMs: 10 * 60 * 1000,
  }));

  return { passos, semTeste, alvo: alvo.map((d) => d.id), naoExecutada: null };
}

/**
 * Sonda o estado do runner do GitHub. BEST-EFFORT de propósito: nenhuma decisão
 * de pass/fail depende dela (o gate é o resultado dos passos). O que ela impede
 * é afirmar "CI ativo" enquanto a conta está bloqueada.
 */
function sondarRunnerDoGithub(branch) {
  const r = spawnSync(
    `gh run list --branch ${branch} --limit 1 --json databaseId,conclusion,headSha,createdAt`,
    { cwd: ROOT, encoding: 'utf8', shell: true, timeout: 45 * 1000 }
  );
  if (r.status !== 0) {
    return {
      medido: false,
      motivo: 'gh indisponivel ou sem autenticacao nesta execucao',
      observado: (r.stderr || '').trim().split('\n').slice(-2).join(' ').slice(0, 200),
    };
  }
  let lista;
  try {
    lista = JSON.parse(r.stdout || '[]');
  } catch (_) {
    return { medido: false, motivo: 'saida do gh nao parseavel' };
  }
  if (!Array.isArray(lista) || lista.length === 0) {
    return { medido: true, execucoesNaBranch: 0, conclusao: 'NENHUMA_EXECUCAO' };
  }
  return {
    medido: true,
    execucoesNaBranch: lista.length,
    ultimaExecucao: {
      databaseId: lista[0].databaseId,
      headSha: lista[0].headSha,
      conclusao: lista[0].conclusion,
      criadaEm: lista[0].createdAt,
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const argDe = (nome, curto) => {
    const i = argv.findIndex((a) => a === nome || (curto && a === curto));
    return i >= 0 ? argv[i + 1] : null;
  };

  const rapido = argv.includes('--rapido');
  const requerLimpo = argv.includes('--requer-limpo');
  const extensivo = argv.includes('--extensivo');
  const esperaSha = argDe('--espera-sha') || process.env.DEV_BRANCH_GATE_ESPERA_SHA || null;
  const outJson = argDe('--out') || 'reports/dev-branch-ci-evidence.json';
  const escopoArg = argDe('--escopo');
  const escopo = escopoArg ? escopoArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

  const fasesPedidas = (argDe('--fases') || (extensivo ? 'A,B,C,D,E' : 'A,B,C,D'))
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    .filter((f) => Object.prototype.hasOwnProperty.call(AUTORIZACAO_DA_FASE, f));

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || '(desconhecida)';
  const sha = git(['rev-parse', 'HEAD']) || '';

  if (esperaSha && esperaSha !== sha) {
    process.stderr.write(
      `[dev-branch-gate] RECUSADO: HEAD=${sha} mas a execucao EXIGE ${esperaSha} — ` +
      'a evidencia seria vinculada ao commit errado.\n'
    );
    return 1;
  }

  process.stdout.write(`[dev-branch-gate] branch=${branch} sha=${sha || '(vazio)'}\n`);
  process.stdout.write(`[dev-branch-gate] fases=${fasesPedidas.join(',')} escopo=${escopo ? escopo.join(',') : '(todos)'}\n`);

  // ── FASE A ────────────────────────────────────────────────────────────────
  const preflight = preVoo({ esperaSha, requerLimpo, sha, branch });
  const faseA = {
    fase: 'A',
    nivel: 'A',
    ok: preflight.achados.length === 0,
    checks: preflight.checks,
    achados: preflight.achados,
    inventario: preflight.inventario,
    erroInventario: preflight.erroInventario,
    arvoreSuja: preflight.arvoreSuja,
    arquivosSujos: preflight.arquivosSujos,
    evidenciaAnterior: preflight.evidenciaAnterior,
    duracaoMs: 0,
  };
  process.stdout.write(`[dev-branch-gate] A pre-voo: ${faseA.ok ? 'OK' : 'FALHOU'} (${preflight.checks.length} checks)\n`);
  for (const c of preflight.checks) {
    const estado = c.ok ? 'ok' : (c.bloqueante === false ? 'nota' : 'FALHA');
    process.stdout.write(`[dev-branch-gate]   ${c.id.padEnd(24)} ${estado} — ${c.detalhe}\n`);
  }

  if (fasesPedidas[0] === 'A' && fasesPedidas.length === 1) {
    return finalizar({
      outJson, sha, branch, faseA, resultados: [], autorizacoes: [],
      fasesPedidas, escopo, rapido, bloqueio: null, preflight,
    });
  }

  if (!faseA.ok) {
    // Sem inventário/dependências não há como sequer pedir autorização: para aqui.
    return finalizar({
      outJson, sha, branch, faseA, resultados: [], autorizacoes: [],
      fasesPedidas, escopo, rapido, preflight,
      bloqueio: { code: 'PRE_VOO_FALHOU', detail: preflight.achados.map((a) => a.code).join(',') },
    });
  }

  const resultados = [];
  const autorizacoes = [];
  let bloqueio = null;

  const defeitos = carregarInventario().defeitos;

  for (const fase of fasesPedidas) {
    if (fase === 'A') continue;

    // ── Autorização da fase ────────────────────────────────────────────────
    const operacao = AUTORIZACAO_DA_FASE[fase];
    const autorizacao = evaluateExecutionEligibility(
      {
        commit: sha,
        actor: { id: 'scripts/ci/dev-branch-gate.js', kind: 'runner' },
        defects: defeitos,
        activeDefectIds: escopo || undefined,
      },
      operacao
    );
    autorizacoes.push({
      fase,
      operacao,
      allowed: autorizacao.allowed,
      decision: autorizacao.decision,
      reasonCodes: autorizacao.reasonCodes,
      requiredActions: autorizacao.requiredActions,
      blockingFindings: autorizacao.blockingFindings,
    });
    process.stdout.write(
      `[dev-branch-gate] ${fase} autorizacao ${operacao}: ${autorizacao.decision}` +
      `${autorizacao.reasonCodes.length ? ` (${autorizacao.reasonCodes.join(',')})` : ''}\n`
    );

    if (!autorizacao.allowed) {
      bloqueio = {
        fase,
        operacao,
        code: 'FASE_NAO_AUTORIZADA',
        detail: autorizacao.reasonCodes.join(','),
        requiredActions: autorizacao.requiredActions,
      };
      break;
    }

    if (fase === 'B') {
      const plano = planejarFaseB({ defeitos }, escopo);
      if (plano.naoExecutada) {
        bloqueio = { fase: 'B', code: plano.naoExecutada, detail: 'inventário indisponível' };
        break;
      }
      if (plano.passos.length === 0) {
        // Nada a executar: NÃO é aprovação. Registra e segue (fases seguintes têm
        // sua própria autorização).
        resultados.push({
          id: 'B-nada-a-executar',
          fase: 'B',
          nivel: 'B',
          comando: '(nenhum)',
          descricao: 'Nenhum regressionTest declarado para os defeitos em escopo',
          exitCode: null,
          timeout: false,
          duracaoMs: 0,
          sha256Saida: sha256(''),
          saidaFinal: plano.semTeste.length ? `defeitos sem teste: ${plano.semTeste.join(',')}` : '',
          naoExecutado: true,
        });
        process.stdout.write(`[dev-branch-gate] B sem testes direcionados declarados (não conta como verde)\n`);
        continue;
      }
      for (const passo of plano.passos) {
        const r = executar(passo);
        resultados.push(r);
        process.stdout.write(`[dev-branch-gate]   ${r.id.padEnd(26)} exit=${r.exitCode} ${(r.duracaoMs / 1000).toFixed(1)}s\n`);
        if (r.exitCode !== 0) {
          bloqueio = { fase: 'B', code: 'TESTE_DIRECIONADO_FALHOU', detail: r.saidaFinal.slice(0, 400) };
          break;
        }
      }
      if (bloqueio) break;
      continue;
    }

    for (const base of PASSOS[fase] || []) {
      const r = executar({ ...base, fase });
      resultados.push(r);
      process.stdout.write(`[dev-branch-gate]   ${r.id.padEnd(26)} exit=${r.exitCode} ${(r.duracaoMs / 1000).toFixed(1)}s\n`);
      if (r.exitCode !== 0) {
        bloqueio = { fase, code: 'PASSO_FALHOU', detail: `${r.id} exit=${r.exitCode}` };
        break;
      }
    }
    if (bloqueio) break;
  }

  return finalizar({
    outJson, sha, branch, faseA, resultados, autorizacoes, fasesPedidas, escopo, rapido, bloqueio, preflight,
  });
}

function finalizar({
  outJson, sha, branch, faseA, resultados, autorizacoes, fasesPedidas, escopo, rapido, bloqueio, preflight,
}) {
  // TIMEOUT NÃO É DEFEITO. Medido em 2026-10-18: o passo L0 estourou o orçamento e o
  // veredito saía `FAIL` — como se a suíte tivesse reprovado. O correto é "sem veredito":
  // BLOQUEADO_POR_TIMEOUT (exit 2, igual a bloqueio), nunca PASS e nunca FAIL.
  const timeouts = resultados.filter((r) => r.timeout === true);
  // Passo SINTÉTICO (`naoExecutado: true`, ex.: "B: nenhum teste direcionado declarado") tem
  // `exitCode: null` por construção e NÃO é falha — medido em 2026-10-18: o L0 passou com
  // exit=0 em 217,4s e o veredito saiu FAIL só por causa desse registro informativo.
  const falhas = resultados.filter((r) => r.naoExecutado !== true && r.timeout !== true && r.exitCode !== 0);
  const bloqueadoPorDefeitos = Boolean(bloqueio && [ 'FASE_NAO_AUTORIZADA', 'PRE_VOO_FALHOU' ].includes(bloqueio.code));

  const escopoParcial = rapido || fasesPedidas.length < 4 || Boolean(bloqueio) || !faseA.ok;
  let veredito;
  if (bloqueadoPorDefeitos) veredito = 'BLOQUEADO_POR_DEFEITOS';
  else if (timeouts.length > 0) veredito = 'BLOQUEADO_POR_TIMEOUT';
  else if (falhas.length > 0 || Boolean(bloqueio)) veredito = 'FAIL';
  else if (escopoParcial) veredito = 'PASS_PARCIAL';
  else veredito = 'PASS';

  const runner = sondarRunnerDoGithub(branch);
  const shaCurto = (sha || 'vazio').slice(0, 12);

  const semSaidaFinal = (r) => ({
    id: r.id, fase: r.fase, nivel: r.nivel, descricao: r.descricao, comando: r.comando,
    exitCode: r.exitCode, timeout: r.timeout, duracaoMs: r.duracaoMs,
    sha256Saida: r.sha256Saida, saidaFinal: r.saidaFinal,
    ...(r.naoExecutado ? { naoExecutado: true } : {}),
  });

  const nucleo = {
    schemaVersion: 2,
    kind: 'dev-branch-ci-evidence',
    comando: 'node scripts/ci/dev-branch-gate.js',
    veredito,
    equivalenteAValidacaoCompleta: veredito === 'PASS',
    escopo: rapido || fasesPedidas.length < 4 ? 'PARCIAL' : 'COMPLETO',
    fasesPedidas,
    fasesConcluidas: [...new Set(resultados.filter((r) => r.exitCode === 0 && !r.naoExecutado).map((r) => r.fase))],
    sha,
    shaCurto,
    branch,
    escopoDefeitos: escopo || null,
    runnerDoGithub: runner,
    gateEfetivo: 'LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)',
    preVoo: {
      ok: faseA.ok,
      checks: faseA.checks,
      achados: faseA.achados,
      inventario: faseA.inventario,
      erroInventario: faseA.erroInventario,
      arvoreSuja: faseA.arvoreSuja,
      arquivosSujos: faseA.arquivosSujos,
      evidenciaAnterior: faseA.evidenciaAnterior,
    },
    autorizacoes,
    bloqueio,
    passos: resultados.map(semSaidaFinal),
    falhas: falhas.map((f) => ({ id: f.id, fase: f.fase, comando: f.comando, exitCode: f.exitCode })),
  };

  const evidencia = { ...nucleo, evidenceSha256: sha256(JSON.stringify(nucleo)) };

  const outJsonAbs = path.join(ROOT, outJson);
  fs.mkdirSync(path.dirname(outJsonAbs), { recursive: true });
  fs.writeFileSync(outJsonAbs, `${JSON.stringify(evidencia, null, 2)}\n`, 'utf8');

  // Evidência versionada: Markdown com o payload JSON embutido em bloco cercado —
  // `.json` solto em AI_MEMORY/evidence/ é reprovado pelo audit:json-persistence.
  const mdRel = `AI_MEMORY/evidence/dev-branch-ci-${shaCurto}-${String(nucleo.escopo).toLowerCase()}.md`;
  const linhas = [
    `# Gate em fases da branch de desenvolvimento — ${shaCurto} (${nucleo.escopo})`,
    '',
    `- **veredito**: \`${veredito}\``,
    `- **equivale a validação completa**: \`${nucleo.equivalenteAValidacaoCompleta}\``,
    `- **fases pedidas**: \`${fasesPedidas.join(',')}\``,
    `- **fases concluídas**: \`${nucleo.fasesConcluidas.join(',') || '(nenhuma)'}\``,
    `- **branch**: \`${branch}\``,
    `- **sha exato avaliado**: \`${sha || '(vazio)'}\``,
    `- **gerado em**: ${new Date().toISOString()}`,
    `- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta`,
    '',
    '## Pré-voo (fase A)',
    '',
    '| check | resultado | detalhe |',
    '|---|---|---|',
    ...faseA.checks.map((c) => `| \`${c.id}\` | ${c.ok ? 'ok' : (c.bloqueante === false ? 'nota (não bloqueia)' : 'FALHA')} | ${String(c.detalhe).replace(/\|/g, '/')} |`),
    '',
    faseA.inventario
      ? `Inventário de defeitos: ${faseA.inventario.total} item(ns), ${faseA.inventario.abertos} aberto(s), ${faseA.inventario.bloqueantesParaCertificacao} bloqueante(s) para certificação.`
      : `Inventário de defeitos INDISPONÍVEL: ${faseA.erroInventario}`,
    '',
    '## Autorizações de fase (Bug Closure First)',
    '',
    autorizacoes.length
      ? '| fase | operação | decisão | motivos |'
      : '(nenhuma fase técnica foi solicitada)',
    ...(autorizacoes.length ? ['|---|---|---|---|'] : []),
    ...autorizacoes.map((a) => `| ${a.fase} | \`${a.operacao}\` | **${a.decision}** | ${a.reasonCodes.join(', ') || '—'} |`),
    '',
    bloqueio ? `**BLOQUEIO**: fase ${bloqueio.fase || '-'} — \`${bloqueio.code}\` ${bloqueio.detail || ''}` : '**Sem bloqueio.**',
    '',
    '## Passos executados (comando, exit code, duração, sha256 da saída)',
    '',
    resultados.length ? '| fase | passo | comando | exit | duração | sha256 da saída |' : '(nenhum passo executado)',
    ...(resultados.length ? ['|---|---|---|---|---|---|'] : []),
    ...resultados.map((r) =>
      `| ${r.fase} | \`${r.id}\` | \`${r.comando}\` | ${r.exitCode === null ? 'null' : r.exitCode} | ${(r.duracaoMs / 1000).toFixed(1)}s | \`${r.sha256Saida.slice(0, 16)}…\` |`),
    '',
    '## Estado do runner do GitHub (medido)',
    '',
    '```json',
    JSON.stringify(runner, null, 2),
    '```',
    '',
    '## Como reconferir a evidência',
    '',
    '```bash',
    `node scripts/ci/dev-branch-gate.js --fases ${fasesPedidas.join(',')}   # reexecuta as mesmas fases`,
    `git log -1 --format=%H -- ${mdRel}   # commit que publicou esta evidência`,
    '```',
    '',
    `\`evidenceSha256\` = \`${evidencia.evidenceSha256}\` (sha256 do payload sem este campo).`,
    '',
    '```json',
    JSON.stringify(evidencia, null, 2),
    '```',
    '',
  ];
  const mdAbs = path.join(ROOT, mdRel);
  fs.mkdirSync(path.dirname(mdAbs), { recursive: true });
  fs.writeFileSync(mdAbs, linhas.join('\n'), 'utf8');

  process.stdout.write(
    `[dev-branch-gate] veredito=${veredito} (completo=${nucleo.equivalenteAValidacaoCompleta}) ` +
    `evidencia=${outJson} + ${mdRel}\n`
  );

  if (veredito === 'BLOQUEADO_POR_DEFEITOS') return 2;
  if (veredito === 'BLOQUEADO_POR_TIMEOUT') return 2;
  if (veredito === 'FAIL') return 1;
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, PASSOS, AUTORIZACAO_DA_FASE, REGRAS_PREVENTIVAS, preVoo, planejarFaseB };
