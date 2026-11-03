'use strict';

/**
 * Validador da fila de hardening (MISSÃO B / B8).
 *
 * A fila é a única fonte de verdade sobre o que falta. Ela só é confiável se o
 * estado de cada item for **verificável**: um item `verified` sem evidência é uma
 * afirmação, não uma prova — e é exatamente assim que um falso verde entra na
 * fila e libera o encerramento do turno.
 *
 * Estados canônicos e o que cada um EXIGE:
 *   pending             — nada exigido (não iniciado)
 *   in_progress         — nada exigido (em andamento)
 *   failed              — failure_reason (por que falhou)
 *   fixed_unverified    — fix_note (o que foi corrigido) e NÃO pode ter evidence
 *                         (se tem evidência, o estado correto é verified)
 *   verified            — commit + evidence (verificação executada)
 *   prevention_active   — commit + evidence + prevention (a classe foi fechada)
 *   blocked             — blocked_reason
 *   blocked_external    — blocked_reason
 *   ready_for_approval  — commit + evidence (trabalho técnico concluído)
 *   done                — commit + evidence (legado; equivale a verified)
 *
 * Estado fora dessa lista é VIOLAÇÃO, nunca ignorado: um typo (`verifyed`)
 * silenciosamente viraria "fechado" e a fila mentiria.
 *
 * Uso: node scripts/governance/validate-hardening-queue.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
// `path.resolve` de propósito: leitura não pode ser registrada como alvo de
// ESCRITA no inventário de persistência (o scanner só reconhece leitura com
// `path.join` inline dentro de `fs.readFileSync`).
const FILA = path.resolve(RAIZ, 'AI_MEMORY', 'hardening-queue.json');
const RELATORIO = path.join(RAIZ, 'reports', 'hardening-queue-report.json');

const NAO_VAZIO = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * Requisitos por estado: campos obrigatórios e campos proibidos.
 * @type {Object<string, {requires: string[], forbids: string[]}>}
 */
const ESTADOS = Object.freeze({
  pending: { requires: [], forbids: [] },
  in_progress: { requires: [], forbids: [] },
  failed: { requires: ['failure_reason'], forbids: [] },
  fixed_unverified: { requires: ['fix_note'], forbids: ['evidence'] },
  verified: { requires: ['commit', 'evidence'], forbids: [] },
  prevention_active: { requires: ['commit', 'evidence', 'prevention'], forbids: [] },
  blocked: { requires: ['blocked_reason'], forbids: [] },
  blocked_external: { requires: ['blocked_reason'], forbids: [] },
  ready_for_approval: { requires: ['commit', 'evidence'], forbids: [] },
  done: { requires: ['commit', 'evidence'], forbids: [] },
});

/**
 * Estados que significam "fechado de verdade".
 *
 * DEFEITO MEDIDO (2026-10-17): `blocked` e `blocked_external` estavam nesta
 * lista. Com isso o relatório imprimia `abertos: (nenhum)` enquanto existiam 5
 * itens `blocked` (defeito conhecido, SEM correção) e 3 `blocked_external`
 * (impedimento externo, também sem correção) — a fila declarava zero pendências
 * com defeito conhecido aberto. "Bloqueado" é o oposto de fechado: é a
 * declaração de que a correção NÃO foi feita.
 */
const FECHADOS = new Set(['done', 'verified', 'prevention_active', 'ready_for_approval']);

/** Estados que representam impedimento (abertos, com causa declarada). */
const IMPEDIDOS = new Set(['blocked', 'blocked_external']);

/**
 * O commit citado como prova EXISTE no repositório?
 *
 * DEFEITO MEDIDO (2026-10-21): 3 itens `done` citavam `5f6d0c1c9`, um hash que não existe em
 * nenhum objeto do repositório (foi reescrito num rebase anterior). O validador só checava
 * "campo não vazio", então a fila exibia 3 provas que ninguém podia abrir — falso verde com
 * aparência de rigor. As correções eram reais; o PONTEIRO estava órfão.
 *
 * Guard: hash em formato inválido ou inexistente no git é violação (`COMMIT_INEXISTENTE`).
 * `git ok === false` desliga a checagem com falha explícita independente — nunca "passa por não
 * ter conseguido olhar".
 * @param {string} commit
 * @param {{ok:boolean}} gitEstado
 * @returns {boolean} true quando o commit existe
 */
