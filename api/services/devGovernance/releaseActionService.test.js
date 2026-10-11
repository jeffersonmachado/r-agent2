'use strict';

/**
 * Persistência do histórico das ações de release.
 *
 * O que este teste protege (o defeito que ele existe para impedir):
 *   - reiniciar a API NÃO pode apagar o que já aconteceu;
 *   - um registro gravado como `running` por uma sessão anterior NÃO pode
 *     continuar "rodando para sempre": se o PID não está vivo, o estado é
 *     `interrupted` com o motivo escrito — status mentiroso é pior que status
 *     ausente.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

let service;
let raiz;

function dirJobs() {
  return path.join(raiz, 'logs', 'dev-governance');
}

function gravarRegistro(registro) {
  fs.mkdirSync(dirJobs(), { recursive: true });
  fs.writeFileSync(path.join(dirJobs(), `${registro.id}.job.json`), JSON.stringify(registro));
}

describe('releaseActionService — persistência do histórico', () => {
  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-devgovernance-'));
    configureRuntimeRoot(raiz);
    // Módulo recarregado por teste para não herdar o Map em memória do anterior.
    jest.resetModules();
    service = require('./releaseActionService');
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    try { fs.rmSync(raiz, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  });

  it('lê o registro de uma sessão anterior (histórico não some no reinício)', () => {
    gravarRegistro({
      id: 'job-antigo',
      actionId: 'verify',
      label: 'Verificar o entregue',
      status: 'succeeded',
      exitCode: 0,
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: '2026-10-11T10:05:00.000Z',
      logPath: path.join(dirJobs(), 'release-verify-job-antigo.log'),
    });
    const itens = service.listReleaseActions();
    const encontrado = itens.find((item) => item.id === 'job-antigo');
    expect(encontrado).toBeTruthy();
    expect(encontrado.status).toBe('succeeded');
    expect(encontrado.exitCode).toBe(0);
  });

  it('registro `running` de sessão anterior com LEASE VENCIDO vira `interrupted` com motivo', () => {
    gravarRegistro({
      id: 'job-orfao',
      actionId: 'seal',
      label: 'Novo ciclo de selagem',
      status: 'running',
      // A autoridade é o LEASE (tempo). O `pid_hint` está aqui de propósito: PID
      // não decide nada — a política do repo proíbe PID como autoridade de liveness.
      pid_hint: 999999,
      lease_token: 'token-antigo',
      lease_expires_at: '2026-10-11T10:02:00.000Z',
      heartbeat_at: '2026-10-11T10:00:00.000Z',
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: null,
      logPath: path.join(dirJobs(), 'release-seal-job-orfao.log'),
    });
    const job = service.getReleaseAction({ jobId: 'job-orfao' });
    expect(job.status).toBe('interrupted');
    expect(job.lease_state).toBe('EXPIRED');
    expect(job.interruptedReason).toMatch(/lease/);
  });

  it('registro `running` com LEASE VÁLIDO permanece `running` mesmo com PID morto', () => {
    gravarRegistro({
      id: 'job-vivo',
      actionId: 'verify',
      label: 'Verificar o entregue',
      status: 'running',
      // PID improvável NÃO pode interromper: se ele decidisse, este teste falharia
      // (é exatamente a regressão que a política de timeout existe para impedir).
      pid_hint: 999999,
      lease_token: 'token-vivo',
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      heartbeat_at: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logPath: path.join(dirJobs(), 'release-verify-job-vivo.log'),
    });
    const job = service.getReleaseAction({ jobId: 'job-vivo' });
    expect(job.status).toBe('running');
    expect(job.lease_state).toBe('VALID');
    expect(job.interruptedReason).toBeUndefined();
  });

  it('lê o fim do log do job persistido (a evidência sobrevive ao reinício)', () => {
    const logPath = path.join(dirJobs(), 'release-verify-job-log.log');
    fs.mkdirSync(dirJobs(), { recursive: true });
    fs.writeFileSync(logPath, 'linha 1\nlinha 2\nDELIVERED_RELEASE_VERIFIED\n');
    gravarRegistro({
      id: 'job-log',
      actionId: 'verify',
      label: 'Verificar o entregue',
      status: 'succeeded',
      exitCode: 0,
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: '2026-10-11T10:01:00.000Z',
      logPath,
    });
    const job = service.getReleaseAction({ jobId: 'job-log' });
    expect(job.logTail).toMatch(/DELIVERED_RELEASE_VERIFIED/);
  });

  it('registro ilegível é ignorado sem derrubar a listagem', () => {
    fs.mkdirSync(dirJobs(), { recursive: true });
    fs.writeFileSync(path.join(dirJobs(), 'quebrado.job.json'), '{nao-e-json');
    expect(() => service.listReleaseActions()).not.toThrow();
    expect(service.readPersistedJobs()).toHaveLength(0);
  });

  it('job inexistente ⇒ erro tipado (nunca um estado inventado)', () => {
    expect(() => service.getReleaseAction({ jobId: 'nao-existe' })).toThrow(/release_action_not_found/);
  });

  it('a autoridade de liveness é o LEASE (tempo), nunca o PID', () => {
    expect(service.JOB_LEASE_TTL_MS).toBeGreaterThan(0);
    const vencido = service.projectRecordState({
      status: 'running', lease_expires_at: '2020-01-01T00:00:00.000Z', pid_hint: process.pid,
    });
    expect(vencido.status).toBe('interrupted');
    const valido = service.projectRecordState({
      status: 'running', lease_expires_at: '2999-01-01T00:00:00.000Z', pid_hint: 999999,
    });
    expect(valido.status).toBe('running');
    // Não existe autoridade de liveness por PID exportada por este serviço.
    expect(service.isProcessAlive).toBeUndefined();
  });

  it('exporta o teto de retenção do histórico persistido', () => {
    expect(service.MAX_PERSISTED_JOBS).toBeGreaterThan(0);
  });
});

// ── H4: exclusividade REAL entre processos ──────────────────────────────────────
//
// DEFEITO MEDIDO (2026-10-11): o single-flight era um `Map` em memória — valia só
// dentro do próprio processo. Com DUAS instâncias da API, duas requisições
// iniciavam a mesma ação mutante (`seal`, `publish-tag`), que mexe em `dist/`, em
// tag de git e no repositório. Exclusividade que não atravessa processos não é
// exclusividade; e lock em memória também não sobrevive a restart.
//
// A exclusividade agora é do SO (`flock`), mantida pelo processo enquanto o
// comando roda: atômica entre processos, liberada pelo kernel quando o dono morre
// (sem lock órfão e sem limpeza manual para errar) e com fencing de graça — não
// existe "execução superada" capaz de seguir mutando.
describe('releaseActionService — exclusividade entre instâncias (H4)', () => {
  let cenario;
  let alvo;

  beforeEach(() => {
    cenario = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-h4-'));
    configureRuntimeRoot(cenario);
    jest.resetModules();
    service = require('./releaseActionService');
    alvo = path.join(cenario, 'efeito-colateral.txt');
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    try { fs.rmSync(cenario, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  });

  /** Executa a spec REAL do serviço, como o spawn de produção faz. */
  function executarSpec(definition) {
    const spec = service.buildExecutionSpec(definition);
    return spawnSync(spec.command, spec.args, { encoding: 'utf8' });
  }

  /** Grava um registro no runtime do CENÁRIO (o helper do describe vizinho usa o
   * diretório dele — reutilizá-lo aqui gravava no lugar errado e o teste media
   * outra coisa). */
  function gravarNoCenario(registro) {
    const dir = path.join(cenario, 'logs', 'dev-governance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${registro.id}.job.json`), JSON.stringify(registro));
  }

  it('o comando roda sob o lock do SO, com código próprio para conflito', () => {
    const spec = service.buildExecutionSpec({ command: 'npm', args: ['run', 'verify'], mutates: false });
    expect(spec.lockMode).toBe('flock');
    expect(spec.command).toBe('flock');
    expect(spec.args.slice(0, 3)).toEqual(['-n', '-E', String(service.FLOCK_CONFLICT_EXIT)]);
    expect(spec.args[3]).toBe(service.releaseLockPath());
    // O lock vive FORA do workspace (runtime root), como o resto do estado.
    expect(service.releaseLockPath().startsWith(cenario)).toBe(true);
    // E o comando canônico (com TODOS os argumentos) vai depois do lock.
    expect(spec.args.slice(4)).toEqual(['npm', 'run', 'verify']);
  });

  it('a tag do release entra ANTES do lock (regressão: spec montado cedo demais)', () => {
    const args = ['scripts/create-release-tag.sh', 'r-agent2-20261011-000000'];
    const spec = service.buildExecutionSpec(
      { command: 'bash', args: ['scripts/create-release-tag.sh'], mutates: true },
      ['r-agent2-20261011-000000'],
    );
    expect(spec.args.slice(-2)).toEqual(args);
  });

  it('prova real: com o lock ocupado o comando NÃO executa e sai com o código de conflito', () => {
    // Um "outro processo" (outra instância) segura o lock.
    const dono = spawn('flock', ['-n', service.releaseLockPath(), 'sleep', '4']);
    try {
      // Espera o dono adquirir (polling curto e limitado pela própria API do SO).
      const inicio = Date.now();
      while (service.lockIsHeld() !== true && Date.now() - inicio < 3000) {
        execFileSync('sleep', ['0.05']);
      }
      expect(service.lockIsHeld()).toBe(true);

      const resultado = executarSpec({ command: 'touch', args: [alvo], mutates: false });
      expect(resultado.status).toBe(service.FLOCK_CONFLICT_EXIT);
      // O efeito colateral NÃO aconteceu: o comando não foi iniciado.
      expect(fs.existsSync(alvo)).toBe(false);
    } finally {
      // Mata o dono E o comando que ele iniciou (o filho herda o fd do lock — é
      // justamente isso que garante exclusividade real enquanto a ação roda).
      try { execFileSync('pkill', ['-P', String(dono.pid)]); } catch (_) { /* já saiu */ }
      dono.kill('SIGKILL');
    }
  });

  it('prova real: o lock é liberado quando o comando TERMINA, sem limpeza manual', () => {
    const dono = spawn('flock', ['-n', service.releaseLockPath(), 'sleep', '0.6']);
    const inicio = Date.now();
    while (service.lockIsHeld() !== true && Date.now() - inicio < 3000) {
      execFileSync('sleep', ['0.05']);
    }
    expect(service.lockIsHeld()).toBe(true);

    // O comando termina sozinho e o kernel libera o lock: nenhum lock órfão.
    const limite = Date.now();
    while (service.lockIsHeld() !== false && Date.now() - limite < 5000) {
      execFileSync('sleep', ['0.05']);
    }
    expect(service.lockIsHeld()).toBe(false);

    const resultado = executarSpec({ command: 'touch', args: [alvo], mutates: false });
    expect(resultado.status).toBe(0);
    expect(fs.existsSync(alvo)).toBe(true);
    dono.kill('SIGKILL');
  });

  it('registro persistido VIVO de outra instância bloqueia nova ação (não só o Map local)', async () => {
    gravarNoCenario({
      id: 'job-de-outra-instancia',
      actionId: 'seal',
      status: 'running',
      startedAt: new Date().toISOString(),
      lease_token: 'token-de-outra-instancia',
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      logPath: path.join(dirJobs(), 'release-seal-outra.log'),
    });
    await expect(service.runReleaseAction({ actionId: 'verify' }))
      .rejects.toThrow(/release_action_in_flight/);
  });

  it('registro persistido com lease VENCIDO não bloqueia (não inventa execução)', async () => {
    gravarNoCenario({
      id: 'job-morto',
      actionId: 'seal',
      status: 'running',
      startedAt: '2026-10-01T00:00:00.000Z',
      lease_token: 'token-morto',
      lease_expires_at: '2026-10-01T00:01:00.000Z',
      logPath: path.join(dirJobs(), 'release-seal-morto.log'),
    });
    // Sem `flock` no PATH a ação mutante é recusada por INFRAESTRUTURA — o que
    // prova que a checagem de exclusividade vem antes da de estado e que o lease
    // vencido não fabricou um "em execução".
    await expect(service.runReleaseAction({ actionId: 'seal', confirm: true }))
      .rejects.not.toThrow(/release_action_in_flight/);
  });

  it('sem flock, ação MUTANTE é recusada fail-closed (nunca roda sem a garantia)', () => {
    // A regra é testada por DECISÃO: a detecção de `flock` é condição de ambiente
    // (a resolução de executáveis usa o ambiente C do processo, congelado no boot),
    // então simular ausência mudando `PATH` em runtime mentiria. A detecção real é
    // provada por execução nos dois testes de lock acima.
    const mutante = { command: 'bash', args: ['x.sh'], mutates: true };
    const leitura = { command: 'npm', args: ['run', 'verify'], mutates: false };

    expect(() => service.assertExclusivityAvailable({ definition: mutante, flockDisponivel: false }))
      .toThrow(/release_action_lock_unavailable/);
    expect(service.assertExclusivityAvailable({ definition: leitura, flockDisponivel: false }))
      .toBe('none');
    expect(service.assertExclusivityAvailable({ definition: mutante, flockDisponivel: true }))
      .toBe('flock');
  });
});
