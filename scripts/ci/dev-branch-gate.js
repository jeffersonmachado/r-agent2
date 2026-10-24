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
 *   D  L1           — integridade de DESENVOLVIMENTO    exige L1_AMPLO
 *                     (release-dag, fila, ai-memory, aderência)
 *   R  release      — CERTIFICAÇÃO de release            exige SELO_FINAL
 *                     (cadeia criptográfica, self-proving, decisão canônica)
 *   E  L2/L3        — `test:system` (extensivo)         exige L2_L3_EXTENSIVO
 *   F  release      — gate agregado (63 passos)         exige SELO_FINAL
 *
 * POR QUE R É SEPARADA DE D (medido em 2026-10-22, commit `133eb147c`, em checkout LIMPO e no
 * runner): os três gates de R certificam o PACOTE SELADO — a cadeia encadeia o ZIP, o self-proving
 * recalcula essa cadeia e a decisão canônica exige GO definitivo. Nenhum dos três pode passar antes
 * de `npm run release:seal` em `main`, porque os bytes do pacote não são versionáveis (`dist/` é
 * gitignored). Mantê-los dentro de D fazia o CI do branch de desenvolvimento reprovar para sempre
 * por um controle de RELEASE — e um gate que nunca pode ficar verde ensina o time a ignorar o
 * vermelho. Eles continuam OBRIGATÓRIOS para validação completa (R ∈ FASES_OBRIGATORIAS) e são
 * executados pelo pipeline de selagem; o que muda é que o CI de desenvolvimento mede o que pode
 * medir e declara o resto como fora de escopo (`PASS_PARCIAL`), em vez de fingir que mediu.
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
 *                                      [--fases A,B,C,D,R,E,F] [--rapido]
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
const {
  validarCoberturaDeFase,
  passosObrigatoriosDaFase,
} = require('./phase-step-contract');

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
      /**
       * PREPARO DE ENTRADAS DO L0 (medido no CI de 2026-10-24, run 40105995013).
       *
       * O L0 reprovou no runner com `GRAPH_ABSENT` em `tests/unit/coverage/impactRunner.test.js`:
       * a suíte consome artefatos IGNORADOS pelo git (`reports/*.json`,
       * `governance/json-persistence-audit.json`, `qa-mesh/meshRegistry.json`) e nenhum clone
       * contém esses arquivos. Na máquina de desenvolvimento o vermelho não aparecia porque os
       * artefatos já existiam de execuções anteriores — reprodutibilidade dependia de estado sujo.
       *
       * O gate passa a produzir as entradas com os MESMOS produtores canônicos (`ci:artifacts`,
       * parte de `ci:bootstrap`) ANTES de cobrar a suíte. Passo que falha aqui derruba a fase:
       * ausência de artefato é defeito de preparo, não motivo para pular asserção.
       * Medição de referência: `reports/` vazio ⇒ L0 exit=1 (`Expected "EXPLICIT", Received
       * "GRAPH_ABSENT"`); `npm run ci:artifacts` ⇒ mesmo conjunto ⇒ exit=0.
       */
      id: 'L0a-artefatos-canoeiros',
      nivel: 'L0',
      comando: 'npm run ci:artifacts',
      descricao: 'Produz os artefatos canônicos (ignorados pelo git) que o L0 consome',
      // Medido em 2026-10-24: 12 produtores + prova de existência/frescor ≈ 60-120 s em árvore
      // limpa. Orçamento folgado porque produtor lento não é defeito de código.
      orcamentoMs: Number(process.env.L0A_ORCAMENTO_MS) || 20 * 60 * 1000,
    },
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
      // DETERMINISMO DO L0 (medido 2026-10-21). Com o default do `jest.config.cjs`
      // (workers = orçamento de conexões ⇒ 11 nesta máquina de 12 CPUs), a MESMA suíte
      // produzia falsos vermelhos por contenção, sem defeito algum no código:
      //   * `engineeringRouterExecutionSandboxSecurity` recebia SANDBOX_UNAVAILABLE porque o
      //     probe `docker info` estourava 5 s com load average 12 (cache negativo envenenava
      //     o processo — corrigido à parte, em `executionSandbox`);
      //   * `tenantAiCredentialsSaveRoute` estourava o `testTimeout` de 10 s.
      // Medição com 4 workers: 1086 suítes / 9214 testes / exit 0 em 358 s. Gate que reprova
      // por contenção treina todo mundo a ignorar o vermelho — então o L0 fixa 4 workers.
      // O teto é explícito (não é o default do repo): `npm test` à mão continua com o default.
      env: { JEST_MAX_WORKERS: process.env.L0_JEST_MAX_WORKERS || '4' },
    },
    {
      id: 'L0b-integracao-engenheiro',
      nivel: 'L0',
      // INTEGRAÇÃO REAL (auditoria 2026-10-20, §10). Antes o gate do branch de
      // desenvolvimento só rodava `npm test` (unit + flow + rpa sem browser):
      // nenhuma suíte de integração tocava Postgres/sandbox. As suítes de
      // concorrência agora FALHAM sem banco (fail-closed), então ausência de
      // Postgres derruba este passo — que é o comportamento correto para um
      // gate de prontidão.
      //
      // SERIALIZAÇÃO OBRIGATÓRIA (medido 2026-10-21, run 39660840381). O padrão
      // `tests/integration/engineering` casa TODAS as suítes `engineering*` de
      // `tests/integration/` — inclusive as do laço de bugs, que compartilham estado global
      // declarado: `config/canonical-release-suites.json` mantém
      // engineeringBugAutonomousLoopE2E + engineeringBugLoopNaturalPathE2E no MESMO grupo
      // exclusivo porque usam o mesmo runner de laço (`runBugLoopSweep`/GLOBAL, posse por
      // finding e LEASE) e o mesmo banco de missões (a varredura de boot recovery processa
      // TODA missão EXECUTING abandonada). Rodando-as com `--maxWorkers=2`, o job de
      // integração produziu exatamente o que o grupo existe para impedir:
      // engineeringBugLoopNaturalPathE2E estourou o próprio timeout de 900 s enquanto
      // engineeringBugAutonomousLoopE2E falhava em 18 s (`report.fix.fixed` false) — ambas
      // PASSANDO isoladas (42,9 s e 54,6 s). O gate NÃO inventa uma lista de nomes: usa
      // `--runInBand`, que satisfaz a exclusividade por construção para qualquer suíte que
      // venha a compartilhar estado global no futuro.
      comando: 'npx jest tests/integration/engineering --bail=0 --runInBand --forceExit',
      descricao: 'Integração real do Engenheiro (Postgres + sandbox; falha sem banco)',
      orcamentoMs: Number(process.env.L0B_ORCAMENTO_MS) || 40 * 60 * 1000,
    },
  ],
  D: [
    {
      id: 'L1-release-dag',
      nivel: 'L1',
      comando: 'node scripts/governance/validate-release-dag.js',
      descricao: 'DAG do release sem ciclo e sem violação de ordem de fase',
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

  /**
   * CERTIFICAÇÃO DE RELEASE — só é avaliável contra um pacote SELADO (ver docstring).
   * Executada pelo pipeline de selagem e exigida em `FASES_OBRIGATORIAS_VALIDACAO_COMPLETA`.
   */
  R: [
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
      // Fase 3, missão D: a asserção de ESTADO CANÔNICO das projeções saiu do L2 (dependia de
      // `governance/rap-master-scorecard.json`, artefato de run governado) e passou a viver aqui,
      // na fase de CERTIFICAÇÃO. O controle continua exigido — só deixou de contaminar o L2.
      id: 'L1-projecao-estado-canonico',
      nivel: 'L1',
      comando: 'npm run -s test:certification',
      descricao: 'Projeções canônicas do estado real (BLOCKED_BY_GOVERNED_EVIDENCE sem scorecard governado)',
      orcamentoMs: 120 * 1000,
    },
    {
      id: 'L1-decisao-canonica',
      nivel: 'L1',
      comando: 'node scripts/governance/assert-canonical-release-decision.js',
      descricao: 'Decisão canônica de release (autoridade única) coerente com os artefatos',
      orcamentoMs: 120 * 1000,
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
  // Certificação de release é operação de SELAGEM — não de desenvolvimento.
  R: OPERACOES.SELO_FINAL,
  E: OPERACOES.L2_L3_EXTENSIVO,
  F: OPERACOES.SELO_FINAL,
});

/**
 * CONTRATO DETERMINÍSTICO DE CONCLUSÃO DE FASES (defeito P0 medido em 2026-10-19).
 *
 * Era possível pedir `--fases A,A,A,A` e receber `veredito=PASS`,
 * `equivalenteAValidacaoCompleta=true`, `exit=0` — com ZERO passos executados,
 * porque o tamanho do array era usado como sinal de cobertura e as fases
 * desconhecidas eram filtradas em silêncio.
 *
 * Regra: quantidade de elementos NUNCA substitui comprovação. Cada fase só pode
 * ser `PASS` se tiver sido realmente executada, com passos reais, exit 0 e
 * evidência do MESMO SHA. Fases ausentes ficam `NOT_EXECUTED`; fase sem passos
 * definidos fica `UNKNOWN`; entrada inválida (duplicada/desconhecida/vazia)
 * recusa a execução antes de qualquer passo.
 */
const FASES_CONHECIDAS = Object.freeze(Object.keys(AUTORIZACAO_DA_FASE));

/** Conjunto que caracteriza validação completa — `PASS` exige TODAS em PASS. */
const FASES_OBRIGATORIAS_VALIDACAO_COMPLETA = Object.freeze(['A', 'B', 'C', 'D', 'R', 'E', 'F']);

const ESTADOS_DE_FASE = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  NOT_EXECUTED: 'NOT_EXECUTED',
  UNKNOWN: 'UNKNOWN',
  // Fase sem trabalho por definição (ex.: B sem nenhum defeito aberto a regredir).
  // Não é "não executada por falha": é ausência de objeto, declarada.
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  // Cobertura PARCIAL: executou, mas o conjunto não é exatamente o obrigatório
  // (ausente, duplicado, desconhecido ou evidência inválida). Nunca aprova.
  INCOMPLETE: 'INCOMPLETE',
});