function commitExiste(commit, gitEstado) {
  if (!gitEstado.ok) return true; // já existe violação própria (GIT_INDISPONIVEL)
  const valor = String(commit || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(valor)) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${valor}^{commit}`], {
      cwd: RAIZ, stdio: 'pipe', timeout: 5000,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** O repositório permite resolver objetos git? (sem git, a checagem é declarada, não ignorada) */
function gitDisponivel() {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: RAIZ, stdio: 'pipe', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Valida a fila.
 * @param {object} fila
 * @returns {{violations: object[], counts: object, open: string[]}}
 */
function validar(fila) {
  const violations = [];
  const counts = {};
  const open = [];

  const gitEstado = { ok: gitDisponivel() };
  if (!gitEstado.ok) {
    violations.push({
      code: 'GIT_INDISPONIVEL',
      detail: 'não foi possível resolver objetos git — a existência dos commits de prova NÃO foi verificada',
    });
  }

  const items = Array.isArray(fila && fila.items) ? fila.items : null;
  if (!items) {
    return {
      violations: [{ code: 'QUEUE_MALFORMED', detail: 'AI_MEMORY/hardening-queue.json sem array `items`' }],
      counts: {},
      open: [],
    };
  }

  const vistos = new Set();
  for (const item of items) {
    const id = String((item && item.id) || '');
    const status = String((item && item.status) || '').toLowerCase();

    if (!id) {
      violations.push({ code: 'ITEM_SEM_ID', detail: JSON.stringify(item).slice(0, 120) });
      continue;
    }
    if (vistos.has(id)) violations.push({ code: 'ITEM_DUPLICADO', item: id });
    vistos.add(id);

    const spec = ESTADOS[status];
    if (!spec) {
      violations.push({
        code: 'STATUS_DESCONHECIDO',
        item: id,
        detail: `"${item.status}" não é estado canônico — um estado desconhecido é tratado como ABERTO pelo hook`,
      });
      continue;
    }

    counts[status] = (counts[status] || 0) + 1;
    if (!FECHADOS.has(status)) open.push(`${id}(${status})`);

    for (const campo of spec.requires) {
      if (!NAO_VAZIO(item[campo])) {
        violations.push({
          code: 'CAMPO_OBRIGATORIO_AUSENTE',
          item: id,
          detail: `status "${status}" exige "${campo}" (afirmar sem prova é falso verde)`,
        });
      }
    }
    // Prova precisa ser ABRÍVEL: hash órfão (reescrito/typo) é falso verde com cara de rigor.
    if (NAO_VAZIO(item.commit) && !commitExiste(item.commit, gitEstado)) {
      violations.push({
        code: 'COMMIT_INEXISTENTE',
        item: id,
        detail: `commit "${item.commit}" não existe no repositório — a prova citada não pode ser aberta`,
      });
    }
    for (const campo of spec.forbids) {
      if (NAO_VAZIO(item[campo])) {
        violations.push({
          code: 'CAMPO_PROIBIDO_PRESENTE',
          item: id,
          detail: `status "${status}" não pode ter "${campo}" — com evidência o estado correto é "verified"`,
        });
      }
    }
    if (item.status !== status) {
      violations.push({
        code: 'STATUS_NAO_CANONICO_EM_CAIXA',
        item: id,
        detail: `"${item.status}" deveria ser minúsculo ("${status}")`,
      });
    }
  }

  return { violations, counts, open };
}

function main(argv = process.argv.slice(2)) {
  let fila;
  try {
    fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
  } catch (erro) {
    const rel = {
      schemaVersion: 1,
      kind: 'hardening-queue',
      generatedAt: new Date().toISOString(),
      status: 'FAIL',
      violations: [{ code: 'QUEUE_ILEGIVEL', detail: erro.message.slice(0, 160) }],
    };
    fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
    fs.writeFileSync(RELATORIO, JSON.stringify(rel, null, 1), 'utf8');
    process.stderr.write(`[hardening-queue] FAIL: fila ilegível (${erro.message.slice(0, 80)})\n`);
    return 1;
  }

  const { violations, counts, open } = validar(fila);
  const impedidos = open.filter((entrada) => IMPEDIDOS.has(String(entrada).replace(/^.*\(([^)]*)\)$/, '$1')));
  const relatorio = {
    schemaVersion: 1,
    kind: 'hardening-queue',
    generatedAt: new Date().toISOString(),
    total: (fila.items || []).length,
    counts,
    open,
    impedidos,
    violations,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 1), 'utf8');

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 1)}\n`);
  } else {
    const resumo = Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    process.stdout.write(`[hardening-queue] ${(fila.items || []).length} itens — ${resumo}\n`);
    process.stdout.write(`[hardening-queue] abertos: ${open.length ? open.join(', ') : '(nenhum)'}\n`);
    process.stdout.write(`[hardening-queue] impedidos (blocked/blocked_external — NÃO são fechados): ${impedidos.length}\n`);
    if (violations.length === 0) {
      process.stdout.write('[hardening-queue] PASS\n');
    } else {
      process.stdout.write(`[hardening-queue] FAIL: ${violations.length} violação(ões)\n`);
      violations.slice(0, 10).forEach((v) => process.stdout.write(`  ${v.code} ${v.item || ''} — ${v.detail || ''}\n`));
    }
  }
  return violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, validar, ESTADOS, FECHADOS };
