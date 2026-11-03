#!/usr/bin/env node
'use strict';

/**
 * prove-lro-outbox-claim.js — prova REAL do claim da outbox do LRO (P1-D).
 *
 * POR QUE EXISTE
 * --------------
 * O claim usa `FOR UPDATE SKIP LOCKED` e marca `PUBLISHING` antes de publicar. Testes na mesma
 * instância não provam nem exclusão entre PROCESSOS nem recuperação de claim órfão. Este script
 * exercita os dois cenários com processos separados de verdade:
 *
 *   1. CONCORRÊNCIA: dois dispatchers em processos distintos reclamam o mesmo lote. O total
 *      publicado não pode passar do número de pendentes (nenhuma linha entregue duas vezes).
 *   2. SIGKILL: um processo reserva o lote e MORRE entre claim e publicação. As linhas ficam em
 *      `PUBLISHING`; `reclaimStale` as devolve para a fila e a entrega acontece depois.
 *
 * REQUISITOS: PostgreSQL acessível (usa as mesmas envs da API). NUNCA rode com o worker da API
 * ligado no mesmo banco — ele drena a fila e contamina a medição (foi medido em 2026-10-31).
 *
 * Uso: node scripts/governance/prove-lro-outbox-claim.js [--json]
 * Exit 0 somente se as DUAS invariantes se sustentarem.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
// Evidência em `reports/` (taxonomia canônica de relatórios): `audit:json-persistence` reprova
// escrita .json fora dela — por isso o relatório NÃO vai para AI_MEMORY/evidence.
const EVIDENCIA = path.join(ROOT, 'reports');
const TEMP = path.join(ROOT, 'AI_MEMORY', 'evidence', 'lro-outbox-claim');
const FILHO = path.join(TEMP, '_filho-dispatcher.js');

const saidaJson = process.argv.includes('--json');

function escreverFilho() {
  fs.mkdirSync(TEMP, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILHO, `'use strict';
const path = require('path');
const ROOT = ${JSON.stringify(ROOT)};
const db = require(path.join(ROOT, 'api/db/sequelize.js'));
const dispatcher = require(path.join(ROOT, 'api/services/lro/lroOutboxDispatcher.js'));

(async () => {
  await db.connect();
  const modo = process.argv[2] || 'publish';
  if (modo === 'claim-e-morrer') {
    await dispatcher.claimBatch({ limit: 50 });
    // Sem exit: o pai mata este processo com SIGKILL entre o claim e a publicação.
    process.stdout.write('CLAIMED\\n');
    setInterval(() => {}, 1000);
    return;
  }
  const r = await dispatcher.dispatch({ publish: async () => {}, limit: 50 });
  // write em pipe é assíncrono: sair imediatamente truncava a saída (medido 2026-10-31).
  process.stdout.write(JSON.stringify(r) + '\\n', () => { process.exitCode = 0; });
})().catch((e) => { process.stderr.write('ERRO:' + (e.code || e.message) + '\\n'); process.exitCode = 1; });
`, { mode: 0o600 });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  escreverFilho();
  const db = require(path.join(ROOT, 'api/db/sequelize.js'));
  const service = require(path.join(ROOT, 'api/services/lro/lroService.js'));
  const dispatcher = require(path.join(ROOT, 'api/services/lro/lroOutboxDispatcher.js'));
  const models = require(path.join(ROOT, 'api/db/models'));

  await db.connect();
  const marca = Date.now();
  const problemas = [];

  const criar = async (quantidade, prefixo) => {
    for (let i = 0; i < quantidade; i += 1) {
      await service.createOperation({
        tenantId: 'system',
        operationType: 'qa_waves',
        visibilityClass: 'DEVELOPMENT',
        ownerActorId: 'prova-outbox-claim',
        idempotencyKey: `${prefixo}-${marca}-${i}`,
      });
    }
  };

  const executarFilho = (modo) => new Promise((resolve) => {
    const p = spawn(process.execPath, [FILHO, modo], { cwd: ROOT });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim(), proc: p }));
  });

  // ── 1) concorrência entre PROCESSOS ─────────────────────────────────────────
  await dispatcher.reclaimStale({ olderThanMs: 0 });
  await criar(20, 'conc');
  const pendentes = await models.getLroOutbox().count({ where: { status: 'PENDING' } });
  const dois = await Promise.all([executarFilho('publish'), executarFilho('publish')]);
  const publicados = dois.map((r) => {
    const ultima = r.out.split('\n').filter(Boolean).pop() || '';
    try { return JSON.parse(ultima).publicados; } catch (_) { return null; }
  });
  const soma = publicados.reduce((a, b) => a + (Number(b) || 0), 0);
  const restantes = await models.getLroOutbox().count({ where: { status: ['PENDING', 'PUBLISHING'] } });
  const conc = {
    pendentes,
    publicadosPorProcesso: publicados,
    somaPublicada: soma,
    restantes,
    semDuplicacao: soma <= pendentes,
    semLinhaPresa: restantes === 0,
  };
  if (!conc.semDuplicacao) problemas.push('PUBLICACAO_DUPLICADA');
  if (!conc.semLinhaPresa) problemas.push('LINHA_PRESA_APOS_CONCORRENCIA');

  // ── 2) SIGKILL entre claim e publicação ─────────────────────────────────────
  await criar(3, 'kill');
  const filho = spawn(process.execPath, [FILHO, 'claim-e-morrer'], { cwd: ROOT });
  await new Promise((resolve) => {
    let buf = '';
    filho.stdout.on('data', (c) => { buf += c; if (buf.includes('CLAIMED')) resolve(); });
    setTimeout(resolve, 15000);
  });
  filho.kill('SIGKILL');
  await espera(500);

  const emVoo = await models.getLroOutbox().count({ where: { status: 'PUBLISHING' } });
  const recuperacao = await dispatcher.reclaimStale({ olderThanMs: 0 });
  const aposReclaim = await models.getLroOutbox().count({ where: { status: 'PUBLISHING' } });
  const entrega = await dispatcher.dispatch({ publish: async () => {}, limit: 50 });
  const presosFinal = await models.getLroOutbox().count({ where: { status: 'PUBLISHING' } });

  const kill = {
    linhasEmVooAposSigkill: emVoo,
    recuperadas: recuperacao.recuperadas,
    publishingAposReclaim: aposReclaim,
    publicadasNaRetomada: entrega.publicados,
    publishingFinal: presosFinal,
    nenhumEventoPreso: presosFinal === 0,
  };
  if (emVoo === 0) problemas.push('SIGKILL_NAO_DEIXOU_CLAIM_ORFAO');
  if (aposReclaim !== 0) problemas.push('RECLAIM_NAO_LIBEROU_CLAIM');
  if (presosFinal !== 0) problemas.push('EVENTO_PERMANENTEMENTE_PRESO');

  const relatorio = {
    kind: 'lro-outbox-claim-proof',
    generatedAt: new Date().toISOString(),
    commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    concorrencia: conc,
    sigkill: kill,
    problemas,
    ok: problemas.length === 0,
  };
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCIA, 'lro-outbox-claim-report.json'), `${JSON.stringify(relatorio, null, 2)}\n`, { mode: 0o600 });
  fs.unlinkSync(FILHO);

  if (saidaJson) process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`);
  else {
    process.stdout.write(`[outbox-claim] concorrência: publicados=${soma}/${pendentes} restantes=${restantes}\n`);
    process.stdout.write(`[outbox-claim] SIGKILL: em_voo=${emVoo} recuperadas=${recuperacao.recuperadas} publicadas_na_retomada=${entrega.publicados} presos=${presosFinal}\n`);
    process.stdout.write(`[outbox-claim] ok=${relatorio.ok}${problemas.length ? ` problemas=${problemas.join(',')}` : ''}\n`);
  }
  process.exitCode = relatorio.ok ? 0 : 1;
}

main().catch((erro) => {
  process.stderr.write(`[outbox-claim] FALHA: ${erro.code || erro.message}\n`);
  process.exitCode = 1;
});
