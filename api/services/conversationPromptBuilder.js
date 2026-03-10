'use strict';

function buildPromptWithReconstructedContext(basePrompt, reconstructedPrefix) {
  const base = String(basePrompt || '').trim();
  const prefix = String(reconstructedPrefix || '').trim();
  if (!prefix) return base;
  if (!base) return prefix;
  return `${prefix}\n\n## Solicitação Atual\n${base}`;
}

module.exports = {
  buildPromptWithReconstructedContext,
};
