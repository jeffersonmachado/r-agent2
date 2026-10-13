#!/usr/bin/env node
'use strict';

/**
 * check-postgres-budget.js — orçamento de conexões do PostgreSQL (Fase 10).
 *
 * PROBLEMA QUE ISTO RESOLVE
 * Cada workload dimensiona o próprio pool isoladamente (`DB_POOL_MAX=40` na API, pool
 * próprio do runner, pool dos lotes da suíte autoritativa, RAG em Python…). Nenhum
 * deles enxerga os outros, então a soma TEÓRICA dos máximos passa de
 * `max_connections` e o estouro aparece como erro VAZIO do Sequelize — já confundido
 * com "suíte instável" (medido: lote do runner falhando com `Error:` sem mensagem).
 *
 * O QUE ESTE GATE FAZ
 *   1. Lê a política declarada (`config/postgres-budget.json`): teto do servidor,
 *      reserva de superusuário, margem, orçamento POR CLASSE e POR CENÁRIO.
 *   2. Verifica a INVARIANTE: cada cenário declarado precisa caber no teto útil.
 *      Cenário que não cabe é `OVER_BUDGET` (exit 1) — o orçamento é uma declaração,
 *      não um desejo.
 *   3. MEDE o consumo real (`pg_stat_activity`) e compara com o orçamento da classe.
 *      Utilização acima do limite da classe é `CLASS_OVER_BUDGET` (exit 1); acima de
 *      `warnAt` é aviso.
 *   4. Nunca aumenta `max_connections`: se o orçamento não couber, o relatório diz
 *      qual classe cortar. PgBouncer (multiplexação) só entra com medição que
 *      justifique — decisão humana, não default.
 *
 * Modos: padrão (decide, exit 1 em violação) | --informative (exit 0, relatório real)
 * Sem banco acessível: `EVIDENCE_UNAVAILABLE` (exit 3) — nunca PASS por ausência de
 * medição.
 *
 * Relatório: reports/postgres-budget-report.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT, 'config', 'postgres-budget.json');
const REPORT = path.join(ROOT, 'reports', 'postgres-budget-report.json');
const informatice = process.argv.includes('--informative') || process.env.POSTGRES_BUDGET_MODE === 'advisory';

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function loadPolicy() {
  if (!fs.existsSync(POLICY_PATH)) return null;
  return readJson(POLICY_PATH);
}

/**
 * Mapeia uma conexão para a CLASSE de workload do orçamento.
 *
 * A fonte CONFIÁVEL é `application_name`, que cada workload passa a declarar (API:
 * `rap-api`; runner/lotes: via `PGAPPNAME`). O `usename` só entra como pista fraca:
 * medido em 2026-10-11, TODAS as conexões chegavam com `application_name` vazio e
 * usuário `postgres`, então o orçamento por classe era inviável — conexão que não se
 * identifica vai para `unattributed` e o relatório mostra quanto ficou sem atribuição
 * (um orçamento que não consegue atribuir consumo não verifica nada).
 */
function classifyConnection({ applicationName, userName } = {}) {
  const app = String(applicationName || '').toLowerCase();
  const user = String(userName || '').toLowerCase();
  if (/eng[-_]?runner|engineering[-_]?runner/.test(app)) return 'engineering_runner';
  if (/jest|release[-_]?suites|authoritative/.test(app)) return 'jest_authoritative';
  if (/mesh/.test(app)) return 'qa_mesh';
  if (/rag/.test(app)) return 'rag_service';
  if (/rap[-_]?api|api/.test(app)) return 'api';
  if (/tool|script|gov/.test(app)) return 'tools';
  // Sem identificação declarada: NÃO chutar classe (chutar esconderia consumo).
  if (app.trim() === '') {
    if (/rag|uvicorn|python/.test(user)) return 'rag_service';
    return 'unattributed';
  }
  return 'unattributed';
}

/**
 * Verifica a INVARIANTE dos cenários. PURA.
 * @returns {{violations: Array<{code:string,detail:object}>, usefullCeiling:number}}
 */
function checkScenarioInvariant({ database, classes, scenarios }) {
  const violations = [];
  const teto = Number(database.maxConnections) - Number(database.superuserReservedConnections || 0);
  const util = teto - Number(database.safetyMargin || 0);
  for (const [nome, cenario] of Object.entries(scenarios || {})) {
    const simultaneas = Array.isArray(cenario.simultaneous) ? cenario.simultaneous : [];
    const soma = simultaneas.reduce((acc, classe) => acc + Number((classes[classe] || {}).max || 0), 0);
    if (soma > util) {
      violations.push({
        code: 'SCENARIO_OVER_BUDGET',
        detail: { scenario: nome, declaredMax: cenario.max, sumOfClasses: soma, usableCeiling: util },
      });
    } else if (Number(cenario.max) !== soma) {
      // O número declarado do cenário precisa ser o resultado da soma das classes —
      // um "max" que não corresponde à soma é orçamento decorativo.
      violations.push({
        code: 'SCENARIO_MAX_INCONSISTENT',
        detail: { scenario: nome, declaredMax: cenario.max, sumOfClasses: soma },
      });
    }
  }
  return { violations, usefullCeiling: util };
}

