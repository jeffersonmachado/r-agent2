'use strict';

/**
 * Diagnóstico auditável dos passos do selo V2 (`engineering-router-v2-seal.js`).
 *
 * DEFEITO REAL medido em 2026-10-14: o passo obrigatório `V1_RUNTIME_EVIDENCE`
 * saiu `exit=1` e o relatório (`reports/engineering-router-v2-seal-execution.json`)
 * registrou `stderrTail: ""` — porque o coletor de evidência de runtime escreve o
 * motivo em STDOUT. O ciclo de ~40 min abortou sem causa aparente e só a
 * reprodução manual do passo revelou que a falha era transitória (na segunda
 * execução passou). Passo obrigatório que falha SEM MOTIVO no relatório é falha
 * de governança: torna a falha inauditável e força diagnóstico por tentativa.
 *
 * O teste exercita o MESMO `runStep` que o selo usa (exportado para isto), com
 * scripts temporários — nenhum passo real do selo é executado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runStep,
  SEAL_STATUS,
  STEPS,
} = require('../../../scripts/governance/engineering-router-v2-seal');

function comScript(conteudo, fn) {
  const arquivo = path.join(os.tmpdir(), `v2seal-diag-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(arquivo, conteudo);
  try {
    return fn(arquivo);
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
}

describe('selo V2 — passo que falha deixa o MOTIVO no relatório', () => {
  it('falha reportada em STDOUT aparece em stdoutTail (o caso medido em 2026-10-14)', () => {
    comScript(
      "process.stdout.write('MOTIVO_NO_STDOUT: runner offline\\n'); process.exit(1);\n",
      (arquivo) => {
        const r = runStep({ id: 'FAKE_STDOUT', kind: 'command', command: `node ${arquivo}` });
        expect(r.status).toBe(SEAL_STATUS.FAIL);
        expect(r.detail).toContain('exit=1');
        // O que faltava: o motivo precisa sobreviver no relatório.
        expect(r.stdoutTail).toContain('MOTIVO_NO_STDOUT');
        // E o campo antigo segue existindo (contrato não quebrado).
        expect(r).toHaveProperty('stderrTail');
      },
    );
  });

  it('falha reportada em STDERR continua capturada em stderrTail', () => {
    comScript(
      "process.stderr.write('MOTIVO_NO_STDERR: banco indisponivel\\n'); process.exit(2);\n",
      (arquivo) => {
        const r = runStep({ id: 'FAKE_STDERR', kind: 'command', command: `node ${arquivo}` });
        expect(r.status).toBe(SEAL_STATUS.FAIL);
        expect(r.detail).toContain('exit=2');
        expect(r.stderrTail).toContain('MOTIVO_NO_STDERR');
      },
    );
  });

  it('passo que passa NÃO carrega stdoutTail (o relatório não incha com o QA Mesh)', () => {
    comScript("process.stdout.write('muita saida irrelevante\\n');\n", (arquivo) => {
      const r = runStep({ id: 'FAKE_OK', kind: 'command', command: `node ${arquivo}` });
      expect(r.status).toBe(SEAL_STATUS.PASS);
      expect(r.detail).toBe('exit=0');
      expect(r.stdoutTail).toBeUndefined();
    });
  });

  it('o passo obrigatório que falhou sem motivo é um passo real do selo (V1_RUNTIME_EVIDENCE)', () => {
    const passo = STEPS.find((s) => s.id === 'V1_RUNTIME_EVIDENCE');
    expect(passo).toBeDefined();
    expect(passo.required).toBe(true);
    expect(passo.command).toContain('collect-engineering-router-runtime-evidence');
  });
});
