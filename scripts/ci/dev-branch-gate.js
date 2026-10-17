#!/usr/bin/env node
'use strict';

/**
 * Gate L0+L1 da branch de desenvolvimento auditável (`dev/engineering-hardening`).
 *
 * POR QUE EXISTE
 * --------------
 * DEFEITO MEDIDO (2026-10-16): nenhum workflow do repositório dispara para
 * `dev/engineering-hardening` (`jest.yml` e `release-governance.yml` listam apenas
 * `main`, `develop`, `release/**`, `hotfix/**`), e a medição confirma zero
 * execuções para a branch:
 *
 *     gh run list --branch dev/engineering-hardening   ->   []
 *
 * Isto é: todo checkpoint publicado na branch de auditoria incremental chegava ao
 * GitHub sem nenhuma verificação automática.
 *
 * ESTADO REAL DO RUNNER (medido, não suposto)
 * -------------------------------------------
 * Mesmo para `main`, os jobs NÃO INICIAM por limite de gastos da conta:
 *
 *     gh run view 38881780959  ->
 *     "The job was not started because an Actions budget is preventing further use."
 *
 * Um workflow que não roda não é gate — e adicioná-lo sem mais nada daria falsa
 * sensação de proteção. Por isso a proteção EFETIVA é este runner LOCAL, que roda
 * exatamente os mesmos passos que o workflow `.github/workflows/dev-branch-ci.yml`
 * executa quando o runner voltar, e publica a mesma evidência estruturada.
 *
 * O QUE ESTE RUNNER PRODUZ
 * ------------------------
 *  - o SHA EXATO avaliado (`git rev-parse HEAD`), com refusal se a opção
 *    `--espera-sha`/`DEV_BRANCH_GATE_ESPERA_SHA` não corresponder;
 *  - por passo: comando, exit code, duração e sha256 da saída;
 *  - `reports/dev-branch-ci-evidence.json` (máquina, .gitignore) e
 *    `AI_MEMORY/evidence/dev-branch-ci-<sha-curto>.md` (versionado, auditoria);
 *  - exit 1 se QUALQUER passo obrigatório falhar (nunca converte falha em
 *    narrativa de sucesso).
 *
 * O QUE ESTE RUNNER NUNCA FAZ
 * ---------------------------
 *  - não publica release, não cria tag, não faz push, não faz deploy;
 *  - não lê segredo algum e não imprime variável de ambiente;
 *  - não altera artefato governado (só leitura + os dois relatórios acima).
 *
 * Uso:
 *   node scripts/ci/dev-branch-gate.js [--out <json>] [--espera-sha <sha>]
 *                                      [--rapido]   (pula a suíte L0)
 */

const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Passos OBRIGATÓRIOS do gate.
 *
 * L0 = suíte oficial de testes (o que o `jest.yml` roda no CI).
 * L1 = gates de governança que não dependem de infraestrutura viva (Postgres,
 *      Redis, browser) e que decidem sobre o estado REAL medido em disco.
 *
 * A ordem importa: primeiro o que quebra por código, depois o que quebra por
 * governança — assim o primeiro erro exibido é o mais acionável.
 */