/** Mede o consumo real agrupado por classe. */
async function measureConnections() {
  
  const { connect, getSequelize } = require(path.join(ROOT, 'api', 'db', 'sequelize'));
  await connect(3, 500);
  const sequelize = getSequelize();
  const [max] = await sequelize.query('SHOW max_connections', { type: sequelize.QueryTypes.SELECT });
  const rows = await sequelize.query(
    `SELECT coalesce(application_name,'') AS app, usename, state, count(*)::int AS n
       FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY 1,2,3`,
    { type: sequelize.QueryTypes.SELECT },
  );
  const porClasse = {};
  for (const row of rows) {
    const classe = classifyConnection({ applicationName: row.app, userName: row.usename });
    porClasse[classe] = (porClasse[classe] || 0) + Number(row.n);
  }
  return {
    maxConnectionsObserved: Number(max.max_connections),
    byClass: porClasse,
    total: Object.values(porClasse).reduce((a, b) => a + b, 0),
  };
}

async function main() {
  const policy = loadPolicy();
  if (!policy) {
    console.error('[postgres-budget] política ausente: config/postgres-budget.json');
    return 1;
  }

  const cenarioAtivo = String(process.env.POSTGRES_BUDGET_SCENARIO || 'dev_local');
  const { violations: violacoesCenario, usefullCeiling } = checkScenarioInvariant(policy);

  let medicao = null;
  let erroMedicao = null;
  try {
    medicao = await measureConnections();
  } catch (error) {
    erroMedicao = error.message;
  }

  const violacoes = [...violacoesCenario];
  const avisos = [];
  const cenario = (policy.scenarios || {})[cenarioAtivo];
  if (cenario && medicao) {
    // Consumo SEM identificação é aviso obrigatório: sem atribuição, o orçamento por
    // classe não está medindo o que diz medir.
    const naoAtribuidas = Number(medicao.byClass.unattributed || 0);
    if (medicao.total > 0 && naoAtribuidas / medicao.total > 0.3) {
      avisos.push({
        code: 'UNATTRIBUTED_CONNECTIONS',
        detail: { measured: naoAtribuidas, total: medicao.total, hint: 'declare PGAPPNAME/application_name no workload' },
      });
    }
    for (const classe of cenario.simultaneous || []) {
      const orcamento = Number((policy.classes[classe] || {}).max || 0);
      const medido = Number(medicao.byClass[classe] || 0);
      if (medido > orcamento) {
        violacoes.push({
          code: 'CLASS_OVER_BUDGET',
          detail: { scenario: cenarioAtivo, class: classe, measured: medido, budget: orcamento },
        });
      } else if (orcamento > 0 && medido / orcamento >= 0.8) {
        avisos.push({
          code: 'CLASS_NEAR_BUDGET',
          detail: { scenario: cenarioAtivo, class: classe, measured: medido, budget: orcamento },
        });
      }
    }
  }

  const estado = violacoesCenario.length > 0
    ? 'NO_GO'
    : (erroMedicao ? 'EVIDENCE_UNAVAILABLE' : (violacoes.length > 0 ? 'NO_GO' : 'GO'));

  const report = {
    status: estado,
    decision: estado === 'GO' ? 'GO' : 'NO_GO',
    exitCode: estado === 'GO' ? 0 : (estado === 'EVIDENCE_UNAVAILABLE' ? 3 : 1),
    scenario: cenarioAtivo,
    usableCeiling: usefullCeiling,
    database: policy.database,
    classes: policy.classes,
    scenarios: policy.scenarios,
    measured: medicao,
    measurementError: erroMedicao,
    violations: violacoes,
    warnings: avisos,
    policyVersion: policy.version,
    generatedAt: new Date().toISOString(),
    note: policy.invariants ? policy.invariants.neverRaiseMaxConnectionsBlindly : null,
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[postgres-budget] cenário=${cenarioAtivo} estado=${estado} teto_util=${usefullCeiling}`);
  if (medicao) {
    console.log(`[postgres-budget] medido: total=${medicao.total} (max_connections=${medicao.maxConnectionsObserved}) por classe=${JSON.stringify(medicao.byClass)}`);
  } else {
    console.log(`[postgres-budget] medição indisponível: ${erroMedicao}`);
  }
  for (const v of violacoes) console.log(`  ✗ ${v.code}: ${JSON.stringify(v.detail)}`);
  for (const w of avisos) console.log(`  ! ${w.code}: ${JSON.stringify(w.detail)}`);
  console.log(`[postgres-budget] relatório: ${path.relative(ROOT, REPORT)}`);

  if (estado === 'GO') return 0;
  if (informatice) {
    console.log(`[postgres-budget] modo advisory: exit 0, estado real = ${estado}`);
    return 0;
  }
  return report.exitCode;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[postgres-budget] erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { classifyConnection, checkScenarioInvariant, loadPolicy };
