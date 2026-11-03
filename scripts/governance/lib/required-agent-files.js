'use strict';

/**
 * FONTE ÚNICA dos arquivos de governança de IA exigidos pelos validadores.
 *
 * DEFEITO MEDIDO (2026-10-21, clone limpo do commit `b7d8f1281`): `validate-ai-memory` e
 * `validate-agent-adherence` exigiam `.github/copilot-instructions.md`, mas o arquivo NÃO era
 * versionado (estava apenas em `.git/info/exclude` da máquina de desenvolvimento). Resultado em
 * qualquer checkout limpo:
 *
 *   [governance] validate-ai-memory: FAIL
 *    - required_file_missing: .github/copilot-instructions.md is required by AI governance.
 *   [governance] validate-agent-adherence: FAIL
 *    - agent_instruction_missing: .github/copilot-instructions.md is missing.
 *
 * Isto é, o requisito só era satisfazível com o estado prévio do computador do desenvolvedor —
 * exatamente o que a missão de CI definitivo proíbe. A correção é versionar o adaptador e, para
 * impedir a reincidência, a lista passa a viver aqui e `tests/unit/governance/aiGovernanceRequiredFilesTracked.test.js`
 * verifica que TODO arquivo desta lista está no índice do git (não apenas no disco).
 */

/** Documentos de memória operacional + adaptadores exigidos por `validate:ai-memory`. */
const REQUIRED_AI_GOVERNANCE_FILES = Object.freeze([
  'AI_MEMORY/architecture.md',
  'AI_MEMORY/platform-vision.md',
  'AI_MEMORY/qa-waves.md',
  'AI_MEMORY/replay-governance.md',
  'AI_MEMORY/release-process.md',
  'AI_MEMORY/operational-mesh.md',
  'AI_MEMORY/coding-standards.md',
  'AI_MEMORY/operational-rules.md',
  'AI_MEMORY/anti-patterns.md',
  'AI_MEMORY/validation-rules.md',
  'AI_MEMORY/smoke-rules.md',
  'AI_MEMORY/deployment-rules.md',
  'AI_MEMORY/workspace.md',
  'AI_MEMORY/omnichannel.md',
  'AI_MEMORY/pbx-ivr.md',
  'AI_MEMORY/rag-rules.md',
  'AI_MEMORY/replay-engine.md',
  'AI_MEMORY/self-proving.md',
  'AI_MEMORY/runtime-navigation.md',
  'AI_MEMORY/authentication.md',
  'AI_MEMORY/self-proving-rules.md',
  'AI_MEMORY/project-map.md',
  'AI_MEMORY/project-runtime-map.md',
  'AI_MEMORY/glossary.md',
  'AI_MEMORY/operational-checklists/release-checklist.md',
  'AI_MEMORY/operational-checklists/replay-checklist.md',
  'AI_MEMORY/operational-checklists/qa-checklist.md',
  'AI_MEMORY/operational-checklists/deployment-checklist.md',
  'AI_MEMORY/operational-checklists/governance-checklist.md',
  'AI_MEMORY/operational-checklists/browser-validation-checklist.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
]);

/** Adaptadores de instrução que `validate:agent-adherence` exige em TODA cópia do repositório. */
const AGENT_INSTRUCTION_FILES = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
]);

module.exports = { REQUIRED_AI_GOVERNANCE_FILES, AGENT_INSTRUCTION_FILES };
