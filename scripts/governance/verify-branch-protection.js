#!/usr/bin/env node
'use strict';

/**
 * P0-7 — Protecao de branch main (enforcement executavel).
 *
 * Mede o estado REAL no GitHub e grava reports/branch-protection-report.json.
 * Nao declara PASS por ausencia de medicao: se a API estiver inacessivel o
 * status e UNKNOWN (nunca PASS) e o gate NAO libera.
 *
 *   node scripts/governance/verify-branch-protection.js            # mede e reporta
 *   node scripts/governance/verify-branch-protection.js --apply    # aplica o estado desejado (quando o plano permitir)
 *
 * Exit codes:
 *   0  PASS            protecao ativa e coerente com o config
 *   0  BLOCKED_EXTERNAL plano do GitHub nao permite protecao em repo privado (bloqueio externo comprovado)
 *   1  FAIL            desprotegido E aplicavel (o agente deveria ter aplicado)
 *   2  UNKNOWN         nao foi possivel medir (sem gh/rede); nunca tratado como verde
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'governance', 'branch-protection.config.json');
const REPORT_PATH = path.join(ROOT, 'reports', 'branch-protection-report.json');

const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED_EXTERNAL: 'BLOCKED_EXTERNAL',
  UNKNOWN: 'UNKNOWN',
};

const EXIT = {
  PASS: 0,
  BLOCKED_EXTERNAL: 0,
  FAIL: 1,
  UNKNOWN: 2,
};

function carregarConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!cfg.branch) throw new Error('branch-protection.config.json sem "branch"');
  if (!cfg.desired || typeof cfg.desired !== 'object') {
    throw new Error('branch-protection.config.json sem "desired"');
  }
  return cfg;
}

function gh(args) {
  try {
    const out = execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim(), status: 0 };
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    const stdout = (err.stdout || '').toString();
    return { ok: false, out: (stdout || stderr).trim(), status: err.status == null ? -1 : err.status };
  }
}

function medir(repo, branch, ghRunner = gh) {
  const meta = ghRunner(['api', `repos/${repo}`, '--jq', '{private:.private,visibility:.visibility,plan:.owner.type}']);
  if (!meta.ok) return { status: STATUS.UNKNOWN, motivo: `gh_meta_falhou: ${meta.out.slice(0, 200)}` };

  let metaJson = null;
  try { metaJson = JSON.parse(meta.out); } catch (_) { metaJson = null; }

  const branchInfo = ghRunner(['api', `repos/${repo}/branches/${branch}`, '--jq', '{protected:.protected}']);
  if (!branchInfo.ok) return { status: STATUS.UNKNOWN, motivo: `gh_branch_falhou: ${branchInfo.out.slice(0, 200)}` };

  let protegida = false;
  try { protegida = JSON.parse(branchInfo.out).protected === true; } catch (_) { protegida = false; }

  const protection = ghRunner(['api', `repos/${repo}/branches/${branch}/protection`]);
  const planoBloqueia = protection.ok
    ? false
    : /Upgrade to GitHub Pro|make this repository public/i.test(protection.out);

  return {
    status: null,
    protegida,
    planoBloqueia,
    protectionProbe: protection.ok ? 'HTTP_200' : `HTTP_${protection.status}`,
    protectionMensagem: protection.ok ? null : protection.out.slice(0, 300),
    repo: metaJson,
  };
}

function coerente(protectionBody, desired) {
  const divergencias = [];
  const ler = (campo) => (protectionBody && protectionBody[campo] ? protectionBody[campo] : null);
  const booleano = (campo) => {
    const v = ler(campo);
    return v && typeof v.enabled === 'boolean' ? v.enabled : null;
  };

  if (desired.allow_force_pushes === false && booleano('allow_force_pushes') === true) {
    divergencias.push('allow_force_pushes_ativo');
  }
  if (desired.allow_deletions === false && booleano('allow_deletions') === true) {
    divergencias.push('allow_deletions_ativo');
  }
  if (desired.required_status_checks === null && ler('required_status_checks')) {
    divergencias.push('required_status_checks_inesperado');
  }
  if (desired.enforce_admins === false && booleano('enforce_admins') === true) {
    divergencias.push('enforce_admins_inesperado');
  }
  return divergencias;
}

/**
 * Decisao PURA: observacao -> { status, blocking, motivo }. Sem I/O e sem rede,
 * para que o gate possa ser provado nos dois sentidos (verde e vermelho).
 */