/**
 * Normaliza e VALIDA a lista de fases pedidas. Nunca descarta nada em silêncio.
 * @param {string|null|undefined} bruto
 * @returns {{fases: string[], invalido: boolean, motivo: string|null, duplicadas: string[], desconhecidas: string[]}}
 */
function parseFases(bruto) {
  const texto = String(bruto == null ? '' : bruto);
  const itens = texto.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const duplicadas = itens.filter((f, i) => itens.indexOf(f) !== i);
  const desconhecidas = itens.filter((f) => !FASES_CONHECIDAS.includes(f));
  const unicas = [...new Set(itens)];

  if (itens.length === 0) {
    return { fases: [], invalido: true, motivo: 'LISTA_DE_FASES_VAZIA', duplicadas, desconhecidas };
  }
  if (duplicadas.length > 0) {
    return {
      fases: unicas, invalido: true,
      motivo: `FASE_DUPLICADA:${[...new Set(duplicadas)].join(',')}`, duplicadas, desconhecidas,
    };
  }
  if (desconhecidas.length > 0) {
    return {
      fases: unicas, invalido: true,
      motivo: `FASE_DESCONHECIDA:${desconhecidas.join(',')}`, duplicadas, desconhecidas,
    };
  }
  return { fases: unicas, invalido: false, motivo: null, duplicadas, desconhecidas };
}

