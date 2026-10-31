#!/usr/bin/env node
'use strict';

/**
 * prove-negative-evidence.js — produz EVIDÊNCIA NEGATIVA real para fechamentos P0.
 *
 * POR QUE EXISTE
 * --------------
 * Para P0, "o teste passa" não basta: um teste pode passar por acidente, ou porque nunca exercita o
 * controle. A prova negativa exige demonstrar que o teste FALHA quando o controle desaparece. Este
 * script faz isso de forma reprodutível e auditável, com mutação declarada em
 * `governance/bug-closure/negative-evidence-registry.json` (find/replace EXATO, revisável a olho).
 *
 * PROTOCOLO (fail-closed em cada etapa)
 * -------------------------------------
 *   1. baseline: teste PASSA no código atual (senão BLOCKED — não há o que provar);
 *   2. mutação: aplica a neutralização do controle e o teste tem de FALHAR;
 *   3. restauração: devolve o arquivo byte-a-byte e confirma sha256 igual ao original;
 *   4. confirmação: teste PASSA de novo no código restaurado.
 *
 * Se qualquer etapa falhar, a entrada NÃO vira evidência: o item fica BLOCKED com motivo.
 * O registro de evidência é gravado em `reports/prova-negativa-report.json` (taxonomia canônica).
 *
 * Uso:
 *   node scripts/governance/prove-negative-evidence.js [--only P0-2,P0-3] [--json]
 *        [--registry <arquivo>] [--timeout-ms N]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const arg = (nome, padrao = null) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes(nome);

const REGISTRY = path.resolve(ROOT, arg('--registry', path.join('governance', 'bug-closure', 'negative-evidence-registry.json')));
const TIMEOUT = Number(arg('--timeout-ms', '600000'));
const ONLY = (arg('--only') || '').split(',').map((x) => x.trim()).filter(Boolean);
const EVIDENCIA_DIR = path.join(ROOT, 'AI_MEMORY', 'evidence', 'prova-negativa');
const RELATORIO = path.join(ROOT, 'reports', 'prova-negativa-report.json');

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

function rodarTeste(testRel) {
  const inicio = Date.now();
  const r = spawnSync('npx', ['jest', testRel, '--bail=1', '--ci'], {
    cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT, shell: false,
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  return {
    testPath: testRel,
    command: `npx jest ${testRel} --bail=1 --ci`,
    exitCode: r.status,
    startedAt: new Date(inicio).toISOString(),
    finishedAt: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
    saida,
  };
}

function salvarLog(defectId, etapa, saida) {
  fs.mkdirSync(EVIDENCIA_DIR, { recursive: true, mode: 0o700 });
  const destino = path.join(EVIDENCIA_DIR, `${defectId}-${etapa}.log`);
  fs.writeFileSync(destino, saida, { mode: 0o600 });
  return { rel: path.relative(ROOT, destino).replace(/\\/g, '/'), sha256: sha256(saida) };
}

function provar(mutacao) {
  const alvoAbs = path.join(ROOT, mutacao.targetFile);
  if (!fs.existsSync(alvoAbs)) {
    return { ok: false, code: 'ARQUIVO_ALVO_AUSENTE', detail: mutacao.targetFile };
  }
  const original = fs.readFileSync(alvoAbs, 'utf8');
  const ocorrencias = original.split(mutacao.find).length - 1;
  if (ocorrencias !== 1) {
    return { ok: false, code: 'MUTACAO_AMBIGUA', detail: `find ocorre ${ocorrencias}x em ${mutacao.targetFile}` };
  }
  const originalSha = sha256(original);

  // 1) baseline
  const baseline = rodarTeste(mutacao.test);
  const logBaseline = salvarLog(mutacao.defectId, `baseline-${sha256(mutacao.find).slice(0, 8)}`, baseline.saida);
  if (baseline.exitCode !== 0) {
    return {
      ok: false,
      code: 'TESTE_NAO_PASSA_NO_BASELINE',
      detail: `exit ${baseline.exitCode}`,
      baseline: { exitCode: baseline.exitCode, log: logBaseline },
    };
  }

  // 2) mutação
  let mutado;
  try {
    fs.writeFileSync(alvoAbs, original.replace(mutacao.find, mutacao.replace));
    mutado = rodarTeste(mutacao.test);
  } finally {
    // 3) restauração SEMPRE (inclusive em exceção) + verificação byte-a-byte
    fs.writeFileSync(alvoAbs, original);
  }
  const restauradoSha = sha256(fs.readFileSync(alvoAbs, 'utf8'));
  const logMutado = salvarLog(mutacao.defectId, `mutado-${sha256(mutacao.find).slice(0, 8)}`, mutado.saida);

  if (restauradoSha !== originalSha) {
    return { ok: false, code: 'RESTAURACAO_DIVERGENTE', detail: `${originalSha.slice(0, 12)} -> ${restauradoSha.slice(0, 12)}` };
  }
  if (mutado.exitCode === 0) {
    return {
      ok: false,
      code: 'TESTE_NAO_FALHA_SOB_MUTACAO',
      detail: 'o teste passou com o controle neutralizado — ele não prova o controle',
      mutacao: { exitCode: mutado.exitCode, log: logMutado },
    };
  }

  // 4) confirmação pós-restauração
  const confirmacao = rodarTeste(mutacao.test);
  const logConfirmacao = salvarLog(mutacao.defectId, `restaurado-${sha256(mutacao.find).slice(0, 8)}`, confirmacao.saida);
  if (confirmacao.exitCode !== 0) {
    return { ok: false, code: 'TESTE_NAO_VOLTA_A_PASSAR', detail: `exit ${confirmacao.exitCode}` };
  }

  return {
    ok: true,
    evidencia: {
      targetFile: mutacao.targetFile,
      control: mutacao.control,
      mutatedFromSha256: originalSha,
      mutatedToSha256: sha256(original.replace(mutacao.find, mutacao.replace)),
      testPath: mutacao.test,
      command: baseline.command,
      baseline: { exitCode: baseline.exitCode, log: logBaseline.rel, logSha256: logBaseline.sha256 },
      mutated: { exitCode: mutado.exitCode, log: logMutado.rel, logSha256: logMutado.sha256 },
      restored: { exitCode: confirmacao.exitCode, log: logConfirmacao.rel, logSha256: logConfirmacao.sha256 },
      capturedAt: new Date().toISOString(),
    },
  };
}

function main() {
  const registro = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const mutacoes = (registro.mutations || []).filter((m) => ONLY.length === 0 || ONLY.includes(m.defectId));
  if (mutacoes.length === 0) {
    process.stderr.write('[prova-negativa] nenhuma mutação selecionada\n');
    return 2;
  }

  const porDefeito = new Map();
  const resultados = [];
  for (const mutacao of mutacoes) {
    const r = provar(mutacao);
    resultados.push({ defectId: mutacao.defectId, control: mutacao.control, ...r });
    if (r.ok) {
      const lista = porDefeito.get(mutacao.defectId) || [];
      lista.push(r.evidencia);
      porDefeito.set(mutacao.defectId, lista);
    }
  }

  const relatorio = {
    kind: 'prova-negativa',
    generatedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    mutacoes: mutacoes.length,
    provados: [...porDefeito.keys()],
    bloqueados: resultados.filter((r) => !r.ok).map((r) => ({ defectId: r.defectId, code: r.code, detail: r.detail })),
    evidencias: Object.fromEntries(porDefeito),
    resultados,
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`);

  if (flag('--json')) process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`);
  else {
    for (const r of resultados) {
      process.stdout.write(`[prova-negativa] ${r.defectId} ${r.ok ? 'PROVADO' : `BLOQUEADO(${r.code})`} — ${r.control}\n`);
    }
    process.stdout.write(`[prova-negativa] provados=${relatorio.provados.length} bloqueados=${relatorio.bloqueados.length} relatório=${path.relative(ROOT, RELATORIO)}\n`);
  }
  return relatorio.bloqueados.length === 0 ? 0 : 1;
}

process.exitCode = main();
