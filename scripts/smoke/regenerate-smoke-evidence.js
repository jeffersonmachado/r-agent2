#!/usr/bin/env node
'use strict';

/**
 * regenerate-smoke-evidence.js — regenera `qa/smoke-evidence.json` contra a stack JÁ VIVA,
 * SEM `docker compose up/down`.
 *
 * DEFEITO QUE MOTIVA (P1-13): o único produtor da prova era `scripts/system-autotest-stack.sh`,
 * que sobe a stack inteira, roda `system:validate` + business QA + Vitest + pytest e derruba
 * tudo ao final. Com isso, regenerar a evidência exigia um ciclo EXTENSIVO — operação que a
 * governança de bug closure nega enquanto houver P0/P1 aberto. Resultado: a prova envelhecia,
 * o gate reprovava por staleness e o item ficava "bloqueado externamente" por desenho do
 * próprio ferramental, não por falta de stack.
 *
 * Este produtor roda EXATAMENTE os seis smokes que o script canônico alimenta (L01..L06) e
 * faz o fan-in com a MESMA definição de shape (`scripts/smoke/lib/smoke-evidence-summary.js`).
 * Não sobe nem derruba nada; não altera banco; não inventa status.
 *
 * Contrato:
 *  - sem stack disponível => exit 2, `SMOKE_EVIDENCE_STACK_UNAVAILABLE`, e NÃO escreve o arquivo
 *    (evidência fabricada é pior que evidência ausente);
 *  - status de cada smoke = exit code real (0 => pass, qualquer outro => fail);
 *  - relatório do arquivo é o mesmo consumido por `governance/proof-engine` e pela frescura.
 *
 * Uso:
 *   node scripts/smoke/regenerate-smoke-evidence.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { montarResumoSmoke, todosPassaram } = require('./lib/smoke-evidence-summary');

const API = String(process.env.TEST_API_URL || process.env.TEST_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const FRONTEND = String(process.env.TEST_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
const SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || path.join(ROOT, 'qa', 'smoke-evidence.json');
const DRY = process.argv.includes('--dry-run');

const SMOKES = [
  {
    chave: 'l01',
    script: 'scripts/test-physical-queue-smoke.js',
    log: 'qa/smoke/l01-physical-queue.log',
    evidencia: 'qa/l01-physical-queue-evidence.json',
    envVar: 'PHYSICAL_QUEUE_EVIDENCE_PATH',
  },
  {
    chave: 'l02',
    script: 'scripts/test-ura-publish-rollback-smoke.js',
    log: 'qa/smoke/l02-ura-publish-rollback.log',
    evidencia: 'qa/l02-ura-publish-rollback-evidence.json',
    envVar: 'URA_PUBLISH_ROLLBACK_EVIDENCE_PATH',
  },
  {
    chave: 'l03',
    script: 'scripts/test-pbx-voice-tts-asr-smoke.js',
    log: 'qa/smoke/l03-pbx-voice-tts-asr.log',
    evidencia: 'qa/l03-pbx-voice-tts-asr-evidence.json',
    envVar: 'PBX_VOICE_TTS_ASR_EVIDENCE_PATH',
  },
  {
    chave: 'l04',
    script: 'scripts/test-pbx-call-events-runtime-smoke.js',
    log: 'qa/smoke/l04-pbx-call-events-runtime.log',
    evidencia: 'qa/l04-pbx-call-events-runtime-evidence.json',
    envVar: 'PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH',
  },
  {
    chave: 'l05',
    script: 'scripts/test-inbox-runtime-smoke.js',
    log: 'qa/smoke/l05-chatpro-omnichannel.log',
    evidencia: 'qa/l05-chatpro-omnichannel-evidence.json',
    envVar: 'INBOX_RUNTIME_EVIDENCE_PATH',
  },
  {
    chave: 'l06',
    script: 'scripts/test-bpmn-editor-smoke.js',
    log: 'qa/smoke/l06-bpmn-editor-smoke.log',
    evidencia: 'qa/l06-bpmn-editor-evidence.json',
    envVar: 'BPMN_EDITOR_EVIDENCE_PATH',
  },
];

async function alcancavel(url) {
  try {
    const resposta = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return resposta.status < 500;
  } catch (_) {
    return false;
  }
}

function lerJson(caminhoAbsoluto) {
  try {
    return JSON.parse(fs.readFileSync(caminhoAbsoluto, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function main() {
  const apiOk = await alcancavel(`${API}/health`);
  const frontOk = await alcancavel(FRONTEND);
  if (!apiOk || !frontOk) {
    process.stderr.write(`[smoke-evidence] SMOKE_EVIDENCE_STACK_UNAVAILABLE api=${API}(${apiOk}) frontend=${FRONTEND}(${frontOk})\n`);
    process.stderr.write('[smoke-evidence] stack ausente: nada foi escrito (evidência fabricada é pior que ausente)\n');
    process.exit(2);
  }

  const ambiente = {
    ...process.env,
    TEST_BASE_URL: API,
    TEST_API_URL: API,
    TEST_FRONTEND_URL: FRONTEND,
    FRONTEND_URL: FRONTEND,
    TEST_TENANT_ID: process.env.TEST_TENANT_ID || 'system',
    RPA_IGNORE_API_CONSOLE_ERRORS: 'true',
  };

  const smokes = {};
  for (const alvo of SMOKES) {
    const logPath = path.join(ROOT, alvo.log);
    const evidenciaPath = path.join(ROOT, alvo.evidencia);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    // Evidência ANTERIOR do mesmo smoke não pode sobreviver a uma execução que falhou:
    // o fan-in leria um arquivo velho e declararia pass com exit != 0.
    try { fs.unlinkSync(evidenciaPath); } catch (_) { /* não existia */ }

    process.stdout.write(`[smoke-evidence] ${alvo.chave} :: ${alvo.script}\n`);
    const exec = spawnSync(process.execPath, [path.join(ROOT, alvo.script)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...ambiente, [alvo.envVar]: evidenciaPath },
      timeout: Number(process.env.SMOKE_TIMEOUT_MS || 600000),
      maxBuffer: 32 * 1024 * 1024,
    });
    const saida = `${exec.stdout || ''}${exec.stderr || ''}`;
    fs.writeFileSync(logPath, saida, 'utf8');
    const status = exec.status === 0 ? 'pass' : 'fail';
    smokes[alvo.chave] = {
      status,
      logPath: alvo.log,
      evidencePath: alvo.evidencia,
      evidence: status === 'pass' ? lerJson(evidenciaPath) : null,
    };
    process.stdout.write(`[smoke-evidence] ${alvo.chave} => ${status} (exit=${exec.status})\n`);
  }

  const resumo = montarResumoSmoke({ smokes });
  if (DRY) {
    process.stdout.write(`${JSON.stringify(resumo, null, 2)}\n`);
    process.exit(todosPassaram(resumo) ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(resumo, null, 2)}\n`, 'utf8');
  process.stdout.write(`[smoke-evidence] escrito: ${path.relative(ROOT, SUMMARY_PATH)}\n`);
  process.exit(todosPassaram(resumo) ? 0 : 1);
}

main().catch((erro) => {
  process.stderr.write(`[smoke-evidence] erro: ${erro && erro.message}\n`);
  process.exit(2);
});
