'use strict';

/**
 * ERV1-CLOSE-001 — command injection real no Test Runner.
 *
 * O Test Runner aceitava `command` como STRING e executava via `spawn(command, {shell:true})`.
 * A allowlist de `commandPolicy.js` era baseada em `startsWith()` + uma blocklist de padrões
 * específicos (ex.: `&&\s*rm`) — não é fronteira de segurança: qualquer metacaractere de shell
 * que NÃO combine com um padrão da blocklist passa direto. `npm test; touch /tmp/x` começa com
 * "npm test" (allowlist OK) e não contém nenhum padrão perigoso listado (nenhum tem `rm` depois
 * do `;`) — o `touch` real executa.
 *
 * Este teste prova a exploração de ponta a ponta (não só a policy estática): roda o
 * `testRunnerService.runTestCommands` real, com um comando de injeção real, e confirma que o
 * efeito colateral (arquivo marcador) NÃO foi criado no filesystem real.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runTestCommands } = require('../../api/services/engineeringRouter/testRunnerService');

function makeMarkerPath() {
  return path.join(os.tmpdir(), `erv1-close-001-pwned-${crypto.randomBytes(6).toString('hex')}.marker`);
}

describe('ERV1-CLOSE-001 — execução arbitrária de shell (command injection real)', () => {
  let workspace;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'erv1-close-001-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const INJECTION_PAYLOADS = [
    { name: 'semicolon', command: (marker) => `git status; touch ${marker}` },
    { name: 'and-and', command: (marker) => `git status && touch ${marker}` },
    { name: 'or-or', command: (marker) => `git status:this-fails-on-purpose || touch ${marker}` },
    { name: 'command-substitution-dollar', command: (marker) => `git status $(touch ${marker})` },
    { name: 'command-substitution-backtick', command: (marker) => `git status \`touch ${marker}\`` },
    { name: 'pipe-to-shell', command: (marker) => `echo touch ${marker} | sh` },
    { name: 'output-redirection', command: (marker) => `git status > ${marker}` },
  ];

  for (const payload of INJECTION_PAYLOADS) {
    test(`REJECTED ou sem efeito colateral real: ${payload.name}`, async () => {
      const marker = makeMarkerPath();
      const command = payload.command(marker);

      const { results } = await runTestCommands({
        taskId: 'erv1-close-001-sec',
        attemptNumber: 1,
        commands: [command],
        cwd: workspace,
      });

      const markerExists = fs.existsSync(marker);
      if (markerExists) fs.rmSync(marker, { force: true });

      // A prova real de segurança é o efeito colateral no filesystem, não o status
      // reportado — um comando pode ser REJECTED pela policy mas ainda ter sido
      // parcialmente executado antes da rejeição (não é o caso aqui, mas o teste teria que
      // provar isso de qualquer forma).
      expect(markerExists).toBe(false);
      expect(results[0].status).not.toBe('PASS');
    });
  }

  test('npm test continua executando normalmente (allowlist não pode virar deny-all)', async () => {
    // Comando real e inofensivo dentro da allowlist — sem workspace jest de verdade aqui,
    // então usamos git status (também permitido) para confirmar que o Test Runner ainda
    // executa comandos legítimos depois da correção.
    const { results } = await runTestCommands({
      taskId: 'erv1-close-001-sanity',
      attemptNumber: 1,
      commands: ['git status'],
      cwd: workspace,
    });

    expect(results[0].status).not.toBe('REJECTED');
  });
});