function decidir({ medicao, divergencias = [], aplicarFlag = false, aplicado = null }) {
  if (!medicao || medicao.status === STATUS.UNKNOWN) {
    return {
      status: STATUS.UNKNOWN,
      blocking: true,
      motivo: (medicao && medicao.motivo) || 'medicao_ausente',
    };
  }
  if (medicao.protegida) {
    if (divergencias.length > 0) {
      return { status: STATUS.FAIL, blocking: true, motivo: 'protecao_ativa_mas_divergente_do_config' };
    }
    return { status: STATUS.PASS, blocking: false, motivo: null };
  }
  if (medicao.planoBloqueia) {
    return {
      status: STATUS.BLOCKED_EXTERNAL,
      blocking: false,
      motivo: 'plano_do_github_nao_permite_protecao_em_repo_privado',
      resolution: 'exige plano pago (Pro/Team/Enterprise) OU tornar o repositorio publico; ambos fora da autoridade do agente',
    };
  }
  if (aplicarFlag && aplicado && aplicado.ok) {
    return { status: STATUS.PASS, blocking: false, motivo: 'protecao_aplicada_com_sucesso' };
  }
  if (aplicarFlag && aplicado && !aplicado.ok) {
    return { status: STATUS.FAIL, blocking: true, motivo: 'aplicacao_da_protecao_falhou' };
  }
  return {
    status: STATUS.FAIL,
    blocking: true,
    motivo: 'branch_desprotegida_e_aplicavel_sem_bloqueio_de_plano',
    acao: 'rodar: npm run branch-protection:apply',
  };
}

function aplicar(repo, branch, desired, ghRunner = gh) {
  const args = ['api', '-X', 'PUT', `repos/${repo}/branches/${branch}/protection`];
  const mapa = {
    enforce_admins: 'enforce_admins',
    required_status_checks: 'required_status_checks',
    required_pull_request_reviews: 'required_pull_request_reviews',
    restrictions: 'restrictions',
    required_linear_history: 'required_linear_history',
    allow_force_pushes: 'allow_force_pushes',
    allow_deletions: 'allow_deletions',
    required_conversation_resolution: 'required_conversation_resolution',
    lock_branch: 'lock_branch',
  };
  for (const [chave, campo] of Object.entries(mapa)) {
    const valor = desired[chave];
    if (valor === null) continue;
    args.push('-F', `${campo}=${valor === true ? 'true' : 'false'}`);
  }
  const r = ghRunner(args);
  return { ok: r.ok, status: r.status, out: r.out.slice(0, 300) };
}

function escrever(relatorio) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(relatorio, null, 2)}\n`);
  const protegida = relatorio.observed && relatorio.observed.protected != null
    ? relatorio.observed.protected
    : 'n/d';
  console.log(
    `[branch-protection] status=${relatorio.status} protected=${protegida} `
    + `divergencias=${relatorio.divergences.length} blocking=${relatorio.blocking}`
  );
  if (relatorio.status === STATUS.BLOCKED_EXTERNAL && relatorio.observed) {
    console.log(`[branch-protection] BLOQUEIO EXTERNO: ${relatorio.observed.protectionMessage}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const aplicarFlag = argv.includes('--apply');
  const cfg = carregarConfig();
  const { repository: repo, branch } = cfg;

  const medicao = medir(repo, branch);
  const observed = medicao.status === STATUS.UNKNOWN
    ? { motivo: medicao.motivo }
    : {
        protected: medicao.protegida,
        planBlocksProtection: medicao.planoBloqueia,
        protectionProbe: medicao.protectionProbe,
        protectionMessage: medicao.protectionMensagem,
        repo: medicao.repo,
      };

  let divergencias = [];
  let aplicado = null;

  if (medicao.status !== STATUS.UNKNOWN && medicao.protegida) {
    const protection = gh(['api', `repos/${repo}/branches/${branch}/protection`]);
    if (protection.ok) {
      let body = null;
      try { body = JSON.parse(protection.out); } catch (_) { body = null; }
      divergencias = coerente(body, cfg.desired);
    }
  }

  if (medicao.status !== STATUS.UNKNOWN && !medicao.protegida && !medicao.planoBloqueia && aplicarFlag) {
    aplicado = aplicar(repo, branch, cfg.desired);
  }

  const decisao = decidir({ medicao, divergencias, aplicarFlag, aplicado });
  const relatorio = {
    generatedAt: new Date().toISOString(),
    configVersion: cfg.version,
    repository: repo,
    branch,
    desired: cfg.desired,
    observed,
    applied: aplicado,
    divergences: divergencias,
    ...decisao,
  };

  escrever(relatorio);
  return EXIT[decisao.status] == null ? 2 : EXIT[decisao.status];
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`[branch-protection] erro fatal: ${err && err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { STATUS, EXIT, carregarConfig, medir, coerente, decidir, aplicar, main, ROOT, REPORT_PATH };
