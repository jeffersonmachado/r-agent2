'use strict';

/**
 * Hook de continuidade da missao (eventos SessionStart e Stop).
 *
 * Fonte de verdade: AI_MEMORY/hardening-queue.json.
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
const { evaluateWorktree } = require('../../governance/worktree-integrity');

const ROOT = path.resolve(__dirname, '..', '..');
const QUEUE_PATH = 'AI_MEMORY/hardening-queue.json';
const STATE_PATH = '.github/hooks/.continue-state.json';
const OWNER_PATH = '.github/hooks/.worktree-owner.json';

/**
 * Estados canonicos da fila (MISSAO B / B8).
 *
 * CLOSED = o item nao exige mais acao do agente. Tudo o que NAO esta aqui conta
 * como ABERTO — inclusive estado escrito errado ou estado novo ainda nao
 * tratado. Fail-closed: um typo (`verifyed`) ou `fixed_unverified` NAO pode
 * liberar o encerramento em silencio.
 *
 * DEFEITO CORRIGIDO (2026-10-14): a logica anterior era o INVERSO —
 * `OPEN_STATUSES = {pending, in_progress}` — entao qualquer outro valor caia no
 * ramo "fechado". Um item marcado `failed` ou `fixed_unverified` (corrigido mas
 * NAO verificado) encerrava o loop como se estivesse concluido, que e
 * exatamente o falso verde que a fila existe para impedir.
 */
const CLOSED_STATUSES = new Set([
  'done', // legado: concluido e verificado, com commit + evidence no item
  'verified', // corrigido E verificado por execucao (exige evidence)
  'prevention_active', // verificado E com prevencao executavel ativa (exige evidence)
  'ready_for_approval', // trabalho tecnico concluido; aguarda aprovacao humana
  'blocked', // legado: impossivel, com blocked_reason escrito
  'blocked_external', // bloqueio externo, com blocked_reason escrito
]);

/** Estados que o modelo B8 nomeia explicitamente e que continuam ABERTOS. */
const KNOWN_OPEN_STATUSES = new Set([
  'pending',
  'in_progress',
  'failed',
  'fixed_unverified',
]);

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

/**
 * Itens que ainda exigem acao. Fail-closed: so considerado fechado o status
 * explicitamente reconhecido em CLOSED_STATUSES.
 * @param {object} queue
 * @returns {object[]}
 */
function openItems(queue) {
  return queue.items.filter((item) => {
    const status = String((item && item.status) || '').toLowerCase();
    return !CLOSED_STATUSES.has(status);
  });
}

/**
 * Rotulo legivel do motivo de o item estar aberto (para a mensagem do hook).
 * @param {string} status
 * @returns {string}
 */
function openReason(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'fixed_unverified') return 'corrigido mas NAO verificado';
  if (s === 'failed') return 'falhou';
  if (s === 'pending') return 'nao iniciado';
  if (s === 'in_progress') return 'em andamento';
  if (KNOWN_OPEN_STATUSES.has(s)) return s;
  return `status nao reconhecido ("${status}") tratado como ABERTO`;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/**
 * INTEGRIDADE DO WORKTREE (2026-10-20).
 *
 * Terceira rodada de mutilação medida no mesmo repositório: dezenas de arquivos
 * com guardas apagadas e testes removidos, suíte verde porque a prova tinha sido
 * apagada. O hook é o ponto onde o agente encerra o turno — se o worktree está
 * mutilado, encerrar é aceitar a perda sem ninguém ver.
 *
 * Fail-closed: falha ao avaliar NÃO vira aprovação (verdict UNAVAILABLE é
 * reportado, não silenciado), mas também não bloqueia para não travar o turno
 * por erro de ambiente.
 */
function inspectWorktree() {
  try {
    return evaluateWorktree({ cwd: ROOT, baseRef: 'HEAD' });
  } catch (error) {
    return { verdict: 'UNAVAILABLE', error: error.message, violations: [], filesChanged: 0, totals: { added: 0, removed: 0 } };
  }
}

function integritySignature(report) {
  const parts = (report.violations || []).map((v) => `${v.code}:${v.path}`).sort().join('|');
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 16);
}

function describeIntegrity(report) {
  return (report.violations || [])
    .slice(0, 6)
    .map((v) => `[${v.code}] ${v.path}`)
    .join('; ');
}

