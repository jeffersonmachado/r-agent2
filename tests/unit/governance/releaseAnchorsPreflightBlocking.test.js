'use strict';

/**
 * P1-C — PREFLIGHT DE ÂNCORAS NÃO BLOQUEANTE (missão Codex 2026-10-23).
 *
 * Defeito: em `.github/workflows/release-governance.yml` o passo
 * "Preflight das âncoras do Bug Closure" tinha `continue-on-error: true`. O script
 * `provision-closure-anchors.js --check` já devolvia exit 1 para âncora ausente/inválida/
 * divergente, mas o GitHub Actions ignorava a falha: `governance-core` ficava verde e
 * `release-gate` imprimia "Release autorizado" com âncora de confiança inexistente.
 *
 * Este teste NÃO faz busca textual no YAML: ele LÊ o workflow com um parser de verdade,
 * EXTRAI os passos e EXECUTA os comandos reais (`run:`) do preflight e do gate com ambientes
 * controlados, aplicando a semântica do Actions (passo que falha derruba o job, salvo
 * `continue-on-error: true`).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(RAIZ, '.github', 'workflows', 'release-governance.yml');
const SCRIPT = path.join(RAIZ, 'scripts', 'governance', 'provision-closure-anchors.js');

function carregarWorkflow() {
  const yaml = require('js-yaml');
  return yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));
}

const passosDoJob = (wf, job) => (wf.jobs[job] && wf.jobs[job].steps) || [];
const acharPasso = (passos, agulha) => passos.find((p) => String(p.name || '').includes(agulha));

/** Digest canônico do inventário — o MESMO que o script compara. */
function digestDoInventario() {
  const { digestDoInventario: fn } = require(path.join(RAIZ, 'governance', 'bug-closure', 'trusted-authorities'));
  const fila = JSON.parse(fs.readFileSync(path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));
  return fn(fila.items);
}

