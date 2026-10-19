'use strict';

/**
 * Regressão de HARDENING-ENG-GOV-RELEASE-P0-7 — o `--apply` da proteção de branch.
 *
 * DEFEITO MEDIDO (2026-10-17): `aplicar()` pulava os campos `null` e montava o PUT com `-F`.
 * A API do GitHub EXIGE `required_status_checks`, `required_pull_request_reviews` e
 * `restrictions` presentes no corpo (mesmo que `null`); sem elas responde HTTP 422
 * "...weren't supplied". Resultado: o comando que deveria proteger a branch NUNCA protegia, e o
 * relatório só dizia `applied.ok=false` — a proteção ficou ausente enquanto o item era tratado
 * como "bloqueio de plano".
 *
 * Aqui o corpo enviado é capturado com um `ghRunner` dublê: os três campos precisam existir
 * com `null` EXPLÍCITO, e as flags booleanas precisam refletir a configuração.
 */

const { aplicar } = require('../../../scripts/governance/verify-branch-protection');

function runnerEspiao(resposta = { ok: true, status: 0, out: '{}' }) {
  const chamadas = [];
  const runner = (args, opcoes) => {
    chamadas.push({ args, opcoes });
    return resposta;
  };
  return { runner, chamadas };
}

const DESEJADO = Object.freeze({
  enforce_admins: false,
  required_status_checks: null,
  required_pull_request_reviews: null,
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: false,
  lock_branch: false,
});

describe('aplicar() — corpo do PUT de proteção de branch', () => {
  test('envia os TRÊS campos obrigatórios com null explícito (causa do 422)', () => {
    const { runner, chamadas } = runnerEspiao();
    const r = aplicar('owner/repo', 'main', DESEJADO, runner);
    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);

    const corpo = JSON.parse(chamadas[0].opcoes.input);
    expect(Object.prototype.hasOwnProperty.call(corpo, 'required_status_checks')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(corpo, 'required_pull_request_reviews')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(corpo, 'restrictions')).toBe(true);
    expect(corpo.required_status_checks).toBeNull();
    expect(corpo.required_pull_request_reviews).toBeNull();
    expect(corpo.restrictions).toBeNull();
  });

  test('allow_force_pushes / allow_deletions refletem a configuração (nunca por omissão)', () => {
    const { runner, chamadas } = runnerEspiao();
    aplicar('owner/repo', 'main', DESEJADO, runner);
    const corpo = JSON.parse(chamadas[0].opcoes.input);
    expect(corpo.allow_force_pushes).toBe(false);
    expect(corpo.allow_deletions).toBe(false);
    expect(corpo.enforce_admins).toBe(false);
  });

  test('usa o endpoint de proteção da branch e envia o corpo por stdin (nunca -F)', () => {
    const { runner, chamadas } = runnerEspiao();
    aplicar('owner/repo', 'main', DESEJADO, runner);
    const { args } = chamadas[0];
    expect(args).toContain('PUT');
    expect(args).toContain('repos/owner/repo/branches/main/protection');
    expect(args).toContain('--input');
    expect(args).not.toContain('-F');
  });

  test('falha da API é propagada como ok=false (nunca sucesso silencioso)', () => {
    const { runner } = runnerEspiao({ ok: false, status: 422, out: '{"message":"Unprocessable"}' });
    const r = aplicar('owner/repo', 'main', DESEJADO, runner);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
  });
});