/**
 * TRAVA DE SESSÃO ÚNICA (2026-10-20).
 *
 * Causa raiz medida da mutilação cruzada: DUAS sessões de agente editando o
 * MESMO worktree ao mesmo tempo (medido: pts/41 rodava o coletor ER-V1 e
 * suítes de integração enquanto outra sessão restaurava arquivos de HEAD).
 * Cada lado "conserta" o que o outro mudou, a partir de contexto velho — o
 * resultado é exatamente o padrão de cópia degradada + testes removidos.
 *
 * A trava é DECLARATIVA e não destrutiva: registra o dono (pid do processo pai,
 * que vive enquanto a sessão viver) e AVISA quando há outro dono vivo. Nunca
 * mata nem bloqueia processo alheio — quem decide é o humano.
 */
function readOwner() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OWNER_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  const value = Number(pid);
  if (!Number.isFinite(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function writeOwner(owner) {
  try {
    fs.mkdirSync(path.dirname(OWNER_PATH), { recursive: true });
    fs.writeFileSync(OWNER_PATH, JSON.stringify(owner));
  } catch {
    /* trava auxiliar: falha aqui nunca quebra o turno */
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
  return items.map((item) => `${item.id} — ${item.title} [${item.status}: ${openReason(item.status)}]`).join('; ');
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
  const integrity = inspectWorktree();
  const integrityBlocking = integrity.verdict === 'FAIL';

  if (eventName === 'SessionStart') {
    const previousOwner = readOwner();
    const myPid = process.ppid;
    const concurrentSession = Boolean(previousOwner && Number(previousOwner.pid) !== Number(myPid) && isAlive(previousOwner.pid));
    if (!concurrentSession) {
      writeOwner({ pid: myPid, startedAt: new Date().toISOString(), tty: process.env.TTY || null });
    }

    if (!items.length && !integrityBlocking && !concurrentSession) {
      emit({});
      return;
    }
    const parts = [];
    if (concurrentSession) {
      parts.push(
        `ATENCAO: OUTRA SESSAO DE AGENTE ATIVA neste worktree (pid ${previousOwner.pid}, desde ${previousOwner.startedAt}). ` +
        'Duas sessoes editando o mesmo worktree produzem copias degradadas e testes removidos — ' +
        'encerre uma delas antes de editar; nao restaure arquivos que a outra sessao esta mudando.',
      );
    }
    if (items.length) {
      parts.push(
        `Fila de hardening aberta em ${QUEUE_PATH} (${items.length} item(ns)): ${describe(items)}. ` +
        'Trabalhe item a item sem pausar para pedir confirmacao; a cada item concluido marque status "done", ' +
        'grave "commit" e "evidence" no JSON e commite antes de seguir para o proximo.',
      );
    }
    if (integrityBlocking) {
      parts.push(
        `ATENCAO: worktree MUTILADO (${integrity.violations.length} violacao(oes), ` +
        `+${integrity.totals.added}/-${integrity.totals.removed} linhas): ${describeIntegrity(integrity)}. ` +
        'Restaure de HEAD antes de qualquer trabalho novo; nao commite o worktree como esta.',
      );
    }
    emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join(' ') } });
    return;
  }

  if (eventName !== 'Stop') {
    emit({});
    return;
  }

  // Mutilacao detectada: bloqueia UMA vez por assinatura (evita laco quando o
  // agente nao consegue restaurar sozinho — ex.: precisa de decisao humana).
  if (integrityBlocking) {
    const signature = integritySignature(integrity);
    const previous = readState();
    if (previous.integritySignature !== signature) {
      writeState({ ...previous, integritySignature: signature });
      emit({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          decision: 'block',
          reason:
            `WORKTREE MUTILADO: ${integrity.violations.length} violacao(oes) contra HEAD ` +
            `(+${integrity.totals.added}/-${integrity.totals.removed} linhas) — ${describeIntegrity(integrity)}. ` +
            'Restaure os arquivos de HEAD (git checkout HEAD -- <arquivo>) ou registre waiver com motivo. ' +
            'Nao commite nem publique o worktree neste estado.',
        },
      });
      return;
    }
  }

  const owner = readOwner();
  if (owner && Number(owner.pid) === Number(process.ppid)) {
    try { fs.rmSync(OWNER_PATH, { force: true }); } catch { /* auxiliar */ }
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
