const fsPort = require('../../shared/fileSystem');
const path = require('path');

function defaultLogger() {
  return console;
}

function loadPromptFile(absPath, { logger } = {}) {
  const log = logger || defaultLogger();
  try {
    return fsPort.readFileSync(absPath, 'utf8');
  } catch (err) {
    log.error?.('[flowGenerator] Falha ao carregar prompt', { path: absPath, error: err.message });
    throw new Error(`Falha ao carregar prompt: ${path.basename(absPath)}`);
  }
}

function stripMarkdownCodeFences(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  return s.trim();
}

function extractFirstJsonObject(text) {
  const s = stripMarkdownCodeFences(text);
  const match = s.match(/\{[\s\S]*\}/);
  return match ? match[0] : s;
}

function safeJsonParse(text) {
  const raw = extractFirstJsonObject(text);
  return JSON.parse(raw);
}

function toValidationWarnings(validation) {
  const valid = validation?.valid === true;
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  return {
    valid,
    errors: valid ? [] : errors,
    codes: valid ? [] : errors.map((e) => e && (e.code || e.type)).filter(Boolean),
  };
}

module.exports = {
  defaultLogger,
  loadPromptFile,
  safeJsonParse,
  toValidationWarnings,
};

