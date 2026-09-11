'use strict';

/**
 * Política canônica de build local (AI_MEMORY/deployment-rules.md):
 *
 *   Imagens Docker são SEMPRE construídas na máquina local (workstation/CI) e
 *   transferidas ao servidor via `docker save | ssh 'docker load'`. O host de
 *   produção NUNCA constrói: ele apenas carrega imagens prontas e sobe o stack
 *   com `--no-build` (fail-closed).
 *
 * Este módulo concentra as regras puras usadas por
 * `scripts/governance/validate-local-build-policy.js` para transformar a
 * política em enforcement executável (a doc sozinha não é suficiente).
 */

// Token de comando de build. Case-sensitive de propósito: identificadores como
// BUILD_SERVICES/DEV_BUILD_CMD não são comandos de build.
const BUILD_COMMAND_PATTERNS = [
  /\bdocker\s+build\b/,
  /\bdocker\s+buildx\s+build\b/,
  /\bdocker\s+compose\b[^\n]*\bbuild\b/,
  /\bdocker-compose\b[^\n]*\bbuild\b/,
  /\$\{?DOCKER_COMPOSE\}?[^\n]*\bbuild\b/,
  /\$\{?COMPOSE_CMD\}?[^\n]*\bbuild\b/,
];

function stripCommentLines(content) {
  return String(content || '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line));
}

function hasBuildCommand(line) {
  return BUILD_COMMAND_PATTERNS.some((pattern) => pattern.test(line));
}

function hasSshCommand(line) {
  // `ssh` costuma aparecer dentro de strings entre aspas (ex.: run('ssh host "…"')).
  return /(^|[\s;&|('"`])ssh\b/.test(line);
}

/**
 * @param {string} content conteúdo de scripts/docker-deploy.sh
 * @returns {Array<{code: string, detail: string}>}
 */
function analyzeDeployScript(content) {
  const reasons = [];
  const raw = String(content || '');
  const codeLines = stripCommentLines(raw);

  const invariantPresent = raw
    .split('\n')
    .some((line) => /NUNCA executar/i.test(line) && /servidor remoto/i.test(line) && /build/i.test(line));

  if (!invariantPresent) {
    reasons.push({
      code: 'deploy_script_invariant_missing',
      detail: 'scripts/docker-deploy.sh deve declarar o invariante "NUNCA executar docker build/docker compose build no servidor remoto".',
    });
  }

  codeLines.forEach((line, index) => {
    if (/\bup\s+(-d|--detach)\b/.test(line) && !/--no-build/.test(line)) {
      reasons.push({
        code: 'remote_up_without_no_build',
        detail: `subida de stack sem --no-build (linha ${index + 1} do script sem comentários): ${line.trim().slice(0, 120)}`,
      });
    }

    if (hasSshCommand(line) && hasBuildCommand(line)) {
      reasons.push({
        code: 'remote_build_via_ssh',
        detail: `build executado via ssh (build remoto proibido): ${line.trim().slice(0, 120)}`,
      });
    }
  });

  return reasons;
}

/**
 * @param {Record<string, string>} scripts conteúdo de package.json#scripts
 * @returns {Array<{code: string, detail: string}>}
 */
function analyzePackageScripts(scripts = {}) {
  const reasons = [];

  const deployUp = scripts['deploy:up'];
  if (typeof deployUp !== 'string' || !/--no-build/.test(deployUp)) {
    reasons.push({
      code: 'deploy_up_without_no_build',
      detail: `script "deploy:up" deve usar --no-build (fail-closed): ${deployUp || '<ausente>'}`,
    });
  }

  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    if (hasSshCommand(command) && hasBuildCommand(command)) {
      reasons.push({
        code: 'remote_build_via_ssh',
        detail: `script "${name}" executa build via ssh: ${command.slice(0, 120)}`,
      });
    }
  }

  return reasons;
}

/**
 * @param {string} content conteúdo de tools/system/deploy.js
 * @returns {Array<{code: string, detail: string}>}
 */
function analyzeDeployJs(content) {
  const reasons = [];

  stripCommentLines(content).forEach((line, index) => {
    if (hasSshCommand(line) && hasBuildCommand(line)) {
      reasons.push({
        code: 'remote_build_via_ssh',
        detail: `tools/system/deploy.js executa build via ssh (linha ${index + 1}): ${line.trim().slice(0, 120)}`,
      });
    }
  });

  return reasons;
}

/**
 * @param {string} content conteúdo de docs/deployment/local-build-policy.md
 * @returns {Array<{code: string, detail: string}>}
 */
function analyzePolicyDoc(content) {
  const reasons = [];
  const raw = String(content || '');

  if (!/AI_MEMORY\/deployment-rules\.md/.test(raw)) {
    reasons.push({
      code: 'policy_doc_canonical_source_missing',
      detail: 'a doc da política deve referenciar a fonte canônica AI_MEMORY/deployment-rules.md.',
    });
  }

  if (!/docker save/.test(raw) || !/docker load/.test(raw)) {
    reasons.push({
      code: 'policy_doc_transfer_mechanism_missing',
      detail: 'a doc deve descrever o mecanismo de transferência de imagens (docker save | ssh \'docker load\').',
    });
  }

  return reasons;
}

/**
 * @param {string} content conteúdo de DEPLOYMENT_CHECKLIST.md
 * @returns {Array<{code: string, detail: string}>}
 */
function analyzeChecklist(content) {
  const reasons = [];
  const raw = String(content || '');

  const referencesPolicy =
    /local-build-policy\.md/.test(raw) || /AI_MEMORY\/deployment-rules\.md/.test(raw);
  const statesProhibition = /NUNCA[\s\S]{0,200}?build/i.test(raw) || /build[\s\S]{0,80}?(local|workstation)/i.test(raw);

  if (!referencesPolicy || !statesProhibition) {
    reasons.push({
      code: 'checklist_local_build_policy_missing',
      detail: 'DEPLOYMENT_CHECKLIST.md deve referenciar a política de build local e declarar que o servidor não constrói.',
    });
  }

  return reasons;
}

/**
 * @param {string} content conteúdo de AI_MEMORY/deployment-rules.md
 * @returns {Array<{code: string, detail: string}>}
 */
function analyzeCanonicalMemory(content) {
  const raw = String(content || '');
  const hasAnchor =
    /build é SEMPRE local/i.test(raw) ||
    /build\s+é\s+sempre\s+local/i.test(raw) ||
    /Docker image build policy/i.test(raw);

  if (!hasAnchor) {
    return [
      {
        code: 'canonical_memory_policy_missing',
        detail: 'AI_MEMORY/deployment-rules.md deve manter a política "build SEMPRE local (workstation/CI)".',
      },
    ];
  }

  return [];
}

module.exports = {
  BUILD_COMMAND_PATTERNS,
  analyzeDeployScript,
  analyzePackageScripts,
  analyzeDeployJs,
  analyzePolicyDoc,
  analyzeChecklist,
  analyzeCanonicalMemory,
};
