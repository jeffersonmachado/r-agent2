'use strict';

/**
 * Sandbox: o workspace precisa ser LEGÍVEL **e GRAVÁVEL** pelo UID fixo do container.
 *
 * Achado real medido em 2026-10-09 (missão `brace-expansion`): `ensureWorkspaceReadableBySandbox`
 * concedia apenas leitura (`go+rX`) embora o docstring afirmasse "legível/gravável". Comandos de
 * teste que gravam dentro do workspace — `engine/__tests__/functionalFlows.test.js` cria
 * `replays/simulation` — falhavam com
 * `EACCES: permission denied, mkdir '<workspace>/replays/simulation'`, e `npm run test:flow`
 * ficava vermelho NO WORKSPACE enquanto a mesma árvore fora do sandbox passava 264/264.
 *
 * Estes testes fixam o contrato: escrita concedida ao UID do sandbox (nunca a "others"), sem
 * alterar o bit de execução do dono (único rastreado pelo git).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  ensureWorkspaceReadableBySandbox,
  ensureWorkspaceWritableBySandbox,
  SANDBOX_UID_GID,
} = require('../../../api/services/engineeringRouter/executionSandbox');

/** Cria um workspace efêmero mínimo (diretório + arquivo + subdiretório). */
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-perm-'));
  fs.writeFileSync(path.join(dir, 'arquivo.txt'), 'conteudo');
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'api', 'config.json'), '{}');
  fs.chmodSync(dir, 0o700);
  return dir;
}

function aclDe(caminho, uid) {
  const saida = execFileSync('getfacl', ['-p', caminho], { encoding: 'utf8' });
  return saida.split('\n').find((linha) => linha.startsWith(`user:${uid}:`)) || null;
}

const temSetfacl = (() => {
  try {
    execFileSync('setfacl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('executionSandbox — permissões do workspace para o UID do sandbox', () => {
  it('concede LEITURA (comportamento anterior, preservado)', () => {
    const dir = workspace();
    fs.chmodSync(path.join(dir, 'api'), 0o700);
    ensureWorkspaceReadableBySandbox(dir);
    const modo = fs.statSync(path.join(dir, 'api')).mode & 0o777;
    expect(modo & 0o055).toBe(0o055); // group/others r-x
  });

  it('concede ESCRITA ao UID do sandbox (o que faltava: mkdir em subdiretório)', () => {
    const dir = workspace();
    const { mechanism, uid } = ensureWorkspaceWritableBySandbox(dir);
    expect(uid).toBe(SANDBOX_UID_GID.split(':')[0]);
    expect(['acl', 'chmod']).toContain(mechanism);

    if (mechanism === 'acl') {
      // ACL exata no diretório E no arquivo, sem abrir para "others" além do que já era lido.
      expect(aclDe(dir, uid)).toContain('rwx');
      expect(aclDe(path.join(dir, 'api'), uid)).toContain('rwx');
      expect(aclDe(path.join(dir, 'api', 'config.json'), uid)).toContain('rw');
      // Default ACL: o que o teste criar DEPOIS também nasce gravável — era exatamente o caso
      // que falhava (`replays/simulation` não existia antes da execução).
      const saida = execFileSync('getfacl', ['-p', dir], { encoding: 'utf8' });
      expect(saida).toContain(`default:user:${uid}:rwx`);
    } else {
      const modoDir = fs.statSync(dir).mode & 0o777;
      expect(modoDir & 0o022).toBe(0o022);
    }
  });

  it('NUNCA altera o bit de execução do DONO (git rastreia 100644 vs 100755)', () => {
    const dir = workspace();
    const antes = fs.statSync(path.join(dir, 'arquivo.txt')).mode & 0o777;
    expect(antes & 0o100).toBe(0); // não executável para o dono
    ensureWorkspaceWritableBySandbox(dir);
    const depois = fs.statSync(path.join(dir, 'arquivo.txt')).mode & 0o777;
    expect(depois & 0o100).toBe(0); // continua não executável — tree hash preservado
    expect(fs.statSync(dir).mode & 0o100).toBe(0o100); // diretórios seguem executáveis
  });

  it('não toca node_modules do workspace (é symlink/mount do node_modules real)', () => {
    const dir = workspace();
    const alvo = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-nm-'));
    fs.writeFileSync(path.join(alvo, 'x.txt'), 'x');
    fs.chmodSync(alvo, 0o700);
    fs.symlinkSync(alvo, path.join(dir, 'node_modules'));

    ensureWorkspaceWritableBySandbox(dir);

    const modoAlvo = fs.statSync(alvo).mode & 0o777;
    expect(modoAlvo).toBe(0o700); // intocado
  });

  it('é idempotente (duas execuções não mudam o resultado)', () => {
    const dir = workspace();
    const primeiro = ensureWorkspaceWritableBySandbox(dir);
    const modo1 = fs.statSync(path.join(dir, 'api')).mode & 0o777;
    const segundo = ensureWorkspaceWritableBySandbox(dir);
    const modo2 = fs.statSync(path.join(dir, 'api')).mode & 0o777;
    expect(segundo.mechanism).toBe(primeiro.mechanism);
    expect(modo2).toBe(modo1);
  });
});
