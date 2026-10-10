'use strict';

/**
 * api/services/engineeringRouter/safeEngineeringEnvironment.js
 *
 * ERV1-CLOSE-002: o Test Runner passava `env: { ...process.env }` para todo subprocess de
 * teste — qualquer patch aplicado (gerado por um LLM, portanto não confiável) podia rodar um
 * teste que imprime `process.env` inteiro, vazando `OPENAI_API_KEY`, `DATABASE_PASSWORD`,
 * `JWT_SECRET` e qualquer outro segredo real do processo pai para stdout/stderr — que depois
 * vira evidência persistida, contexto do reviewer, e pode voltar como prompt para o próximo
 * CODER.
 *
 * Política: DEFAULT É NEGAR. Só passa o mínimo necessário para `npm`/`npx`/`node`/`git`
 * funcionarem (ver `commandPolicy.js` — são os únicos executáveis aceitos). `HOME` aponta para
 * o próprio workspace isolado, não o HOME real do processo, para os comandos não lerem
 * `~/.npmrc`/`~/.gitconfig`/config de credencial real do host.
 *
 * V1 não implementa injeção explícita de secret via `credentialRef` para testes — nenhum
 * Task Contract real precisa disso (testCommands são sempre `npm test`/`jest`/`git status`
 * /`git diff`), e negar tudo por padrão é mais seguro que construir esse mecanismo sem um caso
 * de uso real. Registrado como possibilidade em POST_RELEASE_MODEL_ROUTER_BACKLOG.md.
 */

// Variáveis do processo pai que podem passar para o subprocess de teste — nenhuma delas é um
// segredo, todas são necessárias para `npm`/`npx`/`node`/`git`/`jest` funcionarem normalmente.
//
// FORA DA LISTA DE PROPÓSITO: `TMPDIR`/`TEMP`/`TMP` (defeito REAL medido em 2026-09-30). O
// container do sandbox tem o PRÓPRIO scratch space (`TMPDIR=/sandbox-tmp`, definido em
// `executionSandbox.js`); repassar o TMPDIR do HOST faz o `npx jest` aninhado tentar criar o
// diretório de temporada em um caminho do host que NÃO existe dentro do container e morrer com
// `ENOENT: mkdir '/.../jest_XXXX'` ANTES de rodar qualquer teste — transformando toda correção em
// RED->FIX perpétuo (medido: a task do ciclo de bug nunca chegava a GREEN, 3 tentativas, mesmo
// com o patch correto aplicado). Scratch space é do CONTAINER, nunca do host.
const SAFE_ENV_PASSTHROUGH_KEYS = Object.freeze([
  'PATH',
  'NODE_ENV',
  'CI',
  'LANG',
  'LC_ALL',
  // Necessário no Windows para localizar node/npm; inofensivo em outros SOs (undefined).
  'SystemRoot',
  'APPDATA',
  // Cache do npm FORA da árvore do workspace. Com `HOME` = workspace (garantia de isolamento),
  // o npm gravava `$HOME/.npm` DENTRO do workspace e contaminava a Exact Promotion — medido
  // 2026-10-09: `PROMOTION_TREE_CONTAMINATED`, `contaminatingFiles: "A\t.npm/_update-notifier-last-checked"`,
  // que reprovava o candidato e deixava TODA task em READY_FOR_PROMOTION em vez de GREEN.
  // Apontar para o tmpfs dedicado do sandbox (`/sandbox-tmp`: gravável, efêmero, montado por
  // `--tmpfs` em TODA execução e fora do bind do workspace) mantém o HOME isolado E a árvore
  // limpa. Nenhuma destas chaves é um segredo.
  'npm_config_cache',
  'npm_config_update_notifier',
  'XDG_CACHE_HOME',
]);

/**
 * Constrói o `env` seguro para um subprocess de teste do Engineering Router.
 *
 * @param {{cwd?: string}} [options] - `cwd` vira `HOME`/`npm_config_userconfig`-safe: os
 *   comandos rodam com HOME dentro do workspace isolado, nunca o HOME real do host.
 * @returns {Object<string,string>}
 */
function buildSafeTestEnv({ cwd } = {}) {
  const env = {};
  for (const key of SAFE_ENV_PASSTHROUGH_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // HOME sandboxed: evita que os comandos leiam config/credenciais reais do usuário do host
  // (~/.npmrc, ~/.gitconfig, ~/.ssh/config). Workspace isolado é sempre um diretório efêmero
  // criado só para esta tentativa (patchApplyService.createWorkspace).
  if (cwd) env.HOME = cwd;

  // Cache/estado do npm DENTRO do tmpfs do sandbox, nunca na árvore do workspace.
  // Sem isto o `npx jest` (allowlist do commandPolicy) cria `<workspace>/.npm/_logs/…` e
  // `<workspace>/.npm/_update-notifier-last-checked`, e a Exact Promotion reprova o candidato
  // por hash de árvore divergente (`PROMOTION_TREE_CONTAMINATED`) — a task nunca sai de
  // READY_FOR_PROMOTION. O tmpfs existe em toda execução sandboxed (ver `buildDockerArgs`),
  // é gravável pelo UID fixo e desaparece no fim do container: nada volta para o host.
  env.npm_config_cache = '/sandbox-tmp/.npm-cache';
  env.npm_config_update_notifier = 'false';
  env.XDG_CACHE_HOME = '/sandbox-tmp/.cache';
  return env;
}

module.exports = {
  SAFE_ENV_PASSTHROUGH_KEYS,
  buildSafeTestEnv,
};