/** Identidade mínima de execução: SHA completo de 40 hex e branch não vazia. */
function identidadeValida(sha, branch) {
  const shaOk = typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha);
  const branchOk = typeof branch === 'string' && branch.trim().length > 0 && branch !== '(desconhecida)';
  return { ok: shaOk && branchOk, shaOk, branchOk };
}

/**
 * Estado REAL de cada fase pedida, derivado dos passos que foram executados.
 * Nenhum estado é inferido de "a fase estava na lista".
 */
function avaliarEstadosPorFase({ fasesPedidas, faseA, resultados, bloqueio, timeouts, contexto }) {
  const timeoutsIds = new Set((timeouts || []).map((r) => r.id));
  const shaAtual = contexto ? contexto.sha : null;
  const execucaoAtual = contexto ? contexto.execucaoId : null;
  const digestValido = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
  return (fasesPedidas || []).map((fase) => {
    // CONTRATO DE COBERTURA (P0-01): fases com definição canônica de passos (C,D,E,F)
    // só podem ser PASS com o conjunto OBRIGATÓRIO integralmente executado,
    // aprovado e com evidência verificável. Contagem de resultados nunca comprova.
    // A e B têm semântica própria (pré-voo / planejamento dinâmico de regressões).
    if (Object.prototype.hasOwnProperty.call(PASSOS, fase)) {
      const { estado, motivo, detalhes } = validarCoberturaDeFase({
        fase,
        definicao: PASSOS[fase],
        resultados,
        contexto,
        timeoutsIds,
        raiz: ROOT,
      });
      const bloqueadoAqui = Boolean(bloqueio && bloqueio.fase === fase);
      if (bloqueadoAqui && estado !== ESTADOS_DE_FASE.PASS) {
        return {
          fase,
          estado: ESTADOS_DE_FASE.BLOCKED,
          passosReais: detalhes.executados,
          passosEsperados: detalhes.esperados.length,
          motivo: bloqueio.code || 'BLOQUEIO',
        };
      }
      return {
        fase,
        estado,
        passosReais: detalhes.executados,
        passosEsperados: detalhes.esperados.length,
        passosAusentes: detalhes.ausentes,
        motivo,
      };
    }

    const passosDaFase = (resultados || []).filter((r) => r.fase === fase);
    const reais = passosDaFase.filter((r) => r.naoExecutado !== true);
    const sinteticos = passosDaFase.filter((r) => r.naoExecutado === true);

    if (fase === 'A') {
      if (!faseA) return { fase, estado: ESTADOS_DE_FASE.NOT_EXECUTED, passosReais: 0, motivo: 'PRE_VOO_NAO_EXECUTADO' };
      if (!faseA.ok) return { fase, estado: ESTADOS_DE_FASE.FAIL, passosReais: faseA.checks ? faseA.checks.length : 0, motivo: 'PRE_VOO_FALHOU' };
      return { fase, estado: ESTADOS_DE_FASE.PASS, passosReais: faseA.checks ? faseA.checks.length : 0, motivo: null };
    }

    if (reais.length === 0) {
      const bloqueadoAqui = Boolean(bloqueio && bloqueio.fase === fase);
      // B só é NOT_APPLICABLE quando o inventário NÃO tem defeito aberto: aí não
      // existe regressão a executar. Com defeito aberto e sem teste declarado, é
      // NOT_EXECUTED (a missão não pode passar sem a prova).
      if (fase === 'B' && sinteticos.some((r) => r.naoAplicavel === true)) {
        return { fase, estado: ESTADOS_DE_FASE.NOT_APPLICABLE, passosReais: 0, motivo: 'SEM_DEFEITOS_ABERTOS' };
      }
      return {
        fase,
        estado: bloqueadoAqui ? ESTADOS_DE_FASE.BLOCKED : ESTADOS_DE_FASE.NOT_EXECUTED,
        passosReais: 0,
        passosSinteticos: sinteticos.length,
        motivo: bloqueadoAqui ? (bloqueio.code || 'BLOQUEIO') : 'FASE_NAO_EXECUTADA',
      };
    }

    // Evidência amarrada ao SHA e à execução: sem isso o passo não comprova nada.
    const semDigest = reais.filter((r) => !digestValido(r.sha256Saida));
    if (semDigest.length > 0) {
      return { fase, estado: ESTADOS_DE_FASE.UNKNOWN, passosReais: reais.length, motivo: `EVIDENCIA_SEM_DIGEST:${semDigest.map((r) => r.id).join(',')}` };
    }
    const outroSha = reais.filter((r) => shaAtual && r.sha && r.sha !== shaAtual);
    if (outroSha.length > 0) {
      return { fase, estado: ESTADOS_DE_FASE.UNKNOWN, passosReais: reais.length, motivo: `EVIDENCIA_DE_OUTRO_SHA:${outroSha.map((r) => r.id).join(',')}` };
    }
    const outraExecucao = reais.filter((r) => execucaoAtual && r.execucaoId && r.execucaoId !== execucaoAtual);
    if (outraExecucao.length > 0) {
      return { fase, estado: ESTADOS_DE_FASE.UNKNOWN, passosReais: reais.length, motivo: `EVIDENCIA_DE_OUTRA_EXECUCAO:${outraExecucao.map((r) => r.id).join(',')}` };
    }
    const semVinculo = reais.filter((r) => !r.sha || !r.execucaoId);
    if (semVinculo.length > 0) {
      return { fase, estado: ESTADOS_DE_FASE.UNKNOWN, passosReais: reais.length, motivo: `EVIDENCIA_SEM_VINCULO:${semVinculo.map((r) => r.id).join(',')}` };
    }

    const comTimeout = reais.filter((r) => r.timeout === true || timeoutsIds.has(r.id));
    if (comTimeout.length > 0) {
      return { fase, estado: ESTADOS_DE_FASE.BLOCKED, passosReais: reais.length, motivo: 'TIMEOUT' };
    }
    const comFalha = reais.filter((r) => r.exitCode !== 0);
    if (comFalha.length > 0) {
      return {
        fase, estado: ESTADOS_DE_FASE.FAIL, passosReais: reais.length,
        motivo: `PASSO_FALHOU:${comFalha.map((r) => r.id).join(',')}`,
      };
    }
    return { fase, estado: ESTADOS_DE_FASE.PASS, passosReais: reais.length, motivo: null };
  });
}