/** Executa o comando de um passo como o runner faria (bash, cwd raiz, env controlado). */
function executarPasso(passo, env) {
  try {
    const saida = execFileSync('bash', ['-c', String(passo.run)], {
      cwd: RAIZ, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, saida };
  } catch (e) {
    return { exitCode: typeof e.status === 'number' ? e.status : 1, saida: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Semântica do Actions: passo falho derruba o job, salvo `continue-on-error: true`. */
function jobFalha(passo, resultado) {
  if (resultado.exitCode === 0) return false;
  return passo['continue-on-error'] !== true;
}

const AMBIENTES = (() => {
  const digest = digestDoInventario();
  return {
    valido: {
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: 'a'.repeat(64),
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: 'b'.repeat(64),
      RAP_CLOSURE_INVENTORY_SHA256: digest,
    },
    ausente: {},
    vazio: { RAP_CLOSURE_TRUST_ANCHOR_SHA256: '', RAP_APPROVAL_TRUST_ANCHOR_SHA256: '', RAP_CLOSURE_INVENTORY_SHA256: '' },
    malformado: {
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: 'nao-e-hex',
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: 'zz'.repeat(32),
      RAP_CLOSURE_INVENTORY_SHA256: 'curto',
    },
    divergente: {
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: 'a'.repeat(64),
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: 'b'.repeat(64),
      RAP_CLOSURE_INVENTORY_SHA256: 'c'.repeat(64),
    },
  };
})();

describe('P1-C — o script real de preflight recusa âncora inválida (fixtures isoladas)', () => {
  test.each([
    ['ausente', 'ausente'],
    ['vazia', 'vazio'],
    ['malformada', 'malformado'],
    ['hash divergente', 'divergente'],
  ])('âncora %s ⇒ exit != 0 e motivo explícito', (_rotulo, chave) => {
    const env = { ...process.env };
    for (const nome of ['RAP_CLOSURE_TRUST_ANCHOR_SHA256', 'RAP_APPROVAL_TRUST_ANCHOR_SHA256', 'RAP_CLOSURE_INVENTORY_SHA256']) delete env[nome];
    let resultado;
    try {
      execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: RAIZ, env: { ...env, ...AMBIENTES[chave] }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      resultado = { exitCode: 0, saida: '' };
    } catch (e) {
      resultado = { exitCode: e.status, saida: `${e.stdout || ''}${e.stderr || ''}` };
    }
    expect(resultado.exitCode).toBe(1);
    expect(resultado.saida).toContain('"ok": false');
    expect(resultado.saida).toMatch(/RAP_(CLOSURE_TRUST_ANCHOR|APPROVAL_TRUST_ANCHOR|CLOSURE_INVENTORY)_SHA256/);
  }, 60000);

  test('âncora válida em fixture isolada ⇒ exit 0', () => {
    const env = { ...process.env };
    for (const nome of Object.keys(AMBIENTES.valido)) delete env[nome];
    const saida = execFileSync(process.execPath, [SCRIPT, '--check'], {
      cwd: RAIZ, env: { ...env, ...AMBIENTES.valido }, encoding: 'utf8',
    });
    expect(saida).toContain('"ok": true');
  }, 60000);
});

describe('P1-C — o workflow executa o preflight de forma BLOQUEANTE', () => {
  test('o passo de preflight do governance-core não tem continue-on-error', () => {
    const wf = carregarWorkflow();
    const passo = acharPasso(passosDoJob(wf, 'governance-core'), 'Preflight das âncoras');
    expect(passo).toBeTruthy();
    expect(passo['continue-on-error']).toBeUndefined();
    // E o comando é o script real com --check.
    expect(String(passo.run)).toContain('provision-closure-anchors.js --check');
  });

  test('executando o passo real com âncora ausente, o JOB falha (semântica do Actions)', () => {
    const wf = carregarWorkflow();
    const passo = acharPasso(passosDoJob(wf, 'governance-core'), 'Preflight das âncoras');
    const resultado = executarPasso(passo, AMBIENTES.ausente);
    expect(resultado.exitCode).not.toBe(0);
    expect(jobFalha(passo, resultado)).toBe(true);
    // E o release-gate recusa por causa do job vermelho (regra declarada no próprio workflow).
    const gate = passosDoJob(wf, 'release-gate');
    const verificacao = gate.find((p) => String(p.run || '').includes('CORE_RESULT'));
    expect(String(verificacao.run)).toContain('Tag, publish e release BLOQUEADOS');
  });

  test('tentativa de continuar após falha (continue-on-error) NÃO salvaguarda o release-gate', () => {
    const wf = carregarWorkflow();
    const passo = acharPasso(passosDoJob(wf, 'governance-core'), 'Preflight das âncoras');
    const resultado = executarPasso(passo, AMBIENTES.ausente);
    // Cenário adversário: alguém reintroduz `continue-on-error: true` no preflight.
    expect(jobFalha({ ...passo, 'continue-on-error': true }, resultado)).toBe(false);
    // Defesa em profundidade: o GATE revalida por conta própria e falha de qualquer forma.
    const revalidacao = acharPasso(passosDoJob(wf, 'release-gate'), 'Revalidar âncoras');
    expect(revalidacao).toBeTruthy();
    expect(revalidacao['continue-on-error']).toBeUndefined();
    const resultadoGate = executarPasso(revalidacao, AMBIENTES.ausente);
    expect(resultadoGate.exitCode).not.toBe(0);
    expect(jobFalha(revalidacao, resultadoGate)).toBe(true);
  });

  test('o release-gate revalida ANTES de declarar release autorizado', () => {
    const wf = carregarWorkflow();
    const gate = passosDoJob(wf, 'release-gate');
    const idxRevalidacao = gate.findIndex((p) => String(p.name || '').includes('Revalidar âncoras'));
    const idxAutorizacao = gate.findIndex((p) => String(p.run || '').includes('Release autorizado'));
    expect(idxRevalidacao).toBeGreaterThanOrEqual(0);
    expect(idxAutorizacao).toBeGreaterThan(idxRevalidacao);
  });

  test('a revalidação do gate usa o ambiente real das âncoras (não um valor fixo)', () => {
    const wf = carregarWorkflow();
    const revalidacao = acharPasso(passosDoJob(wf, 'release-gate'), 'Revalidar âncoras');
    expect(String(revalidacao.run)).toContain('--check');
    expect(revalidacao.env.RAP_CLOSURE_TRUST_ANCHOR_SHA256).toContain('secrets.RAP_CLOSURE_TRUST_ANCHOR_SHA256');
    expect(revalidacao.env.RAP_CLOSURE_INVENTORY_SHA256).toContain('secrets.RAP_CLOSURE_INVENTORY_SHA256');
    expect(revalidacao.env.RAP_APPROVAL_TRUST_ANCHOR_SHA256).toContain('secrets.RAP_APPROVAL_TRUST_ANCHOR_SHA256');
  });

  test('remaining continue-on-error são apenas uploads de diagnóstico (nunca gate)', () => {
    const wf = carregarWorkflow();
    const comTolerancia = [];
    for (const [nomeJob, job] of Object.entries(wf.jobs)) {
      for (const passo of job.steps || []) {
        if (passo['continue-on-error'] === true) comTolerancia.push({ job: nomeJob, nome: String(passo.name || ''), usa: String(passo.uses || '') });
      }
    }
    // Toda tolerância restante precisa ser upload de artefato (diagnóstico), nunca execução de gate.
    for (const p of comTolerancia) {
      expect(p.usa.startsWith('actions/upload-artifact')).toBe(true);
      expect(p.nome.toLowerCase()).toMatch(/upload|diagn/);
    }
  });

  test('o caminho DEVELOPMENT não depende deste workflow (L0/L1 seguem em workflow próprio)', () => {
    // `release-governance.yml` só dispara em main/develop/release/hotfix — o gate de
    // desenvolvimento é outro workflow e não exige âncora de release.
    const wf = carregarWorkflow();
    const gatilhos = Object.keys(wf.on || {});
    expect(gatilhos).toContain('push');
    const branches = wf.on.push.branches || [];
    expect(branches).toContain('main');
    const devWorkflow = path.join(RAIZ, '.github', 'workflows', 'dev-branch-ci.yml');
    expect(fs.existsSync(devWorkflow)).toBe(true);
    const dev = fs.readFileSync(devWorkflow, 'utf8');
    // O gate de desenvolvimento não pode exigir âncora de release para rodar L0/L1.
    expect(dev).not.toContain('RAP_CLOSURE_TRUST_ANCHOR_SHA256');
  });
});