const PASSOS = [
  {
    id: 'L0-suite-oficial',
    nivel: 'L0',
    comando: 'npm test',
    descricao: 'Suíte oficial Jest (unit + flow + rpa sem browser)',
    orcamentoMs: 20 * 60 * 1000,
  },
  {
    id: 'L1-cadeia-criptografica',
    nivel: 'L1',
    comando: 'node scripts/governance/validate-governance-chain.js',
    descricao: 'Cadeia de governança RECALCULADA dos bytes atuais (e declaração auditável)',
    orcamentoMs: 120 * 1000,
  },
  {
    id: 'L1-self-proving',
    nivel: 'L1',
    comando: 'node scripts/governance/validate-self-proving.js',
    descricao: 'Self-proving sobre a cadeia recalculada',
    orcamentoMs: 120 * 1000,
  },
  {
    id: 'L1-release-dag',
    nivel: 'L1',
    comando: 'node scripts/governance/validate-release-dag.js',
    descricao: 'DAG do release sem ciclo e sem violação de ordem de fase',
    orcamentoMs: 120 * 1000,
  },
  {
    id: 'L1-decisao-canonica',
    nivel: 'L1',
    comando: 'node scripts/governance/assert-canonical-release-decision.js',
    descricao: 'Decisão canônica de release (autoridade única) coerente com os artefatos',
    orcamentoMs: 120 * 1000,
  },
  {
    id: 'L1-fila-oficial',
    nivel: 'L1',
    comando: 'node scripts/governance/validate-hardening-queue.js',
    descricao: 'Fila oficial de hardening sem item aberto nem estado não canônico',
    orcamentoMs: 60 * 1000,
  },
  {
    id: 'L1-ai-memory',
    nivel: 'L1',
    comando: 'node scripts/governance/validate-ai-memory.js',
    descricao: 'Memória operacional íntegra',
    orcamentoMs: 60 * 1000,
  },
  {
    id: 'L1-aderencia-agente',
    nivel: 'L1',
    comando: 'node scripts/governance/validate-agent-adherence.js',
    descricao: 'Aderência do agente à Constituição',
    orcamentoMs: 60 * 1000,
  },
];

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function executar(passo) {
  const inicio = Date.now();
  const r = spawnSync(passo.comando, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: passo.orcamentoMs,
  });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  return {
    id: passo.id,
    nivel: passo.nivel,
    descricao: passo.descricao,
    comando: passo.comando,
    exitCode: r.status === null ? null : r.status,
    timeout: r.status === null,
    duracaoMs: Date.now() - inicio,
    sha256Saida: sha256(saida),
    // Só o fim da saída: o suficiente para diagnosticar sem inflar a evidência.
    saidaFinal: saida.trim().split('\n').slice(-12).join('\n'),
  };
}

/**
 * Sonda o estado do runner do GitHub. BEST-EFFORT de propósito: nenhuma decisão
 * de pass/fail depende dela (o gate é o resultado dos passos). O que ela impede é
 * afirmar "CI ativo" enquanto a conta está bloqueada.
 */
