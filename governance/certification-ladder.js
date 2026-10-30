'use strict';

/**
 * Escada de certificação (núcleo PURO).
 *
 * Problema que resolve: hoje a certificação falha por dependências em CADEIA e cada gate conta só a
 * sua parte. Um operador precisa saber "o que faço primeiro" sem descobrir a ordem por tentativa e
 * erro. Este módulo declara a ordem e a dependência de cada degrau; o script
 * `scripts/governance/certification-ladder.js` executa de verdade.
 *
 * Semântica (deliberadamente conservadora):
 *   - `PASS`      só quando o passo executou e passou;
 *   - `FAIL`      executou e reprovou;
 *   - `BLOCKED`   NÃO executou porque um pré-requisito seu não passou (nunca é lido como PASS);
 *   - `SKIPPED`   não se aplica ao ambiente (ex.: sem permissão de runtime) — também não é PASS.
 *
 * Nenhum degrau afrouxa política: quem decide se um passo PODE rodar é o próprio gate, não a escada.
 */

const ESTADOS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED',
});

/** Ordem oficial. `requires` são ids de degraus anteriores. */
const DEGRAUS = Object.freeze([
  {
    id: 'fila',
    titulo: 'Fila oficial íntegra',
    comando: 'npm run validate:hardening-queue',
    requires: [],
    porque: 'toda a cadeia lê a fila; fila inválida invalida qualquer prova depois',
    corrige: 'corrigir campos/estado do item apontado no relatório',
  },
  {
    id: 'memoria',
    titulo: 'Memória operacional canônica',
    comando: 'npm run validate:ai-memory',
    requires: [],
    porque: 'documentação divergente da árvore torna a evidência não auditável',
    corrige: 'atualizar AI_MEMORY conforme o validador indica',
  },
  {
    id: 'dag',
    titulo: 'DAG de release sem violação de fase',
    comando: 'npm run validate:release-dag',
    requires: [],
    porque: 'gate que exige artefato de fase posterior é julgamento impossível',
    corrige: 'ajustar requiredPhase/produção do artefato',
  },
  {
    id: 'ancoras',
    titulo: 'Âncoras externas provisionadas e coerentes',
    comando: 'node scripts/governance/provision-closure-anchors.js --check',
    requires: [],
    porque: 'sem âncora fora da árvore, fechamento é declaração, não prova',
    corrige: 'provisionar os 3 segredos e, se os pins estiverem vazios, criar os pins versionados',
    dono: true,
  },
  {
    id: 'fechamentos',
    titulo: 'Fechamentos com prova válida',
    comando: 'npm run validate:bug-closure-status',
    requires: ['ancoras'],
    porque: 'FECHAMENTO_SEM_PROVA_VALIDA é o que bloqueia L2/L3 e as waves',
    corrige: 'assinar as provas (authority com mayCloseDefects) ou reabrir o defeito',
    dono: true,
  },
  {
    id: 'execucao-autoritativa',
    titulo: 'Execução autoritativa das suítes de release',
    comando: 'RELEASE_AUTHORITATIVE=1 node scripts/governance/run-release-suites.js',
    requires: ['fechamentos'],
    porque: 'produz reports/release-suite-execution.json — fonte do required-tests',
    corrige: 'rodar depois que o guard liberar (ele recusa por desenho)',
  },
  {
    id: 'required-tests',
    titulo: 'Testes obrigatórios provados',
    comando: 'npm run validate:required-tests',
    requires: ['execucao-autoritativa'],
    porque: '68 itens ficam NOT_EXECUTED sem o registro autoritativo',
    corrige: 'reexecutar depois da execução autoritativa',
  },
  {
    id: 'waves',
    titulo: 'Evidências de wave frescas',
    comando: 'npm run wave:db-integrity && npm run wave:api-surface && npm run wave:page-surface',
    requires: ['fechamentos'],
    porque: 'o coverage gate degrada VALIDATED -> STALE após 7 dias',
    corrige: 'disparar .github/workflows/wave-reports.yml quando o guard liberar',
  },
  {
    id: 'cobertura',
    titulo: 'Coverage gate',
    comando: 'npm run validate:coverage-gate',
    requires: ['waves'],
    porque: 'cobertura é insumo de decisão; evidência vencida não conta',
    corrige: 'renovar waves e reexecutar',
  },
  {
    id: 'agregado',
    titulo: 'Gate agregado (veredito final)',
    comando: 'npm run validate:governance-enforcement',
    requires: ['fila', 'memoria', 'dag', 'fechamentos', 'required-tests', 'cobertura'],
    porque: 'é o veredito que a governança publica',
    corrige: 'resolver os degraus anteriores na ordem',
  },
]);

const POR_ID = new Map(DEGRAUS.map((d) => [d.id, d]));

function degrau(id) {
  return POR_ID.get(id) || null;
}

/**
 * Decide se um degrau PODE rodar, dados os resultados já conhecidos.
 * @param {string} id
 * @param {Object<string,{state:string}>} resultados
 * @returns {{runnable:boolean, blockedBy:string[]}}
 */
function podeRodar(id, resultados = {}) {
  const passo = degrau(id);
  if (!passo) return { runnable: false, blockedBy: ['DEGRAU_DESCONHECIDO'] };
  const pendentes = passo.requires.filter((req) => {
    const r = resultados[req];
    return !r || r.state !== ESTADOS.PASS;
  });
  return { runnable: pendentes.length === 0, blockedBy: pendentes };
}

/**
 * Executa a escada com runners injetados (o script real passa spawn; os testes passam funções).
 * @param {{runners: Object<string, Function>, resultados?: object}} opcoes
 */
async function executarEscada({ runners = {}, resultados = {} } = {}) {
  const saida = { ...resultados };
  const trilha = [];

  for (const passo of DEGRAUS) {
    const { runnable, blockedBy } = podeRodar(passo.id, saida);
    if (!runnable) {
      saida[passo.id] = {
        state: ESTADOS.BLOCKED,
        blockedBy,
        detail: `pré-requisito não cumprido: ${blockedBy.join(', ')}`,
      };
      trilha.push({ id: passo.id, ...saida[passo.id] });
      continue;
    }

    const runner = runners[passo.id];
    if (typeof runner !== 'function') {
      saida[passo.id] = { state: ESTADOS.SKIPPED, detail: 'sem runner injetado' };
      trilha.push({ id: passo.id, ...saida[passo.id] });
      continue;
    }

    try {
      const r = await runner(passo);
      const estado = r && r.skipped ? ESTADOS.SKIPPED : (r && r.ok ? ESTADOS.PASS : ESTADOS.FAIL);
      saida[passo.id] = {
        state: estado,
        exitCode: r ? r.exitCode : null,
        detail: (r && r.detail) || null,
      };
    } catch (error) {
      saida[passo.id] = { state: ESTADOS.FAIL, detail: String(error && error.message ? error.message : error) };
    }
    trilha.push({ id: passo.id, ...saida[passo.id] });
  }

  const resumo = Object.values(ESTADOS).reduce((acc, estado) => {
    acc[estado] = trilha.filter((t) => t.state === estado).length;
    return acc;
  }, {});

  return { trilha, resultados: saida, resumo, certificavel: resumo.FAIL === 0 && resumo.BLOCKED === 0 };
}

module.exports = { ESTADOS, DEGRAUS, degrau, podeRodar, executarEscada };
