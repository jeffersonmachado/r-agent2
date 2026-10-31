'use strict';

/**
 * Política de autorização humana por CANAL (decisão do dono, 2026-10-31):
 *
 *   - `UI`: aprovação interativa no produto é obrigatória para fluxo originado na UI;
 *   - `VSCODE_AGENT`: quando o humano autoriza EXPLICITAMENTE na sessão do VS Code, o agente
 *     registra a autorização em nome dele (com proveniência: quem autorizou, quando, referência e
 *     a sessão), e o gate a considera adequada;
 *   - sem canal declarado: tratado como `UI` (retrocompatível com provas já existentes).
 *
 * Em TODOS os canais a autorização precisa identificar o humano, o instante e a referência da
 * evidência — o canal muda a PROVENIÊNCIA, não a exigência de autoria. Canal desconhecido e
 * autorização de agente sem humano identificado continuam recusados.
 */

const { validarAutorizacaoHumana } = require('../../../governance/bug-closure/closure-proof');

const base = () => ({
  by: 'platform-owner:jeffersonmachado',
  at: '2026-10-31T14:30:00.000Z',
  ref: 'session:e92510ac-0f54-41c6-bb85-90f42042999c',
});

describe('autorização humana: canal e proveniência', () => {
  test('UI exige humano, instante e referência (comportamento anterior preservado)', () => {
    expect(validarAutorizacaoHumana({ channel: 'UI', ...base() })).toEqual({ ok: true, reason: null });
    expect(validarAutorizacaoHumana({ channel: 'UI', by: base().by, at: base().at }).ok).toBe(false);
  });

  test('sem canal declarado é tratado como UI (retrocompatível)', () => {
    expect(validarAutorizacaoHumana({ ...base() }).ok).toBe(true);
  });

  test('VSCODE_AGENT é aceito quando o humano autoriza explicitamente na sessão', () => {
    const r = validarAutorizacaoHumana({
      channel: 'VSCODE_AGENT',
      ...base(),
      agentSession: 'e92510ac-0f54-41c6-bb85-90f42042999c',
    });
    expect(r).toEqual({ ok: true, reason: null });
  });

  test('VSCODE_AGENT sem sessão identificada é recusado (proveniência obrigatória)', () => {
    const r = validarAutorizacaoHumana({ channel: 'VSCODE_AGENT', ...base() });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('SESSAO_DO_AGENTE_AUSENTE');
  });

  test('autorização de agente SEM humano identificado é recusada em qualquer canal', () => {
    for (const channel of ['UI', 'VSCODE_AGENT']) {
      const r = validarAutorizacaoHumana({ channel, at: base().at, ref: base().ref, agentSession: 'x' });
      expect(r.ok).toBe(false);
    }
  });

  test('canal desconhecido é recusado (não existe canal "livre")', () => {
    const r = validarAutorizacaoHumana({ channel: 'AGENTE_SOZINHO', ...base(), agentSession: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('CANAL_DESCONHECIDO');
  });

  test('autorização ausente continua recusada', () => {
    expect(validarAutorizacaoHumana(null).ok).toBe(false);
    expect(validarAutorizacaoHumana(undefined).ok).toBe(false);
  });
});
