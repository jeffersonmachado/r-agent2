'use strict';

/**
 * Hook de continuidade da missao (eventos SessionStart e Stop).
 *
 * Fonte de verdade: AI_MEMORY/hardening-queue.json (itens com status
 * `pending` / `in_progress`).
 *
 * Objetivo: o agente NAO pode encerrar o turno enquanto houver item aberto,
 * desde que esteja produzindo progresso. Sem progresso (HEAD/worktree/fila
 * inalterados desde o ultimo bloqueio) o hook LIBERA o encerramento para nao
 * entrar em laco infinito e nao consumir creditos a toa.
 *
 * Contrato (Local hooks reference):
 *  - Stop: {"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"..."}}
 *  - SessionStart: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
 *  - Sem bloqueio: {} (exit 0)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const QUEUE_PATH = 'AI_MEMORY/hardening-queue.json';
const STATE_PATH = '.github/hooks/.continue-state.json';
const OPEN_STATUSES = new Set(['pending', 'in_progress']);
const MAX_CONSECUTIVE_BLOCKS = Number(process.env.MISSION_MAX_CONTINUES || 50);

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseEvent(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readQueue() {
  try {
    const parsed = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function openItems(queue) {
  return queue.items.filter((item) => item && OPEN_STATUSES.has(String(item.status || '').toLowerCase()));
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// Progresso real = commit novo, worktree alterado ou status da fila mudou.
// O arquivo de estado do proprio hook e excluido para nao se auto-validar.
function progressSignature(queue) {
  const head = git(['rev-parse', 'HEAD']);
  const stateName = path.basename(STATE_PATH);
  const dirty = git(['status', '--porcelain'])
    .split('\n')
    .filter((line) => line.trim() && !line.includes(stateName))
    .sort()
    .join('\n');
  const queueDigest = queue.items.map((item) => [item.id, item.status]).map((pair) => pair.join(':')).join('|');
  return crypto.createHash('sha256').update([head, dirty, queueDigest].join('\n')).digest('hex').slice(0, 16);
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    if (state === null) {
      fs.rmSync(STATE_PATH, { force: true });
      return;
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    /* estado e auxiliar: falha aqui nunca deve quebrar o turno */
  }
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function describe(items) {
  return items.map((item) => `${item.id} — ${item.title} [${item.status}]`).join('; ');
}

function release(reason) {
  writeState(null);
  emit({ systemMessage: reason });
}

function main() {
  const event = parseEvent(readStdin());
  const eventName = event.hook_event_name;
  const queue = readQueue();
  if (!queue) {
    emit({});
    return;
  }

  const items = openItems(queue);

  if (eventName === 'SessionStart') {
    if (!items.length) {
      emit({});
      return;
    }
    emit({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          `Fila de hardening aberta em ${QUEUE_PATH} (${items.length} item(ns)): ${describe(items)}. ` +
          'Trabalhe item a item sem pausar para pedir confirmacao; a cada item concluido marque status "done", ' +
          'grave "commit" e "evidence" no JSON e commite antes de seguir para o proximo.',
      },
    });
    return;
  }

  if (eventName !== 'Stop') {
    emit({});
    return;
  }

  if (!items.length) {
    writeState(null);
    emit({});
    return;
  }

  const signature = progressSignature(queue);
  const state = readState();

  // Sem progresso desde o ultimo bloqueio: libera o encerramento (quebra de laco).
  if (state.signature === signature) {
    release(
      `Hook de continuidade: encerramento liberado por ausencia de progresso desde o ultimo bloqueio. ` +
        `Pendencias: ${describe(items)}`,
    );
    return;
  }

  const blocks = Number(state.blocks || 0) + 1;
  if (blocks > MAX_CONSECUTIVE_BLOCKS) {
    release(
      `Hook de continuidade: limite de ${MAX_CONSECUTIVE_BLOCKS} continuacoes consecutivas atingido. ` +
        `Pendencias: ${describe(items)}`,
    );
    return;
  }

  writeState({ signature, blocks });
  const next = items[0];
  emit({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: 'block',
      reason:
        `Fila de missao em aberto (${QUEUE_PATH}): ${describe(items)}. ` +
        `Continue AGORA com "${next.id} — ${next.title}" sem pedir confirmacao. ` +
        'Ao concluir: marque status "done", registre "commit" e "evidence" no JSON da fila e commite. ' +
        'Item que nao puder ser concluido deve virar "blocked" com "blocked_reason" escrito. ' +
        'Nao encerre o turno enquanto houver item "pending" ou "in_progress".',
    },
  });
}

main();
