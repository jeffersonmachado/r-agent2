'use strict';

/**
 * Regressão da porta `tests/helpers/suiteDatabase.js`.
 *
 * O que este teste protege (e por quê):
 *  1. `provisionSuiteDatabase` aponta `DATABASE_URL` para o banco criado — é o efeito desejado.
 *  2. `cleanup()` DESTRÓI o banco criado e RESTAURA o `DATABASE_URL` anterior. Sem a restauração,
 *     em `--runInBand` (mesmo processo para todas as suítes) a suíte seguinte herdaria uma URL
 *     apontando para um banco que já não existe — vazamento entre suítes.
 *  3. `destroyDatabase` recusa nome sem o prefixo `rap_suite_` (nunca derruba banco alheio).
 */

const { provisionSuiteDatabase, destroyDatabase, PREFIXO } = require('../helpers/suiteDatabase');

describe('suiteDatabase — isolamento por banco descartável', () => {
  const urlOriginal = process.env.DATABASE_URL;
  let disponivel = Boolean(urlOriginal);
  let motivo = disponivel ? null : 'DATABASE_URL ausente no ambiente';
  let handle = null;

  beforeAll(async () => {
    if (!disponivel) return;
    try {
      handle = await provisionSuiteDatabase('selfcheck', { migrate: false });
      if (!handle) {
        disponivel = false;
        motivo = 'provisionamento indisponível (sem banco base acessível)';
      }
    } catch (error) {
      disponivel = false;
      motivo = error.message;
    }
  }, 60000);

  afterAll(async () => {
    if (handle) await handle.cleanup().catch(() => {});
  });

  function skipIfUnavailable() {
    if (disponivel) return false;
    return require('../helpers/infraGate').skipOrFail({
      suite: 'suite-database-isolation',
      available: false,
      reason: motivo,
      requirement: 'postgres',
    });
  }

  test('cleanup() restaura DATABASE_URL e derruba apenas o banco criado', async () => {
    if (skipIfUnavailable()) return;
    const { Client } = require('pg');

    const nomeCriado = handle.nome;
    expect(nomeCriado.startsWith(PREFIXO)).toBe(true);
    expect(nomeCriado).not.toBe(new URL(urlOriginal).pathname.replace(/^\//, ''));
    // A env já aponta para o banco da suíte neste ponto (efeito desejado do provisionamento).
    expect(new URL(process.env.DATABASE_URL).pathname).toBe(`/${nomeCriado}`);

    await handle.cleanup();
    handle = null;

    // 1) env restaurada exatamente ao valor anterior (é este ponto que pega o vazamento em --runInBand)
    expect(process.env.DATABASE_URL).toBe(urlOriginal);

    // 2) o banco criado não existe mais — medido no servidor, não inferido
    const admin = new Client({ connectionString: substituirBanco(urlOriginal, 'postgres') });
    await admin.connect();
    try {
      const { rows } = await admin.query('select 1 from pg_database where datname = $1', [nomeCriado]);
      expect(rows).toHaveLength(0);
    } finally {
      await admin.end().catch(() => {});
    }
  }, 60000);

  test('destroyDatabase recusa nome sem o prefixo da porta', async () => {
    await expect(destroyDatabase('postgres')).rejects.toThrow(/não foi criado por suiteDatabase/);
    await expect(destroyDatabase('')).rejects.toThrow(/não foi criado por suiteDatabase/);
  }, 10000);
});

function substituirBanco(url, nome) {
  const parsed = new URL(url);
  parsed.pathname = `/${nome}`;
  return parsed.toString();
}
