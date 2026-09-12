'use strict';

/**
 * state-sync-rule.js — REGRA ÚNICA de `setInterval` no frontend.
 *
 * Fonte da verdade compartilhada entre:
 *   - `validate-layer-conventions.js` (linter amplo, advisory em outras regras)
 *   - `validate-state-sync.js` (gate BLOQUEANTE, focado nesta regra)
 *
 * POR QUE UM MÓDULO SEPARADO
 * A regra existe em AGENTS.md/CLAUDE.md como PROIBIÇÃO ("estado realtime via
 * WebSocket; PROIBIDO setInterval para sincronizar estado"), mas o linter que a
 * verificava era estruturalmente incapaz de falhar (`errors > 0` mapeava para
 * WARN) e não estava no gate agregado: 45 ocorrências conviviam com
 * `overallGovernance = 100`. Ligar o linter INTEIRO ao gate agregado faria o
 * gate falhar por 123 erros alheios (pureza de `engine/`, console.log em `api/`,
 * ESM no backend) — dívida real, mas de outra natureza e outro dono. Esta regra
 * ganha gate próprio; o linter amplo segue como está.
 *
 * ESCOPO
 * A proibição é de FRONTEND. Um worker/scheduler em timer do backend (sweep de
 * sessão, tick de fila, retenção) é o padrão CORRETO ali — 19 dos 45 apontamentos
 * originais eram falso positivo de escopo.
 *
 * ISENÇÕES
 * Cada ocorrência em `frontend/src` precisa estar coberta por
 * `config/state-sync-exemptions.json` com classificação e motivo. A isenção
 * declara `allowedIntervals` (contagem por arquivo, não por linha, para não
 * apodrecer quando o código se move); o excedente é violação. Isenção que aponta
 * arquivo sem `setInterval` é reportada como obsoleta.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = 'frontend/src';
const EXEMPTIONS_PATH = 'config/state-sync-exemptions.json';
const SCAN_EXTS = ['js', 'jsx'];

function listFiles(root, dir, out = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      listFiles(root, rel, out);
    } else if (SCAN_EXTS.some((ext) => entry.name.endsWith(`.${ext}`))) {
      out.push(rel);
    }
  }
  return out;
}

/** Lê as isenções. Fail-closed: ausente/ilegível/vazio → erro fatal. */
function loadExemptions(root = process.cwd()) {
  const full = path.join(root, EXEMPTIONS_PATH);
  if (!fs.existsSync(full)) {
    return { ok: false, entries: [], error: `${EXEMPTIONS_PATH} ausente` };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    if (entries.length === 0) {
      return { ok: false, entries: [], error: `${EXEMPTIONS_PATH} sem entradas` };
    }
    return { ok: true, entries, error: null };
  } catch (error) {
    return { ok: false, entries: [], error: `${EXEMPTIONS_PATH} ilegível: ${error.message}` };
  }
}

/**
 * Avalia a regra.
 * @returns {{ok: boolean, violations: Array, stale: Array, counts: Object, exemptions: Object}}
 */
function evaluateStateSyncRule(root = process.cwd()) {
  const exemptions = loadExemptions(root);

  if (!exemptions.ok) {
    return {
      ok: false,
      violations: [{
        severity: 'critical',
        file: EXEMPTIONS_PATH,
        line: 0,
        message: `isenções inutilizáveis: ${exemptions.error}`,
        suggestion: 'Sem o arquivo toda ocorrência de setInterval no frontend é falha. Restaurar config/state-sync-exemptions.json.',
      }],
      stale: [],
      counts: {},
      exemptions,
    };
  }

  const byFile = new Map(exemptions.entries.map((entry) => [entry.file, entry]));
  const counts = {};
  const violations = [];

  for (const file of listFiles(root, FRONTEND_DIR).sort()) {
    // Testes não fazem parte da superfície de runtime.
    if (file.includes('__tests__') || file.includes('.test.')) continue;

    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (!/\bsetInterval\s*\(/.test(trimmed)) continue;

      counts[file] = (counts[file] || 0) + 1;

      const exemption = byFile.get(file);
      const allowed = exemption ? Number(exemption.allowedIntervals) || 0 : 0;
      if (counts[file] <= allowed) continue;

      violations.push({
        severity: 'error',
        file,
        line: index + 1,
        message: `setInterval não declarado: "${trimmed.substring(0, 80)}"`,
        suggestion: exemption
          ? `Isento até ${allowed} ocorrência(s); esta é a #${counts[file]}. Declare em ${EXEMPTIONS_PATH} com motivo, ou use o push do WebSocket.`
          : `Sem isenção em ${EXEMPTIONS_PATH}. Use WebSocket para sincronização de estado.`,
      });
    }
  }

  // Anti-rot: isenção obsoleta ou superdimensionada.
  const stale = [];
  for (const entry of exemptions.entries) {
    const found = counts[entry.file] || 0;
    const allowed = Number(entry.allowedIntervals) || 0;
    if (found === 0) {
      stale.push({
        severity: 'warning',
        file: entry.file,
        line: 0,
        message: 'isenção obsoleta: nenhum setInterval encontrado no arquivo',
        suggestion: `Remover a entrada de ${EXEMPTIONS_PATH}.`,
      });
    } else if (found < allowed) {
      stale.push({
        severity: 'warning',
        file: entry.file,
        line: 0,
        message: `isenção superdimensionada: declara ${allowed}, encontrou ${found}`,
        suggestion: `Ajustar allowedIntervals para ${found}.`,
      });
    }
  }

  return { ok: violations.length === 0, violations, stale, counts, exemptions };
}

module.exports = {
  FRONTEND_DIR,
  EXEMPTIONS_PATH,
  evaluateStateSyncRule,
  loadExemptions,
};