/**
 * Veredito global. `PASS` (e equivalência a validação completa) exige:
 * identidade válida, entrada válida, TODAS as fases obrigatórias em `PASS`,
 * sem bloqueio, sem timeout e sem fase em NOT_EXECUTED/UNKNOWN.
 */
function decidirVeredito({ entradaInvalida, identidade, estados, bloqueio }) {
  const porFase = new Map((estados || []).map((e) => [e.fase, e.estado]));
  const faltantes = FASES_OBRIGATORIAS_VALIDACAO_COMPLETA.filter((f) => !porFase.has(f));
  const CUMPRIDA = new Set([ESTADOS_DE_FASE.PASS, ESTADOS_DE_FASE.NOT_APPLICABLE]);
  const naoPass = FASES_OBRIGATORIAS_VALIDACAO_COMPLETA
    .filter((f) => porFase.has(f) && !CUMPRIDA.has(porFase.get(f)));
  const estadosPresentes = new Set((estados || []).map((e) => e.estado));
  const algumaNaoExecutada = estadosPresentes.has(ESTADOS_DE_FASE.NOT_EXECUTED);
  const algumaDesconhecida = estadosPresentes.has(ESTADOS_DE_FASE.UNKNOWN);
  const algumaFalha = estadosPresentes.has(ESTADOS_DE_FASE.FAIL);
  const algumBloqueio = estadosPresentes.has(ESTADOS_DE_FASE.BLOCKED) || Boolean(bloqueio);

  if (entradaInvalida) return 'ENTRADA_INVALIDA';
  if (!identidade || !identidade.ok) return 'IDENTIDADE_INVALIDA';
  // UM PASSO QUE FALHOU É FALHA, NÃO TIMEOUT (medido 2026-10-21, run 39614201981): o passo
  // `L0-suite-oficial` reprovou por asserção real (exit=1) e o veredito publicado foi
  // `BLOQUEADO_POR_TIMEOUT` — rótulo que manda a investigação para o lado errado e sugere
  // orçamento de tempo quando o defeito é de código. `timeout` continua tendo veredito próprio
  // (BLOCKED por sinal), coberto pelo cenário 8 deste contrato.
  if (bloqueio && bloqueio.code === 'PASSO_FALHOU') return 'FAIL';
  if (algumaFalha) return 'FAIL';
  if (algumBloqueio) {
    return bloqueio && ['FASE_NAO_AUTORIZADA', 'PRE_VOO_FALHOU'].includes(bloqueio.code)
      ? 'BLOQUEADO_POR_DEFEITOS'
      : 'BLOQUEADO_POR_TIMEOUT';
  }
  if (faltantes.length > 0) return 'PASS_PARCIAL';
  if (naoPass.length > 0 || algumaNaoExecutada || algumaDesconhecida) return 'INCONCLUSIVO';
  return 'PASS';
}

/** Arquivos cuja existência é regra preventiva (defeito corrigido não volta a existir mudo). */
const REGRAS_PREVENTIVAS = Object.freeze([
  'governance/RAP_AGENT_CONSTITUTION.md',
  'config/journey-criticality.json',
  'governance/bug-closure/defect-states.js',
  'governance/bug-closure/eligibility.js',
  'scripts/governance/evaluate-execution-eligibility.js',
  'tests/unit/governance/governanceChainContract.test.js',
  'tests/unit/governance/bugClosureFirst.test.js',
  // P0-01 (2026-10-19): o contrato de cobertura e sua regressão adversarial são
  // parte da regra — remover/renomear qualquer um derruba o preflight.
  'scripts/ci/phase-step-contract.js',
  'tests/unit/governance/phaseStepContract.test.js',
  // P0-02 (2026-10-19): store multitenant, trava anti-upsert e matriz em PG real.
  'api/services/crm/crmRecordStore.js',
  'tests/unit/crmNoUpsertRegression.test.js',
  'tests/integration/crmTenantIsolation.postgres.test.js',
]);

/**
 * ÁREAS SENSÍVEIS → testes adversariais que DEVEM rodar quando a área muda.
 * É o vínculo executável entre "mexeu aqui" e "prove que não regrediu".
 */
