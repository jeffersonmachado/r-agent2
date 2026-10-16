'use strict';

/**
 * Regressão do defeito medido no selo V2 (2026-10-16):
 *   `[FAIL] FENCE_AVANCOU — antes=undefined depois=2` num passo OBRIGATÓRIO.
 *
 * O harness aceitava como handshake QUALQUER linha JSON com `state` string, e o
 * filho roda o caminho real do produto (que também loga JSON). Sob carga, um LOG
 * era adotado como handshake ⇒ `taskFence` ausente ⇒ comparação `2 > undefined`
 * (falsa) ⇒ reprovação com motivo enganoso. Passava isolado.
 */

const {
  HANDSHAKE_SENTINEL,
  formatHandshakeLine,
  parseHandshakeLine,
  fenceLegivel,
} = require('../../../scripts/governance/lib/task-lease-handshake');

const HANDSHAKE_REAL = {
  state: 'READY',
  pid: 1234,
  workerInstanceId: 'task-worker-A',
  taskLeaseToken: 'tok-1',
  taskFence: 1,
  missionId: 'm-1',
  materialPhase: 'CODING',
  routingDecisionPersisted: true,
};

describe('handshake do worker de lease — parsing inequívoco', () => {
  test('linha com marcador é aceita e o payload é íntegro', () => {
    const linha = formatHandshakeLine(HANDSHAKE_REAL).trim();
    expect(linha.startsWith(HANDSHAKE_SENTINEL)).toBe(true);
    const r = parseHandshakeLine(linha);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('sentinel');
    expect(r.payload.taskFence).toBe(1);
  });

  test('LOG do produto com `state` NÃO é mais confundido com handshake (defeito original)', () => {
    // linha exata do tipo que derrubava o passo
    const logDoProduto = '{"level":"info","state":"READY","msg":"worker pronto","tenant":"system"}';
    const r = parseHandshakeLine(logDoProduto);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('LOG_NAO_E_HANDSHAKE');
    expect(r.payload).toBeNull();
  });

  test('caminho legado só passa com campo exclusivo do handshake', () => {
    const legadoSemFence = '{"state":"READY","taskLeaseToken":"tok-9"}'; // tem campo exclusivo
    expect(parseHandshakeLine(legadoSemFence).ok).toBe(true);
    expect(parseHandshakeLine(legadoSemFence).via).toBe('legacy');

    const legadoComFenceNulo = '{"state":"READY","taskFence":null}'; // campo presente (nulo é valor)
    expect(parseHandshakeLine(legadoComFenceNulo).ok).toBe(true);
    expect(parseHandshakeLine(legadoComFenceNulo).payload.taskFence).toBeNull();
  });

  test('marcador sem state, JSON inválido e linha vazia são rejeitados com motivo', () => {
    expect(parseHandshakeLine(`${HANDSHAKE_SENTINEL}{"a":1}`).motivo).toBe('MARCADO_SEM_STATE');
    expect(parseHandshakeLine(`${HANDSHAKE_SENTINEL}{quebrado`).motivo).toBe('JSON_INVALIDO');
    expect(parseHandshakeLine('').motivo).toBe('LINHA_VAZIA');
    expect(parseHandshakeLine('texto solto').motivo).toBe('NAO_E_OBJETO_JSON');
  });

  test('fenceLegivel(): `undefined` nunca conta como fence (era a raiz do veredito errado)', () => {
    expect(fenceLegivel(1)).toBe(true);
    expect(fenceLegivel('2')).toBe(true);
    expect(fenceLegivel(0)).toBe(true);
    expect(fenceLegivel(undefined)).toBe(false);
    expect(fenceLegivel(null)).toBe(false);
    expect(fenceLegivel('abc')).toBe(false);
    expect(fenceLegivel(NaN)).toBe(false);
  });

  test('não-vacuidade: o handshake real, marcado, continua sendo aceito em qualquer ordem de linhas', () => {
    const linhas = [
      '{"level":"info","state":"EXECUTING","msg":"task iniciada"}',
      '{"level":"debug","state":"READY","msg":"lease ok"}',
      formatHandshakeLine(HANDSHAKE_REAL).trim(),
    ];
    const aceitos = linhas.map((l) => parseHandshakeLine(l)).filter((r) => r.ok);
    expect(aceitos).toHaveLength(1);
    expect(aceitos[0].via).toBe('sentinel');
    expect(aceitos[0].payload.taskFence).toBe(1);
  });
});
