'use strict';

/**
 * tests/helpers/suiteDatabase.js — provisionamento AUTOMÁTICO e seguro de um banco
 * descartável por suíte.
 *
 * POR QUE EXISTE (medido 2026-10-30)
 * ---------------------------------
 * Duas suítes de integração do Roteador falhavam no Postgres de DESENVOLVIMENTO
 * compartilhado e passavam no CI (banco efêmero) e num banco recém-criado:
 *
 *   engineeringBugLoopNaturalPathE2E   FAIL 65 s (banco compartilhado) · PASS 55 s (banco limpo)
 *   engineeringMissionDurableResume    flake 1/3 na base, 6/6 no CI sem servidor concorrente
 *
 * A causa não é o código de produto: é estado RESIDUAL de execuções anteriores
 * (missões/tasks/findings/leases) e o loop de recovery de um servidor vivo no
 * MESMO banco. `purgeTestFindings()` já limpava findings, mas não missões/tasks.
 *
 * O contrato desta porta: cada suíte que a usar roda contra um banco PRÓPRIO,
 * criado no início e DESTRUÍDO no fim — nunca tocando dados de outros testes,
 * de clientes ou de missões legítimas (é o oposto de "limpeza global").
 *
 * SEGURANÇA
 * ---------
 *  - nome derivado de um prefixo fixo + slug da suíte + 6 hex aleatórios;
 *  - `DROP DATABASE` só para o nome que ESTA chamada criou (guardado no handle);
 *  - recusa slug vazio/estranho;
 *  - nunca loga a connection string (apenas host/porta/banco).
 */

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const PREFIXO = 'rap_suite_';
const RAIZ = path.resolve(__dirname, '..', '..');

function baseUrl() {
  return process.env.DATABASE_URL || '';
}

/** Troca apenas o nome do banco na connection string. */
function comBanco(url, nome) {
  const parsed = new URL(url);
  parsed.pathname = `/${nome}`;
  return parsed.toString();
}

function nomeSeguro(slug) {
  const limpo = String(slug || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
  if (!limpo) throw new Error('slug da suíte é obrigatório para provisionar banco descartável');
  return `${PREFIXO}${limpo}_${crypto.randomBytes(3).toString('hex')}`;
}

function comCliente(url, fn) {
  const { Client } = require('pg');
  return (async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  })();
}

/**
 * Cria o banco descartável, aplica as migrations canônicas e aponta
 * `process.env.DATABASE_URL` para ele.
 *
 * @param {string} slug identificador curto da suíte (ex.: 'bugloop-natural')
 * @param {{migrate?:boolean, timeoutMs?:number}} [opcoes]
 * @returns {Promise<{nome:string, url:string, baseUrl:string, cleanup:Function}|null>}
 *          `null` quando não há banco base acessível (o chamador decide pular por infraGate).
 */
async function provisionSuiteDatabase(slug, { migrate = true, timeoutMs = 240000 } = {}) {
  const base = baseUrl();
  if (!base) return null;

  let nome;
  try {
    nome = nomeSeguro(slug);
    const adminUrl = comBanco(base, 'postgres');
    await comCliente(adminUrl, (client) => client.query(`CREATE DATABASE ${nome}`));
  } catch (_) {
    // Sem permissão/banco base: devolve null e a suíte segue pela porta de infraestrutura.
    return null;
  }

  const url = comBanco(base, nome);
  // Guardamos o valor ANTERIOR: em `--runInBand` o processo é o mesmo para todas as
  // suítes, então deixar `DATABASE_URL` apontando para um banco que já foi destruído
  // contaminaria a suíte seguinte (mesmo processo, mesma env).
  const urlAnterior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;

  if (migrate) {
    const resultado = spawnSync('npm', ['run', 'db:migrate'], {
      cwd: RAIZ,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env, DATABASE_URL: url },
    });
    if (resultado.status !== 0) {
      restaurarEnv(urlAnterior);
      await destroyDatabase(nome, base).catch(() => {});
      throw new Error(
        `migrations falharam no banco descartável ${nome} (exit=${resultado.status}): `
        + `${String(resultado.stdout || '').slice(-400)}${String(resultado.stderr || '').slice(-400)}`,
      );
    }
  }

  return {
    nome,
    url,
    baseUrl: base,
    cleanup: async () => {
      const destruido = await destroyDatabase(nome, base);
      restaurarEnv(urlAnterior);
      return destruido;
    },
  };
}

function restaurarEnv(valorAnterior) {
  if (valorAnterior === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = valorAnterior;
}

/**
 * Derruba o banco criado por `provisionSuiteDatabase`. Só aceita nomes com o
 * prefixo desta porta — nunca um banco arbitrário.
 */
async function destroyDatabase(nome, base = null) {
  const alvo = String(nome || '');
  if (!alvo.startsWith(PREFIXO)) {
    throw new Error(`recusado: ${alvo || '(vazio)'} não foi criado por suiteDatabase`);
  }
  const baseEfetiva = base || baseUrl();
  if (!baseEfetiva) return false;

  const adminUrl = comBanco(baseEfetiva, 'postgres');
  // Encerra conexões remanescentes do próprio banco descartável antes do DROP.
  await comCliente(adminUrl, async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [alvo],
    );
    await client.query(`DROP DATABASE IF EXISTS ${alvo}`);
  });
  return true;
}

module.exports = { provisionSuiteDatabase, destroyDatabase, PREFIXO };