function sondarRunnerDoGithub(branch) {
  const r = spawnSync(
    `gh run list --branch ${branch} --limit 1 --json databaseId,conclusion,headSha,createdAt`,
    { cwd: ROOT, encoding: 'utf8', shell: true, timeout: 45 * 1000 }
  );
  if (r.status !== 0) {
    return {
      medido: false,
      motivo: 'gh indisponivel ou sem autenticacao nesta execucao',
      observado: (r.stderr || '').trim().split('\n').slice(-2).join(' ').slice(0, 200),
    };
  }
  let lista;
  try {
    lista = JSON.parse(r.stdout || '[]');
  } catch (_) {
    return { medido: false, motivo: 'saida do gh nao parseavel' };
  }
  if (!Array.isArray(lista) || lista.length === 0) {
    return { medido: true, execucoesNaBranch: 0, conclusao: 'NENHUMA_EXECUCAO' };
  }
  return {
    medido: true,
    execucoesNaBranch: lista.length,
    ultimaExecucao: {
      databaseId: lista[0].databaseId,
      headSha: lista[0].headSha,
      conclusao: lista[0].conclusion,
      criadaEm: lista[0].createdAt,
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const argDe = (nome, curto) => {
    const i = argv.findIndex((a) => a === nome || (curto && a === curto));
    return i >= 0 ? argv[i + 1] : null;
  };
  const rapido = argv.includes('--rapido');
  const esperaSha = argDe('--espera-sha') || process.env.DEV_BRANCH_GATE_ESPERA_SHA || null;
  const outJson = argDe('--out') || 'reports/dev-branch-ci-evidence.json';

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = git(['rev-parse', 'HEAD']);

  if (esperaSha && esperaSha !== sha) {
    process.stderr.write(
      `[dev-branch-gate] RECUSADO: HEAD=${sha} mas a execucao EXIGE ${esperaSha} — ` +
      'a evidencia seria vinculada ao commit errado.\n'
    );
    return 1;
  }

  const passos = rapido ? PASSOS.filter((p) => p.nivel !== 'L0') : PASSOS;

  process.stdout.write(`[dev-branch-gate] branch=${branch} sha=${sha}\n`);
  process.stdout.write(`[dev-branch-gate] executando ${passos.length} passo(s)\n`);

  const resultados = passos.map((passo) => {
    const r = executar(passo);
    process.stdout.write(
      `[dev-branch-gate]   ${r.id.padEnd(26)} exit=${r.exitCode} ${(r.duracaoMs / 1000).toFixed(1)}s\n`
    );
    return r;
  });

  const falhas = resultados.filter((r) => r.exitCode !== 0);
  const runner = sondarRunnerDoGithub(branch);
  const veredito = falhas.length === 0 ? 'PASS' : 'FAIL';

  const semSaidaFinal = (r) => ({
    id: r.id, nivel: r.nivel, descricao: r.descricao, comando: r.comando,
    exitCode: r.exitCode, timeout: r.timeout, duracaoMs: r.duracaoMs,
    sha256Saida: r.sha256Saida, saidaFinal: r.saidaFinal,
  });

  const nucleo = {
    schemaVersion: 1,
    kind: 'dev-branch-ci-evidence',
    comando: 'node scripts/ci/dev-branch-gate.js',
    veredito,
    sha,
    shaCurto: sha.slice(0, 12),
    branch,
    runnerDoGithub: runner,
    gateEfetivo: 'LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)',
    passos: resultados.map(semSaidaFinal),
    falhas: falhas.map((f) => ({ id: f.id, comando: f.comando, exitCode: f.exitCode })),
  };

  const evidencia = { ...nucleo, evidenceSha256: sha256(JSON.stringify(nucleo)) };

  const outJsonAbs = path.join(ROOT, outJson);
  fs.mkdirSync(path.dirname(outJsonAbs), { recursive: true });
  fs.writeFileSync(outJsonAbs, `${JSON.stringify(evidencia, null, 2)}\n`, 'utf8');

  // Evidência versionada (auditoria externa lê o git): Markdown com o payload
  // JSON embutido em bloco cercado — `.json` solto em AI_MEMORY/evidence/ é
  // reprovado pelo audit:json-persistence (alvo fora da taxonomia canônica).
  const mdRel = `AI_MEMORY/evidence/dev-branch-ci-${nucleo.shaCurto}.md`;
  const linhas = [
    `# Gate L0+L1 da branch de desenvolvimento — ${nucleo.shaCurto}`,
    '',
    `- **veredito**: \`${veredito}\``,
    `- **branch**: \`${branch}\``,
    `- **sha exato avaliado**: \`${sha}\``,
    `- **gerado em**: ${new Date().toISOString()}`,
    `- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta`,
    '',
    '## Passos executados (comando, exit code, duração, sha256 da saída)',
    '',
    '| nível | passo | comando | exit | duração | sha256 da saída |',
    '|---|---|---|---|---|---|',
    ...resultados.map((r) =>
      `| ${r.nivel} | \`${r.id}\` | \`${r.comando}\` | ${r.exitCode} | ${(r.duracaoMs / 1000).toFixed(1)}s | \`${r.sha256Saida.slice(0, 16)}…\` |`),
    '',
    '## Estado do runner do GitHub (medido)',
    '',
    '```json',
    JSON.stringify(runner, null, 2),
    '```',
    '',
    '## Como reconferir a evidência',
    '',
    '```bash',
    `node scripts/ci/dev-branch-gate.js            # reexecuta e recompara o exit code de cada passo`,
    `git log -1 --format=%H -- ${mdRel}   # commit que publicou esta evidência`,
    '```',
    '',
    `\`evidenceSha256\` = \`${evidencia.evidenceSha256}\` (sha256 do payload sem este campo).`,
    '',
    '```json',
    JSON.stringify(nucleo, null, 2),
    '```',
    '',
  ];
  fs.writeFileSync(path.join(ROOT, mdRel), linhas.join('\n'), 'utf8');

  process.stdout.write(`[dev-branch-gate] veredito=${veredito} falhas=${falhas.length}\n`);
  process.stdout.write(`[dev-branch-gate] json=${outJson} md=${mdRel}\n`);

  return veredito === 'PASS' ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, PASSOS };
