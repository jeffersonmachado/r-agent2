'use strict';

/**
 * P0-7 — prova do gate de protecao de branch.
 *
 * Nao basta "existir o script": a decisao tem que ser provada nos DOIS sentidos.
 * Aqui a rede e injetada (ghRunner) para que o gate possa ser exercitado sem
 * tocar o GitHub, e o teste cobre explicitamente a regra "nunca PASS por
 * ausencia de medicao".
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const gate = require(path.join(ROOT, 'scripts', 'governance', 'verify-branch-protection.js'));

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'governance', 'branch-protection.config.json'), 'utf8')
);

function medicaoProtegida() {
  return { status: null, protegida: true, planoBloqueia: false, protectionProbe: 'HTTP_200', protectionMensagem: null };
}

function medicaoDesprotegida({ planoBloqueia = false } = {}) {
  return {
    status: null,
    protegida: false,
    planoBloqueia,
    protectionProbe: planoBloqueia ? 'HTTP_403' : 'HTTP_404',
    protectionMensagem: planoBloqueia ? 'Upgrade to GitHub Pro or make this repository public to enable this feature.' : null,
  };
}

describe('P0-7 protecao de branch main', () => {
  test('o config desejado proibe force-push e delecao de main', () => {
    expect(CONFIG.branch).toBe('main');
    expect(CONFIG.desired.allow_force_pushes).toBe(false);
    expect(CONFIG.desired.allow_deletions).toBe(false);
    expect(CONFIG.desired.required_status_checks).toBeNull();
  });

  test('sem medicao (gh indisponivel) o status e UNKNOWN e NUNCA PASS', () => {
    const r = gate.decidir({ medicao: { status: gate.STATUS.UNKNOWN, motivo: 'gh_meta_falhou: not found' } });
    expect(r.status).toBe(gate.STATUS.UNKNOWN);
    expect(r.blocking).toBe(true);
    expect(gate.EXIT[r.status]).toBe(2);
  });

  test('medicao ausente tambem e UNKNOWN (nunca aprovar por ausencia)', () => {
    const r = gate.decidir({ medicao: null });
    expect(r.status).toBe(gate.STATUS.UNKNOWN);
    expect(r.motivo).toBe('medicao_ausente');
  });

  test('protegida e coerente com o config => PASS (nao-vacuidade: o gate sabe ficar verde)', () => {
    const r = gate.decidir({ medicao: medicaoProtegida(), divergencias: [] });
    expect(r.status).toBe(gate.STATUS.PASS);
    expect(r.blocking).toBe(false);
    expect(gate.EXIT[r.status]).toBe(0);
  });

  test('protegida mas com force-push ativo => FAIL (protecao divergente do config)', () => {
    const r = gate.decidir({
      medicao: medicaoProtegida(),
      divergencias: ['allow_force_pushes_ativo'],
    });
    expect(r.status).toBe(gate.STATUS.FAIL);
    expect(r.blocking).toBe(true);
    expect(gate.EXIT[r.status]).toBe(1);
  });

  test('desprotegida com o plano bloqueando => BLOCKED_EXTERNAL (com a resolucao declarada)', () => {
    const r = gate.decidir({ medicao: medicaoDesprotegida({ planoBloqueia: true }) });
    expect(r.status).toBe(gate.STATUS.BLOCKED_EXTERNAL);
    expect(r.blocking).toBe(false);
    expect(r.resolution).toMatch(/plano pago/i);
    expect(gate.EXIT[r.status]).toBe(0);
  });

  test('desprotegida e aplicavel sem --apply => FAIL, com a acao nomeada', () => {
    const r = gate.decidir({ medicao: medicaoDesprotegida(), aplicarFlag: false });
    expect(r.status).toBe(gate.STATUS.FAIL);
    expect(r.acao).toMatch(/branch-protection:apply/);
    expect(gate.EXIT[r.status]).toBe(1);
  });

  test('--apply bem sucedido => PASS; --apply falho => FAIL', () => {
    const ok = gate.decidir({ medicao: medicaoDesprotegida(), aplicarFlag: true, aplicado: { ok: true } });
    expect(ok.status).toBe(gate.STATUS.PASS);
    const falhou = gate.decidir({
      medicao: medicaoDesprotegida(),
      aplicarFlag: true,
      aplicado: { ok: false, out: 'HTTP 403' },
    });
    expect(falhou.status).toBe(gate.STATUS.FAIL);
  });

  test('coerente(): detecta force-push, delecao e status check inesperado', () => {
    const divergentes = gate.coerente(
      {
        allow_force_pushes: { enabled: true },
        allow_deletions: { enabled: true },
        required_status_checks: { contexts: ['x'] },
        enforce_admins: { enabled: true },
      },
      CONFIG.desired
    );
    expect(divergentes).toEqual(
      expect.arrayContaining([
        'allow_force_pushes_ativo',
        'allow_deletions_ativo',
        'required_status_checks_inesperado',
        'enforce_admins_inesperado',
      ])
    );

    const aderente = gate.coerente(
      {
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        required_status_checks: null,
        enforce_admins: { enabled: false },
      },
      CONFIG.desired
    );
    expect(aderente).toEqual([]);
  });

  test('medir() usa ghRunner injetado e classifica o 403 de plano como bloqueio de plano', () => {
    const respostas = [
      { ok: true, out: '{"private":true,"visibility":"private","plan":"User"}', status: 0 },
      { ok: true, out: '{"protected":false}', status: 0 },
      { ok: false, out: 'Upgrade to GitHub Pro or make this repository public to enable this feature.', status: 403 },
    ];
    const ghRunner = jest.fn(() => respostas.shift());
    const m = gate.medir('owner/repo', 'main', ghRunner);
    expect(ghRunner).toHaveBeenCalledTimes(3);
    expect(m.protegida).toBe(false);
    expect(m.planoBloqueia).toBe(true);
    expect(m.protectionProbe).toBe('HTTP_403');
  });

  test('o config canonico esta VERSIONADO (nao engolido por governance/*.json)', () => {
    // Armadilha medida: `governance/*.json` no .gitignore engolia o arquivo, o
    // `git add` era recusado em silencio e o gate perdia a fonte de verdade.
    const rel = 'governance/branch-protection.config.json';

    let ignorado = false;
    try {
      execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, stdio: 'ignore' });
      ignorado = true;
    } catch (_) {
      ignorado = false;
    }
    expect(ignorado).toBe(false);

    const rastreado = execFileSync('git', ['ls-files', '--error-unmatch', rel], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(rastreado).toBe(rel);
  });

  test('medir() sem resposta valida do gh => UNKNOWN (fail-closed, sem rede)', () => {
    const ghRunner = jest.fn(() => ({ ok: false, out: 'gh: command not found', status: 127 }));
    const m = gate.medir('owner/repo', 'main', ghRunner);
    expect(m.status).toBe(gate.STATUS.UNKNOWN);
    expect(gate.decidir({ medicao: m }).status).toBe(gate.STATUS.UNKNOWN);
  });
});