const AREAS_SENSIVEIS = Object.freeze([
  {
    id: 'GATE-COBERTURA',
    arquivos: ['scripts/ci/dev-branch-gate.js', 'scripts/ci/phase-step-contract.js'],
    testes: [
      'tests/unit/governance/phaseStepContract.test.js',
      'tests/unit/governance/devBranchGatePhaseContract.test.js',
      'tests/unit/governance/devBranchGateStepEvidence.test.js',
    ],
  },
  {
    id: 'CRM-MULTITENANT',
    arquivos: [
      'api/modules/crm/routes.js',
      'api/services/crm/crmRecordStore.js',
      'api/db/models/CrmRecord.js',
    ],
    testes: [
      'tests/unit/crmNoUpsertRegression.test.js',
      'tests/unit/crmOpportunityUpdate.test.js',
      'tests/integration/crmTenantIsolation.postgres.test.js',
    ],
  },
  {
    id: 'MIGRACAO-CRM',
    arquivos: ['api/db/migrations/20261019120000-create-crm-records.js', 'api/db/migrations/20261019130000-crm-records-tenant-guard.js'],
    testes: ['tests/integration/crmTenantIsolation.postgres.test.js'],
  },
]);

/**
 * Detecta áreas sensíveis atingidas pelos arquivos alterados.
 * @param {string[]} arquivos caminhos relativos
 */
function detectarAreasSensiveis(arquivos) {
  const lista = (arquivos || []).map((a) => String(a).replace(/\\/g, '/'));
  return AREAS_SENSIVEIS.filter((area) =>
    area.arquivos.some((alvo) => lista.some((arq) => arq === alvo || arq.startsWith(alvo))),
  );
}

