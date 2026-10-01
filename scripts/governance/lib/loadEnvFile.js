'use strict';

/**
 * loadEnvFile.js — fonte única da carga do `.env` do repositório nos coletores de
 * evidência de governança.
 *
 * POR QUE EXISTE (defeito real, medido duas vezes):
 * Coletores que rodam Jest via `execFileSync` resultavam em vereditos que dependiam
 * de QUEM invocava o processo, porque o ambiente do filho não carregava o `.env`:
 *
 *   1. `run-release-suites.js` (medido 2026-09-25): o RESULTADO das suítes mudava
 *      conforme a invocação e a classificação do requisito virava texto declarado
 *      em vez de medição.
 *   2. `collect-engineering-router-runtime-evidence.js` (medido 2026-10-01): o item
 *      `SAFE_ENVIRONMENT` reprovava com `exitCode: null` /
 *      "saída do Jest não pôde ser parseada como JSON". Causa: os testes exercitam
 *      o Engineering Runner REAL, cujo contrato exige que o cwd da execução esteja
 *      sob `ENGINEERING_ROUTER_WORKSPACE_ROOT` (o runner recusa o resto com
 *      `cwd_not_allowed`). Essa chave vive no `.env`; sem ela o teste cria o
 *      workspace no TMPDIR do host, o runner recusa, e o item é reprovado por
 *      CONFIGURAÇÃO — não por defeito do sandbox. Com a chave presente: 3/3 PASS.
 *
 * Contrato: o ambiente já presente VENCE (o operador pode sobrescrever sem editar
 * o arquivo), igual ao `--env-file-if-exists` usado no resto do projeto.
 */

const fs = require('fs');
const path = require('path');

/**
 * Carrega `<root>/.env` em `process.env` SEM sobrescrever chaves já definidas.
 *
 * @param {string} root raiz do repositório onde vive o `.env`
 * @returns {{loaded: boolean, keys: number, reason: string|null}}
 */
function loadEnvFile(root) {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return { loaded: false, keys: 0, reason: '.env ausente' };

  let keys = 0;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    // Ambiente explícito vence sempre: o operador pode sobrescrever sem editar o arquivo.
    if (process.env[key] !== undefined) continue;
    process.env[key] = match[2].trim().replace(/^["']|["']$/g, '');
    keys += 1;
  }
  return { loaded: true, keys, reason: null };
}

module.exports = { loadEnvFile };
