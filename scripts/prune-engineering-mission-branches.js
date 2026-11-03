#!/usr/bin/env node
'use strict';

/**
 * prune-engineering-mission-branches.js — HIGIENE das refs `engineering/missions/*`.
 *
 * PROBLEMA MEDIDO (2026-10-20): 3.017 branches `engineering/missions/<missionId>` e
 * 86 `engineering-router/candidates` residuais no repositório, sem NENHUMA poda em código
 * de produção (`grep deleteBranch|branch -D` em api/services/engineeringRouter|engineeringMission
 * → zero). O acúmulo degrada operações git e a reprodutibilidade das medições
 * (ENGINEER_SUPERVISED_READINESS §4.4 já atribui instabilidade do coletor a ~2.910 branches).
 *
 * CRITÉRIO DE SEGURANÇA (mesma filosofia de `prune-test-engineering-missions.js`):
 *   1. Só considera branches de missão (prefixo `engineering/missions/`).
 *   2. Candidata = branch cujo missionId NÃO existe em `engineering_missions` (ÓRFÃ) OU cuja
 *      missão é fixture de teste (`created_by` com marcador de teste). Missão de USUÁRIO viva
 *      NUNCA é candidata — nem listada como tal.
 *   3. Não toca em branch que seja a branch corrente nem em ref cujo missionId está em missão
 *      não-terminal sem marcador de teste.
 *   4. DRY-RUN por padrão. Remoção exige `--apply`.
 *
 * Uso:
 *   node --env-file-if-exists=.env scripts/prune-engineering-mission-branches.js
 *   node --env-file-if-exists=.env scripts/prune-engineering-mission-branches.js --apply
 *   ... --limit 200 --json reports/branch-prune-report.json
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'engineering/missions/';

const APPLY = process.argv.includes('--apply');
const JSON_OUT = (() => {
  const i = process.argv.indexOf('--json');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
})();

/** Marcadores de origem de TESTE/FERRAMENTA — igual ao prune de banco. */
const TEST_MARKER_PATTERNS = [
  /^jest-/i,
  /^verify-/i,
  /^timeout-architecture-e2e$/i,
  /^sanity$/i,
  /measure/i,
];

function isTestFixture(createdBy) {
  const value = String(createdBy || '');
  if (value.length === 0) return false;
  return TEST_MARKER_PATTERNS.some((pattern) => pattern.test(value));
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function listMissionBranches() {
  const out = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out.split('\n').map((s) => s.trim()).filter((s) => s.startsWith(PREFIX));
}

function currentBranch() {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch (_) {
    return null;
  }
}

/**
 * Classifica uma branch: `orphan` (missão inexistente), `test_fixture`
 * (missão de teste viva) ou `keep` (missão de usuário / sem evidência).
 * PURA — testável sem banco.
 * @param {{branch:string, mission?:object|null}} input
 * @returns {{branch:string, missionId:string, decision:string, reason:string}}
 */
function classifyBranch({ branch, mission }) {
  const missionId = branch.slice(PREFIX.length);
  if (!mission) {
    return {
      branch, missionId, decision: 'orphan', reason: 'missionId não existe em engineering_missions',
    };
  }
  if (isTestFixture(mission.created_by)) {
    return {
      branch, missionId, decision: 'test_fixture', reason: `created_by de teste (${mission.created_by})`,
    };
  }
  return {
    branch, missionId, decision: 'keep', reason: `missão de usuário (status=${mission.status || '?'})`,
  };
}

async function main() {
  const branches = listMissionBranches();
  const atual = currentBranch();

  // Carrega as missões correspondentes (só as que existem) — sem banco acessível,
  // NADA é candidato: "não sei se a missão existe" nunca vira "pode apagar".
  let missoesPorId = new Map();
  let erroBanco = null;
  try {
    const db = require(path.join(ROOT, 'api', 'db'));
    await db.connect();
    const Mission = require(path.join(ROOT, 'api', 'db', 'models')).EngineeringMission();
    const ids = branches.map((b) => b.slice(PREFIX.length));
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await Mission.findAll({
        where: { id: ids.slice(i, i + CHUNK) },
        attributes: ['id', 'status', 'created_by'],
        raw: true,
      });
      for (const row of rows) missoesPorId.set(String(row.id), row);
    }
  } catch (err) {
    erroBanco = err.message;
  }

  if (erroBanco) {
    const saida = {
      status: 'INFRA_ERROR',
      detail: `banco indisponível (${erroBanco}) — sem banco NENHUMA branch é candidata`,
      branches: branches.length,
      applied: false,
    };
    console.log(JSON.stringify(saida, null, 2));
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(saida, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const classificadas = branches.map((branch) => {
    const c = classifyBranch({ branch, mission: missoesPorId.get(branch.slice(PREFIX.length)) });
    if (branch === atual) return { ...c, decision: 'keep', reason: 'branch corrente (HEAD)' };
    return c;
  });

  const candidatas = classificadas.filter((c) => c.decision === 'orphan' || c.decision === 'test_fixture');
  const alvo = LIMIT ? candidatas.slice(0, LIMIT) : candidatas;

  let removidas = 0;
  const falhas = [];
  if (APPLY) {
    for (const c of alvo) {
      try {
        git(['branch', '-D', c.branch]);
        removidas += 1;
      } catch (err) {
        falhas.push({ branch: c.branch, error: String(err.message || err).slice(0, 200) });
      }
    }
  }

  const resumo = {
    status: falhas.length === 0 ? 'PASS' : 'PARTIAL',
    applied: APPLY,
    branchesTotal: branches.length,
    candidatas: candidatas.length,
    orfas: classificadas.filter((c) => c.decision === 'orphan').length,
    fixturesDeTeste: classificadas.filter((c) => c.decision === 'test_fixture').length,
    mantidas: classificadas.filter((c) => c.decision === 'keep').length,
    alvo: alvo.length,
    removidas,
    falhas,
    limiteAplicado: LIMIT,
    amostraMantidas: classificadas.filter((c) => c.decision === 'keep').slice(0, 10),
  };

  console.log(JSON.stringify(resumo, null, 2));
  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, `${JSON.stringify(resumo, null, 2)}\n`);
  }
  if (falhas.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[prune-branches] falha: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { classifyBranch, isTestFixture, PREFIX };
