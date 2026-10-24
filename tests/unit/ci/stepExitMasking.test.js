'use strict';

/**
 * FASE 3 / MISSÃO E-F — O STATUS DE UM PASSO NÃO PODE SER O DA ÚLTIMA LINHA.
 *
 * DEFEITO MEDIDO (CI 2026-10-24, run 40105995013 e reexecução):
 *   `L0-suite-oficial` reprovou com
 *     `tests/unit/governance/releaseAnchorsPreflightBlocking.test.js:128`
 *     `Expected: not 0` — o passo "Preflight das âncoras" devolveu exit 0 com âncora AUSENTE.
 *
 * Causa: no runner `$GITHUB_OUTPUT` e `$RUNNER_TEMP` existem, então
 *     node provision-closure-anchors.js --check | tee ...
 *     echo "anchor_preflight=ok" >> "$GITHUB_OUTPUT"
 * terminava com um `echo` bem-sucedido. Sem `set -e` o status do PASSO é o da última linha —
 * `pipefail` sozinho não salva — e o job ficava verde com a âncora ausente (`release-gate` poderia
 * declarar "Release autorizado" sem âncora de confiança).
 *
 * O teste do defeito passava na máquina de desenvolvimento por ACIDENTE DE AMBIENTE: sem
 * `$GITHUB_OUTPUT`/`$RUNNER_TEMP` o próprio `echo` falhava e a asserção era satisfeita pelo motivo
 * errado. Por isso aqui a verificação é ESTRUTURAL sobre o YAML e não depende de ambiente.
 *
 * REGRA TRAVADA: todo passo `run:` com 2+ comandos nos jobs certificantes precisa de errexit — via
 * `set -e*`/`-o errexit` no script, `shell:` explícito, ou `defaults.run.shell` do job.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const RAIZ = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = path.join(RAIZ, '.github', 'workflows');

const JOBS_CERTIFICANTES = {
  'release-governance.yml': ['governance-core', 'governance-regression', 'anchors-attestation', 'release-gate'],
  'dev-branch-ci.yml': ['dev-branch-gate'],
};

const carregar = (arquivo) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, arquivo), 'utf8'));

const comandos = (run) => String(run)
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'));

/**
 * O `run:` é lido SEM comentários. Comentário que CITA `set -e` — exatamente o que este arquivo e os
 * dois passos de preflight fazem, ao explicar o defeito — não é diretiva. Se ele satisfizesse a
 * checagem, remover o `set -euo pipefail` real passaria despercebido: regressão que só existe no
 * papel. Medido em revisão independente (2026-10-24): a versão anterior deste helper devolvia `true`
 * para os dois passos com a diretiva removida do script.
 */
const semComentarios = (run) => String(run)
  .split('\n')
  .map((l) => l.replace(/\s+#.*$/, ''))
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

const DIRETIVA_ERREXIT = /^\s*set\s+-[a-z]*e[a-z]*\b|^\s*set\s+-o\s+errexit\b/m;
const temErrexitNoScript = (run) => DIRETIVA_ERREXIT.test(semComentarios(run));
const shellTemErrexit = (shell) => /(^|\s)-[a-z]*e[a-z]*(\s|$)|errexit/.test(String(shell || ''));

function passoProtegido(passo, job) {
  if (temErrexitNoScript(passo.run)) return true;
  if (shellTemErrexit(passo.shell)) return true;
  const shellDoJob = job.defaults && job.defaults.run && job.defaults.run.shell;
  return shellTemErrexit(shellDoJob);
}

describe('status de passo multi-comando não pode ser mascarado pela última linha', () => {
  for (const [arquivo, jobs] of Object.entries(JOBS_CERTIFICANTES)) {
    test(`${arquivo}: todo passo multi-comando dos jobs certificantes tem errexit`, () => {
      const wf = carregar(arquivo);
      const desprotegidos = [];
      for (const nomeJob of jobs) {
        const job = wf.jobs[nomeJob];
        expect(job).toBeTruthy();
        (job.steps || []).forEach((passo, i) => {
          if (!passo.run) return;
          if (comandos(passo.run).length < 2) return;
          if (passoProtegido(passo, job)) return;
          desprotegidos.push(`${nomeJob}[${i}] ${passo.name || '(sem nome)'}`);
        });
      }
      expect(desprotegidos).toEqual([]);
    });
  }

  test('o preflight de âncoras declara errexit no próprio script (defeito original)', () => {
    const wf = carregar('release-governance.yml');
    for (const nomeJob of ['governance-core', 'anchors-attestation']) {
      const passo = (wf.jobs[nomeJob].steps || []).find((p) => /Preflight/i.test(String(p.name || '')));
      expect(passo).toBeTruthy();
      expect(temErrexitNoScript(passo.run)).toBe(true);
      expect(passo['continue-on-error']).toBeUndefined();

      // NÃO VACUIDADE: remover a diretiva real, mantendo os comentários que citam `set -e`, tem de
      // fazer a checagem REPROVAR. Sem esta prova, apagar o `set -euo pipefail` passaria despercebido.
      const semDiretiva = String(passo.run).replace(/^\s*set\s+-euo\s+pipefail\s*$/m, '');
      expect(semDiretiva).not.toBe(String(passo.run));
      expect(temErrexitNoScript(semDiretiva)).toBe(false);
    }
  });

  /**
   * MECANISMO REAL, com as duas semânticas de shell do runner — docs oficiais: "By default, fail-fast
   * behavior is enforced using `set -e` for both `sh` and `bash`. When `shell: bash` is specified,
   * `-o pipefail` is also applied".
   *
   * Consequência que fecha o caso do preflight: o shell PADRÃO já tem `-e`, mas NÃO tem `pipefail` —
   * logo `node ... --check | tee ...` era mascarado (o status do pipe é o do `tee`) e o `-e` do
   * default não salvava nada. `shell: bash` (o que o `defaults.run.shell` fixa) acrescenta `pipefail`
   * e é o que de fato reprova. Um teste que só provasse "a última linha bem-sucedida não salva"
   * perderia esse mecanismo; este o executa nas duas formas.
   */
  test('shell PADRÃO (`bash -e`, sem pipefail) mascara pipe; `shell: bash` (-eo pipefail) não', () => {
    const { execFileSync } = require('child_process');
    const executar = (args, script) => {
      try {
        execFileSync('bash', [...args, '-c', script], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
        return 0;
      } catch (e) {
        return typeof e.status === 'number' ? e.status : 1;
      }
    };
    const script = 'node -e "process.exit(1)" | tee /dev/null; echo fim';
    expect(executar(['--noprofile', '--norc', '-e'], script)).toBe(0);
    expect(executar(['--noprofile', '--norc', '-eo', 'pipefail'], script)).not.toBe(0);
  });

  test('a regra de errexit é comportamental: último comando bem-sucedido não salva o passo', () => {
    const { execFileSync } = require('child_process');
    const executar = (script) => {
      try {
        execFileSync('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
        return 0;
      } catch (e) {
        return typeof e.status === 'number' ? e.status : 1;
      }
    };
    const corpo = 'node -e "process.exit(1)" | tee /dev/null\necho fim';
    expect(executar(`set -o pipefail\n${corpo}`)).toBe(0);
    expect(executar(`set -euo pipefail\n${corpo}`)).not.toBe(0);
  });
});
