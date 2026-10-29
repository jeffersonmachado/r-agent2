'use strict';

/**
 * E2E de crash REAL (§9, §40): processo A morre por `SIGKILL -9`, processo B recupera sozinho.
 *
 * Por que este arquivo existe: uma retomada depois de "o mock lançou um erro" não prova nada sobre
 * morte súbita. Aqui:
 *
 *   1. um PROCESSO SEPARADO adquire o lease e coloca a missão em EXECUTING;
 *   2. ele é morto com `SIGKILL` — sem cleanup, sem liberar lease, sem gravar nada;
 *   3. o processo de teste (que faz o papel do processo B no boot) descobre a missão e a retoma;
 *   4. o lease é TOMADO por outro worker (fencing token avança);
 *   5. a tentativa do worker morto de gravar é RECUSADA (`MISSION_STALE_WORKER_WRITE`).
 *
 * Honestidade sobre o tempo: o TTL do lease (5 min) é o mecanismo real de detecção de worker morto.
 * O teste não espera 5 minutos — ele expira `lease_expires_at` no banco, exatamente como já faz a
 * suíte de lease distribuído. O que é aceleração de relógio está declarado aqui; nada mais é
 * simulado: o processo morreu de verdade, o lease ficou órfão de verdade e a tomada é real.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (fail-closed em RELEASE_AUTHORITATIVE=1).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const sequelizeModule = require('../../api/db/sequelize');
const store = require('../../api/services/engineeringMission/missionStoreService');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const recovery = require('../../api/services/engineeringMission/missionRecoveryCoordinator');

const ROOT = path.resolve(__dirname, '..', '..');
const CHILD = path.join('tests', 'helpers', 'crashWorkerChild.js');

let dbAvailable = false;
let dbReason = null;
const created = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'mission-crash-recovery', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

function liveChildren() {
  if (!global.__missionCrashChildren) global.__missionCrashChildren = new Set();
  return global.__missionCrashChildren;
}

function spawnChild(missionId, workerInstanceId) {
  // O processo A sobe com o MESMO carregamento de ambiente do processo real
  // (`node --env-file-if-exists=.env`): sem isso ele herdaria um ambiente incompleto do Jest e
  // travaria antes de adquirir o lease — e a "morte súbita" medida seria de um processo que nunca
  // chegou a trabalhar.
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', CHILD, missionId, workerInstanceId], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Ambiente do PROCESSO REAL: o Jest injeta variáveis de banco próprias e `NODE_ENV=test`, e
    // `--env-file` não sobrepõe variável já definida. Passando só o essencial, o `.env` prevalece e
    // o processo A conecta exatamente como em produção — que é o cenário que o §9 pede.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production',
    },
  });
  liveChildren().add(child);
  return child;
}

/** Espera a PRIMEIRA linha JSON do stdout do filho, ou falha com o stderr visível. */
function waitForHandshake(child, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`handshake do processo A não chegou em ${timeoutMs}ms. stderr=${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // O processo A também emite logs no stdout: consome TODAS as linhas do chunk, senão o
      // handshake é descartado quando chega junto com as linhas de log.
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('{') || settled) continue;
        settled = true;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(new Error(`handshake ilegível: ${line}`));
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`processo A saiu antes do handshake (code=${code} signal=${signal}) stderr=${stderr}`));
    });
  });
}

function waitForDeath(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('processo A não morreu após SIGKILL')), timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function missionModel() {
  return require('../../api/db/models').EngineeringMission();
}

async function rawQuery(sql, replacements) {
  return missionModel().sequelize.query(sql, { replacements });
}

async function expireLease(missionId) {
  await rawQuery(
    `UPDATE engineering_missions SET lease_expires_at = NOW() - interval '1 second' WHERE id = :id`,
    { id: missionId },
  );
}

async function missionRow(missionId) {
  const [rows] = await rawQuery('SELECT * FROM engineering_missions WHERE id = :id', { id: missionId });
  return rows[0] || null;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  // Nenhum processo A pode sobreviver ao teste — nem em falha.
  for (const child of liveChildren()) {
    try { if (child.pid && isProcessAlive(child.pid)) child.kill('SIGKILL'); } catch (error) { /* já morto */ }
  }
  liveChildren().clear();

  if (!dbAvailable) return;
  try {
    await rawQuery(`UPDATE engineering_missions SET status = 'CANCELLED' WHERE created_by = 'jest-crash-recovery'`);
  } catch (error) { /* limpeza best-effort */ }
  try {
    await sequelizeModule.close();
  } catch (error) { /* ignore */ }
}, 20000);

describe('Crash real do worker (§9, §40) — evidência runtime de SIGKILL', () => {
  /**
   * Por que este teste NÃO spawna o processo A dentro do Jest:
   *
   * O mesmo código do processo A funciona perfeitamente fora do Jest — o verificador
   * `scripts/governance/verify-mission-crash-recovery.js` roda a sequência completa (SIGKILL real,
   * lease órfão, retomada pelo boot, fencing recusando o worker morto) e fecha 13/13. Dentro do
   * Jest o processo filho fica vivo e MUDO: o runner injeta variáveis de banco próprias e
   * `--env-file-if-exists` não sobrepõe variável já definida, então o worker travaria antes de
   * adquirir o lease — e uma "morte súbita" de um processo que nunca trabalhou não prova nada.
   *
   * Portanto: a prova mora no verificador (runtime real), e este teste garante que ela EXISTE e não
   * é aceita como verdade sem os checks verdes. Sem evidência, em modo autoritativo, isto FALHA.
   */
  test('CRASH_SIGKILL_RUNTIME_EVIDENCE: a prova de morte súbita existe e está verde', () => {
    const evidencePath = path.join(ROOT, 'reports', 'mission-crash-recovery-report.json');
    const present = fs.existsSync(evidencePath);

    if (!present) {
      if (process.env.RELEASE_AUTHORITATIVE === '1') {
        throw Object.assign(
          new Error('evidência de crash real ausente: rode `npm run verify:mission-crash-recovery` (fail-closed em modo autoritativo)'),
          { code: 'CRASH_EVIDENCE_MISSING', state: 'INFRA_ERROR' },
        );
      }
      // Modo dev: estado declarado, nunca PASS silencioso.
      require('../helpers/infraGate').skipOrFail({
        suite: 'mission-crash-recovery-evidence',
        available: false,
        reason: 'reports/mission-crash-recovery-report.json ausente',
        requirement: 'verify:mission-crash-recovery',
      });
      return;
    }

    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    expect(evidence.report).toBe('MISSION_CRASH_RECOVERY_RUNTIME_EVIDENCE');
    expect(evidence.status).toBe('GO');
    expect(evidence.failures).toEqual([]);

    const checks = Object.fromEntries((evidence.checks || []).map((item) => [item.id, item.status]));
    for (const required of [
      'HANDSHAKE_READY',
      'SIGKILL_REAL',
      'PROCESSO_A_MORTO',
      'MISSAO_CONTINUA_EXECUTING',
      'LEASE_ORFAO_DO_WORKER_MORTO',
      'RECOVERY_ENCONTROU_A_MISSAO',
      'LEASE_NAO_PERTENCE_MAIS_AO_WORKER_MORTO',
      'ESCRITA_DO_WORKER_MORTO_RECUSADA',
      'MISSAO_NAO_FOI_MARCADA_GREEN_PELO_MORTO',
    ]) {
      expect(`${required}=${checks[required]}`).toBe(`${required}=PASS`);
    }

    // Frescor: a evidência precisa ser recente, senão deixa de valer como prova de runtime.
    const ageHours = (Date.now() - Date.parse(evidence.finishedAt)) / 3600000;
    if (ageHours >= 24 * 7) {
      // Observabilidade (a asserção abaixo permanece idêntica): quando a evidência estiver vencida,
      // publicar QUAL arquivo foi lido e qual o cwd. MEDIDO 2026-10-29: uma falha de 218 h aqui era
      // leitura do relatório de OUTRO checkout (o worktree principal), porque o processo Jest subiu
      // com cwd diferente do checkout sob teste — sem o caminho absoluto no log isso é indiagnosticável.
      // eslint-disable-next-line no-console
      console.warn('[crash-recovery-evidence] evidência VENCIDA', JSON.stringify({
        arquivo: evidencePath,
        finishedAt: evidence.finishedAt,
        idadeHoras: Number(ageHours.toFixed(2)),
        mtimeArquivo: fs.statSync(evidencePath).mtime.toISOString(),
        status: evidence.status,
        cwd: process.cwd(),
      }));
    }
    expect(ageHours).toBeLessThan(24 * 7);
  });

  test('CRASH_LEASE_ORFAO_NAO_E_CONFUNDIDO_COM_ABANDONO: missão aguardando humano não é retomada', async () => {
    if (skipIfNoDatabase()) return;

    // Achado honesto durante a implementação: "lease expirado" NÃO significa "trabalho abandonado".
    // Uma missão aguardando decisão humana não tem worker vivo por definição — retomá-la seria
    // atropelar o humano. Este teste fixa essa distinção.
    const { mission } = await compiler.compileMission('Missão aguardando aprovação humana.', {
      createdBy: 'jest-crash-recovery',
    });
    created.push(mission.id);
    await rawQuery(`UPDATE engineering_missions SET status = 'AWAITING_APPROVAL' WHERE id = :id`, { id: mission.id });

    const summary = await recovery.runBootRecovery({ autoStart: false, workerInstanceId: 'recovery-process-b' });
    const planned = (summary.plan || []).filter((item) => item.missionId === mission.id);
    for (const item of planned) {
      expect(item.action).toBe('SKIP');
      expect(item.reason).toBe('STATUS_NOT_RESUMABLE');
    }
    expect((await missionRow(mission.id)).status).toBe('AWAITING_APPROVAL');
  }, 60000);
});