/** Arquivos alterados do branch em relação à base de integração (best-effort). */
function arquivosAlteradosNoBranch() {
  for (const args of [['diff', '--name-only', 'origin/main...HEAD'], ['diff', '--name-only', 'HEAD~1']]) {
    const saida = git(args);
    if (saida) return saida.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

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

// Contexto da execução corrente: cada passo é amarrado a ele. Evidência de outro
// SHA ou de outra execução NÃO conta como comprovação (defeito P0 medido em 2026-10-19).
let CONTEXTO_EXECUCAO = { sha: null, execucaoId: null };

function definirContextoExecucao(sha) {
  CONTEXTO_EXECUCAO = { sha: sha || null, execucaoId: crypto.randomUUID() };
  return CONTEXTO_EXECUCAO;
}

/**
 * Resultado que o passo DEVERIA ter. Passos negativos declaram `esperado` (ex.: 1); os demais
 * esperam 0. Usado só para decidir QUANTO da saída guardar (diagnóstico) — nunca no veredito.
 */
function esperadoParaEstePasso(passo) {
  const bruto = passo && passo.esperado;
  return typeof bruto === 'number' ? bruto : 0;
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
    // `passo.env` permite fixar o ambiente do passo (ex.: `JEST_MAX_WORKERS`) sem variar o
    // comportamento de quem roda `npm test` à mão.
    env: { ...process.env, ...(passo.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
    // Backstop: se até o `timeout` falhar, o spawnSync encerra.
    timeout: Number(passo.orcamentoMs || 0) + 30 * 1000,
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const exitCode = r.status === null ? null : r.status;
  // 124 = timeout(1); 137 = SIGKILL. Ambos são "sem veredito", nunca "reprovado".
  const estourouOrcamento = exitCode === 124 || exitCode === 137 || r.status === null;
  // A saída COMPLETA do passo é a única forma de diagnosticar falha sem repetir
  // a execução (e sem "achar" a causa). Antes só existia o digest + as últimas 12
  // linhas: uma falha no MEIO da suíte ficava invisível e o diagnóstico dependia
  // de re-rodar o processo inteiro — o que mascara defeitos intermitentes.
  const dirLogs = path.resolve(ROOT, process.env.DEV_BRANCH_GATE_EVIDENCE_DIR || 'AI_MEMORY/evidence', 'dev-branch-gate-logs', String(CONTEXTO_EXECUCAO.execucaoId || 'sem-execucao'));
  let saidaRef = null;
  try {
    fs.mkdirSync(dirLogs, { recursive: true });
    const arquivo = path.join(dirLogs, `${passo.id}.log`);
    fs.writeFileSync(arquivo, saida, 'utf8');
    saidaRef = path.relative(ROOT, arquivo);
  } catch (_) {
    // evidência de log é best-effort: ausência de log NUNCA vira sucesso nem falha
    saidaRef = null;
  }
  return {
    id: passo.id,
    fase: passo.fase,
    nivel: passo.nivel,
    descricao: passo.descricao,
    comando: passo.comando,
    // Auditoria: variáveis que o GATE fixou para este passo (ex.: `JEST_MAX_WORKERS`).
    // Quem lê o relatório depois precisa saber com que ambiente o passo rodou — senão
    // "passou no gate" e "passou na minha máquina" viram a mesma frase.
    envFixado: passo.env || null,
    orcamentoMs: Number(passo.orcamentoMs || 0) || null,
    // `status === null` significa morte por sinal/timeout: NUNCA é sucesso.
    exitCode: estourouOrcamento ? null : exitCode,
    timeout: estourouOrcamento,
    duracaoMs: Date.now() - inicio,
    sha256Saida: sha256(saida),
    sha: CONTEXTO_EXECUCAO.sha,
    execucaoId: CONTEXTO_EXECUCAO.execucaoId,
    saidaRef,
    // DIAGNÓSTICO DE FALHA (Fase 3): o `saidaFinal` guardava só a CAUDA (12 linhas). Num passo que
    // roda a suíte inteira, a cauda traz "Tests: 1 failed" e o RESUMO — mas não o nome do teste nem
    // `Expected/Received`, que ficam no MEIO da saída. Sem isso, um vermelho no CI obriga a
    // reexecutar tudo para descobrir o que falhou (medido em 2026-10-24, run 40105995013).
    saidaFinal: (estourouOrcamento || exitCode !== esperadoParaEstePasso(passo))
      ? [saida.trim().split('\n').slice(0, 60).join('\n'), saida.trim().split('\n').slice(-25).join('\n')].join('\n…\n')
      : saida.trim().split('\n').slice(-12).join('\n'),
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
function planejarFaseB(inventario, escopo, areasSensiveis = []) {
  if (!inventario) return { passos: [], semTeste: [], naoExecutada: 'INVENTARIO_AUSENTE' };
  const alvo = escopo && escopo.length
    ? inventario.defeitos.filter((d) => escopo.includes(d.id))
    : inventario.defeitos.filter((d) => d.state === ESTADOS.FIXED_PENDING_VERIFICATION);

  const semTeste = alvo.filter((d) => !d.regressionTest).map((d) => d.id);
  const testes = [...new Set(alvo.map((d) => d.regressionTest).filter(Boolean))];

  // ÁREAS SENSÍVEIS: alterações em gate de certificação, contrato de passos,
  // store multitenant e migrations selecionam os testes adversariais da área
  // mesmo que nenhum defeito esteja em FIXED_PENDING_VERIFICATION. Sem isso, a
  // regressão de um P0 já fechado só seria pega por sorte.
  const extras = [];
  for (const area of areasSensiveis) {
    for (const teste of area.testes || []) {
      if (!testes.includes(teste) && !extras.includes(teste)) extras.push(teste);
    }
  }

  const passos = [...testes, ...extras].map((alvoTeste, i) => ({
    id: `B${i + 1}-${String(alvoTeste).split('/').pop()}`.slice(0, 60),
    fase: 'B',
    nivel: 'B',
    comando: `npx jest ${alvoTeste} --bail=0`,
    descricao: `Teste de regressão declarado: ${alvoTeste}`,
    orcamentoMs: 10 * 60 * 1000,
  }));

  return {
    passos,
    semTeste,
    alvo: alvo.map((d) => d.id),
    areasSensiveis: areasSensiveis.map((a) => a.id),
    naoExecutada: null,
  };
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

  // `--fases` presente com valor vazio é ENTRADA INVÁLIDA (não "use o default").
  const fasesArg = argDe('--fases');
  const fasesBrutas = fasesArg !== null ? fasesArg : (extensivo ? 'A,B,C,D,E' : 'A,B,C,D');
  const fasesParse = parseFases(fasesBrutas);
  const fasesPedidas = fasesParse.fases;

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || '(desconhecida)';
  const sha = git(['rev-parse', 'HEAD']) || '';
  const identidade = identidadeValida(sha, branch);

  // RECUSA ANTES DE EXECUTAR: entrada inválida (duplicada/desconhecida/vazia) ou
  // identidade inválida não podem produzir veredito algum. Sem pré-voo, sem passos.
  if (fasesParse.invalido || !identidade.ok) {
    process.stderr.write(
      `[dev-branch-gate] RECUSADO: ${fasesParse.invalido ? fasesParse.motivo : `IDENTIDADE_INVALIDA (sha=${sha || 'vazio'} branch=${branch})`}` +
      ' — nenhuma fase foi executada.\n'
    );
    return finalizar({
      outJson, sha, branch, faseA: null, resultados: [], autorizacoes: [],
      fasesPedidas, escopo, rapido, bloqueio: null, preflight: null,
      entradaInvalida: fasesParse.invalido ? fasesParse.motivo : null,
      identidade, fasesParse,
    });
  }

  if (esperaSha && esperaSha !== sha) {
    process.stderr.write(
      `[dev-branch-gate] RECUSADO: HEAD=${sha} mas a execucao EXIGE ${esperaSha} — ` +
      'a evidencia seria vinculada ao commit errado.\n'
    );
    return finalizar({
      outJson, sha, branch, faseA: null, resultados: [], autorizacoes: [],
      fasesPedidas, escopo, rapido, bloqueio: null, preflight: null,
      entradaInvalida: 'SHA_DIVERGENTE_DO_ESPERADO', identidade, fasesParse,
    });
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

  if (fasesPedidas.length === 1 && fasesPedidas[0] === 'A') {
    return finalizar({
      outJson, sha, branch, faseA, resultados: [], autorizacoes: [],
      fasesPedidas, escopo, rapido, bloqueio: null, preflight,
      entradaInvalida: null, identidade, fasesParse,
    });
  }

  if (!faseA.ok) {
    // Sem inventário/dependências não há como sequer pedir autorização: para aqui.
    return finalizar({
      outJson, sha, branch, faseA, resultados: [], autorizacoes: [],
      fasesPedidas, escopo, rapido, preflight,
      bloqueio: { code: 'PRE_VOO_FALHOU', detail: preflight.achados.map((a) => a.code).join(',') },
      entradaInvalida: null, identidade, fasesParse,
    });
  }

  const contexto = definirContextoExecucao(sha);

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
      const areasSensiveis = detectarAreasSensiveis(arquivosAlteradosNoBranch());
      const plano = planejarFaseB({ defeitos }, escopo, areasSensiveis);
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
          // Sem passos E sem defeito a cobrar: a fase não tem objeto (N/A).
          naoAplicavel: plano.semTeste.length === 0,
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
    entradaInvalida: null, identidade, fasesParse,
  });
}

function finalizar({
  outJson, sha, branch, faseA, resultados, autorizacoes, fasesPedidas, escopo, rapido, bloqueio, preflight,
  entradaInvalida = null, identidade = null, fasesParse = null,
}) {
  const resultadosSeguros = Array.isArray(resultados) ? resultados : [];
  const autorizacoesSeguras = Array.isArray(autorizacoes) ? autorizacoes : [];

  // TIMEOUT NÃO É DEFEITO. Medido em 2026-10-18: o passo L0 estourou o orçamento e o
  // veredito saía `FAIL` — como se a suíte tivesse reprovado. O correto é "sem veredito".
  const timeouts = resultadosSeguros.filter((r) => r.timeout === true);
  // Passo SINTÉTICO (`naoExecutado: true`) tem exitCode null por construção e NÃO é falha.
  const falhas = resultadosSeguros.filter((r) => r.naoExecutado !== true && r.timeout !== true && r.exitCode !== 0);

  const inventario = faseA && faseA.inventario ? faseA.inventario : null;
  const semDefeitosAbertos = Boolean(inventario
    && Number(inventario.abertos || 0) === 0
    && Number(inventario.bloqueantesParaCertificacao || 0) === 0);
  const estados = avaliarEstadosPorFase({
    fasesPedidas, faseA, resultados: resultadosSeguros, bloqueio, timeouts,
    contexto: { ...CONTEXTO_EXECUCAO, semDefeitosAbertos },
  });
  const veredito = decidirVeredito({ entradaInvalida, identidade, estados, bloqueio });
  const completo = veredito === 'PASS';
  const fasesFaltantes = FASES_OBRIGATORIAS_VALIDACAO_COMPLETA.filter((f) => !fasesPedidas.includes(f));
  const naoExecutadas = estados
    .filter((e) => ![ESTADOS_DE_FASE.PASS, ESTADOS_DE_FASE.NOT_APPLICABLE].includes(e.estado))
    .map((e) => e.fase);

  const runner = sondarRunnerDoGithub(branch);
  const shaCurto = (sha || 'vazio').slice(0, 12);

  const semSaidaFinal = (r) => ({
    id: r.id, fase: r.fase, nivel: r.nivel, descricao: r.descricao, comando: r.comando,
    exitCode: r.exitCode, timeout: r.timeout, duracaoMs: r.duracaoMs,
    sha256Saida: r.sha256Saida, saidaFinal: r.saidaFinal,
    // Referência ao log COMPLETO do passo (evidência de diagnóstico). Sem ela,
    // uma falha no meio da suíte só podia ser investigada re-rodando tudo — e o
    // defeito intermitente desaparecia na repetição.
    ...(r.saidaRef ? { saidaRef: r.saidaRef } : {}),
    ...(r.naoExecutado ? { naoExecutado: true } : {}),
  });

  const nucleo = {
    schemaVersion: 3,
    kind: 'dev-branch-ci-evidence',
    comando: 'node scripts/ci/dev-branch-gate.js',
    veredito,
    // Só é "equivalente a validação completa" quando TODAS as fases obrigatórias
    // foram realmente executadas com exit 0 — nunca por tamanho de array.
    equivalenteAValidacaoCompleta: completo,
    escopo: completo ? 'COMPLETO' : 'PARCIAL',
    fasesPedidas,
    fasesObrigatorias: FASES_OBRIGATORIAS_VALIDACAO_COMPLETA,
    fasesFaltantes,
    estadosPorFase: estados,
    fasesNaoAprovadas: naoExecutadas,
    entradaInvalida: entradaInvalida || null,
    entrada: fasesParse ? {
      bruto: fasesPedidas.join(','),
      duplicadas: fasesParse.duplicadas || [],
      desconhecidas: fasesParse.desconhecidas || [],
    } : null,
    contextoExecucao: { sha: CONTEXTO_EXECUCAO.sha, execucaoId: CONTEXTO_EXECUCAO.execucaoId },
    identidade: {
      sha,
      branch,
      shaValido: Boolean(identidade && identidade.shaOk),
      branchValida: Boolean(identidade && identidade.branchOk),
    },
    fasesConcluidas: estados.filter((e) => e.estado === ESTADOS_DE_FASE.PASS).map((e) => e.fase),
    fasesNaoAplicaveis: estados.filter((e) => e.estado === ESTADOS_DE_FASE.NOT_APPLICABLE).map((e) => e.fase),
    sha,
    shaCurto,
    branch,
    escopoDefeitos: escopo || null,
    runnerDoGithub: runner,
    gateEfetivo: 'LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)',
    preVoo: faseA ? {
      ok: faseA.ok,
      checks: faseA.checks,
      achados: faseA.achados,
      inventario: faseA.inventario,
      erroInventario: faseA.erroInventario,
      arvoreSuja: faseA.arvoreSuja,
      arquivosSujos: faseA.arquivosSujos,
      evidenciaAnterior: faseA.evidenciaAnterior,
    } : { ok: false, checks: [], achados: [{ code: 'PRE_VOO_NAO_EXECUTADO' }] },
    autorizacoes: autorizacoesSeguras,
    bloqueio,
    passos: resultadosSeguros.map(semSaidaFinal),
    falhas: falhas.map((f) => ({ id: f.id, fase: f.fase, comando: f.comando, exitCode: f.exitCode })),
  };

  const evidencia = { ...nucleo, evidenceSha256: sha256(JSON.stringify(nucleo)) };

  const outJsonAbs = path.resolve(ROOT, outJson);
  fs.mkdirSync(path.dirname(outJsonAbs), { recursive: true });
  fs.writeFileSync(outJsonAbs, `${JSON.stringify(evidencia, null, 2)}\n`, 'utf8');

  // Diretório da evidência versionada é configurável para que testes possam
  // exercitar o gate sem sobrescrever a evidência real do repositório.
  const dirEvidencia = process.env.DEV_BRANCH_GATE_EVIDENCE_DIR || 'AI_MEMORY/evidence';
  const mdRel = path.posix.join(dirEvidencia, `dev-branch-ci-${shaCurto}-${String(nucleo.escopo).toLowerCase()}.md`);
  const checksPreVoo = (nucleo.preVoo.checks || []);
  const linhas = [
    `# Gate em fases da branch de desenvolvimento — ${shaCurto} (${nucleo.escopo})`,
    '',
    `- **veredito**: \`${veredito}\``,
    `- **equivale a validação completa**: \`${nucleo.equivalenteAValidacaoCompleta}\``,
    `- **fases pedidas**: \`${fasesPedidas.join(',') || '(vazio)'}\``,
    `- **fases obrigatórias**: \`${FASES_OBRIGATORIAS_VALIDACAO_COMPLETA.join(',')}\``,
    `- **fases faltantes**: \`${fasesFaltantes.join(',') || '(nenhuma)'}\``,
    `- **entrada inválida**: \`${entradaInvalida || 'não'}\``,
    `- **branch**: \`${branch}\``,
    `- **sha exato avaliado**: \`${sha || '(vazio)'}\``,
    `- **gerado em**: ${new Date().toISOString()}`,
    `- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta`,
    '',
    '## Estado por fase (comprovação, não intenção)',
    '',
    '| fase | estado | passos reais | motivo |',
    '|---|---|---|---|',
    ...estados.map((e) => `| ${e.fase} | **${e.estado}** | ${e.passosReais} | ${e.motivo || '—'} |`),
    '',
    '## Pré-voo (fase A)',
    '',
    checksPreVoo.length ? '| check | resultado | detalhe |' : '(pré-voo não executado)',
    ...(checksPreVoo.length ? ['|---|---|---|'] : []),
    ...checksPreVoo.map((c) => `| \`${c.id}\` | ${c.ok ? 'ok' : (c.bloqueante === false ? 'nota (não bloqueia)' : 'FALHA')} | ${String(c.detalhe).replace(/\|/g, '/')} |`),
    '',
    nucleo.preVoo.inventario
      ? `Inventário de defeitos: ${nucleo.preVoo.inventario.total} item(ns), ${nucleo.preVoo.inventario.abertos} aberto(s), ${nucleo.preVoo.inventario.bloqueantesParaCertificacao} bloqueante(s) para certificação.`
      : `Inventário de defeitos INDISPONÍVEL: ${nucleo.preVoo.erroInventario || 'pré-voo não executado'}`,
    '',
    '## Autorizações de fase (Bug Closure First)',
    '',
    autorizacoesSeguras.length ? '| fase | operação | decisão | motivos |' : '(nenhuma fase técnica foi solicitada)',
    ...(autorizacoesSeguras.length ? ['|---|---|---|---|'] : []),
    ...autorizacoesSeguras.map((a) => `| ${a.fase} | \`${a.operacao}\` | **${a.decision}** | ${a.reasonCodes.join(', ') || '—'} |`),
    '',
    bloqueio ? `**BLOQUEIO**: fase ${bloqueio.fase || '-'} — \`${bloqueio.code}\` ${bloqueio.detail || ''}` : '**Sem bloqueio.**',
    '',
    '## Passos executados (comando, exit code, duração, sha256 da saída)',
    '',
    resultadosSeguros.length ? '| fase | passo | comando | exit | duração | sha256 da saída |' : '(nenhum passo executado)',
    ...(resultadosSeguros.length ? ['|---|---|---|---|---|---|'] : []),
    ...resultadosSeguros.map((r) =>
      `| ${r.fase} | \`${r.id}\` | \`${r.comando}\` | ${r.exitCode === null ? 'null' : r.exitCode} | ${(r.duracaoMs / 1000).toFixed(1)}s | \`${String(r.sha256Saida).slice(0, 16)}…\` |`),
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
    `node scripts/ci/dev-branch-gate.js --fases ${fasesPedidas.join(',') || 'A'}   # reexecuta as mesmas fases`,
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
  const mdAbs = path.resolve(ROOT, mdRel);
  fs.mkdirSync(path.dirname(mdAbs), { recursive: true });
  fs.writeFileSync(mdAbs, linhas.join('\n'), 'utf8');

  process.stdout.write(
    `[dev-branch-gate] veredito=${veredito} (completo=${nucleo.equivalenteAValidacaoCompleta}) ` +
    `evidencia=${outJson} + ${mdRel}\n`
  );

  if (veredito === 'PASS') return 0;
  // PASS_PARCIAL: as fases pedidas passaram, mas NÃO equivalem a validação completa.
  if (veredito === 'PASS_PARCIAL') return 0;
  // Sem veredito / reprovado / entrada inválida: nunca exit 0.
  if (veredito === 'FAIL') return 1;
  return 2;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main, PASSOS, AUTORIZACAO_DA_FASE, REGRAS_PREVENTIVAS, preVoo, planejarFaseB,
  parseFases, identidadeValida, avaliarEstadosPorFase, decidirVeredito, definirContextoExecucao,
  executar, passosObrigatoriosDaFase,
  AREAS_SENSIVEIS, detectarAreasSensiveis,
  FASES_CONHECIDAS, FASES_OBRIGATORIAS_VALIDACAO_COMPLETA, ESTADOS_DE_FASE,
};
