'use strict';

/**
 * Regularização de fechamentos históricos + provisionamento de âncoras (2026-10-22).
 *
 * Estes testes travam o que os scripts NÃO podem fazer, porque é aí que mora o risco:
 *   - regularizar não pode inventar prova para item sem teste;
 *   - regularizar não pode assinar nem alterar a fila;
 *   - âncora não pode ser gravada dentro do repositório (deixaria de ser âncora);
 *   - `--check` sem âncoras tem de falhar fechado.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const { testeCitado, testeDaEvidencia } = require('../../../scripts/governance/regularize-bug-closures');
const {
  fingerprintDaChavePem, digestDoInventario,
} = require('../../../governance/bug-closure/trusted-authorities');

function rodar(script, args, env = {}) {
  const r = { status: 0, stdout: '', stderr: '' };
  try {
    r.stdout = execFileSync('node', [script, ...args], {
      cwd: RAIZ, encoding: 'utf8', stdio: 'pipe', timeout: 120000, env: { ...process.env, ...env },
    });
  } catch (e) {
    r.status = e.status;
    r.stdout = String(e.stdout || '');
    r.stderr = String(e.stderr || '');
  }
  return r;
}

describe('regularização — seleção de teste citado', () => {
  test('item sem teste citado cai em decisão humana (não inventa prova)', () => {
    expect(testeCitado({ id: 'X', evidence: 'verificado manualmente' })).toBeNull();
  });

  test('prosa com espaços não é tratada como caminho de teste', () => {
    expect(testeCitado({ regressionTest: 'teste negativo de proveniência do Security Gate' })).toBeNull();
  });

  test('caminho de teste inexistente é descartado', () => {
    expect(testeCitado({ regressionTest: 'tests/unit/governance/nao-existe-mesmo.test.js' })).toBeNull();
  });

  test('caminho existente é aceito (campo canônico)', () => {
    const rel = 'tests/unit/governance/bugClosureBypassDefense.test.js';
    expect(testeCitado({ regressionTest: rel })).toBe(rel);
  });

  test('alias legado `test` também é aceito', () => {
    const rel = 'tests/unit/governance/engineerSupervisedReadinessGate.test.js';
    expect(testeCitado({ test: rel })).toBe(rel);
  });

  test('lista de testes escolhe o primeiro que existe', () => {
    const rel = 'tests/unit/governance/engineerSupervisedReadinessGate.test.js';
    expect(testeCitado({ regressionTests: ['nope.test.js', rel] })).toBe(rel);
  });
});

describe('regularização — teste declarado na EVIDÊNCIA do próprio item', () => {
  test('extrai o caminho de teste citado no texto da evidência', () => {
    const item = {
      id: 'X',
      evidence: 'tests/integration/engineeringRouterConcurrentRunHttp.test.js 10/10 execuções exit 0 após o fix',
    };
    expect(testeDaEvidencia(item)).toBe('tests/integration/engineeringRouterConcurrentRunHttp.test.js');
  });

  test('ignora caminho citado que não existe no repositório', () => {
    expect(testeDaEvidencia({ evidence: 'rodou tests/unit/nao-existe-mesmo.test.js e passou' })).toBeNull();
  });

  test('prefere a suíte sob tests/ quando há mais de um caminho citado', () => {
    const item = {
      evidence: 'frontend/src/__tests__/supportHeaderEnhancement.test.js e '
        + 'tests/unit/governance/worktreeIntegrity.test.js rodaram verdes',
    };
    expect(testeDaEvidencia(item)).toBe('tests/unit/governance/worktreeIntegrity.test.js');
  });

  test('testeCitado usa a evidência quando o campo dedicado está vazio', () => {
    const item = { id: 'Y', evidence: 'verde em tests/unit/governance/worktreeIntegrity.test.js' };
    expect(testeCitado(item)).toBe('tests/unit/governance/worktreeIntegrity.test.js');
  });

  test('campo dedicado tem precedência sobre a evidência', () => {
    const item = {
      regressionTest: 'tests/unit/governance/bugClosureBypassDefense.test.js',
      evidence: 'também citou tests/unit/governance/worktreeIntegrity.test.js',
    };
    expect(testeCitado(item)).toBe('tests/unit/governance/bugClosureBypassDefense.test.js');
  });
});

describe('regularização — efeito colateral proibido', () => {
  test('o script não escreve na fila oficial (filaAlterada=NÃO no relatório)', () => {
    const antes = fs.readFileSync(path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json'));
    const r = rodar('scripts/governance/regularize-bug-closures.js', ['--dry-run', '--only', 'P3', '--limit', '1', '--json']);
    const depois = fs.readFileSync(path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json'));
    expect(depois.equals(antes)).toBe(true);
    if (r.stdout.trim().startsWith('{')) {
      const rel = JSON.parse(r.stdout);
      expect(rel.resumo.filaAlterada).toBe(false);
      expect(rel.resumo.assinatura).toMatch(/PENDENTE/);
      expect(rel.authoritative).toBe(false);
    }
  }, 180000);
});

describe('âncoras — provisionamento não pode virar âncora versionada', () => {
  test('fingerprintDaChavePem deriva 64 hex de chave válida e recusa lixo', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const fp = fingerprintDaChavePem(publicKey.export({ type: 'spki', format: 'pem' }));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintDaChavePem('não é pem')).toBeNull();
  });

  test('--out dentro do repositório é RECUSADO', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chave-'));
    const chave = path.join(dir, 'pub.pem');
    fs.writeFileSync(chave, crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    const r = rodar('scripts/governance/provision-closure-anchors.js', ['--key', chave, '--out', path.join(RAIZ, 'ancoras.env')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/RECUSADO/);
    expect(fs.existsSync(path.join(RAIZ, 'ancoras.env'))).toBe(false);
  }, 120000);

  test('--out fora do workspace é gravado com modo 600', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chave2-'));
    const chave = path.join(dir, 'pub.pem');
    fs.writeFileSync(chave, crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    const destino = path.join(dir, 'anchors.env');
    const r = rodar('scripts/governance/provision-closure-anchors.js', ['--key', chave, '--out', destino]);
    expect(r.status).toBe(0);
    expect(fs.statSync(destino).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(destino, 'utf8')).toMatch(/RAP_CLOSURE_INVENTORY_SHA256=[0-9a-f]{64}/);
  }, 120000);

  test('--check sem âncoras falha fechado e nomeia as três', () => {
    const env = { ...process.env };
    delete env.RAP_CLOSURE_TRUST_ANCHOR_SHA256;
    delete env.RAP_APPROVAL_TRUST_ANCHOR_SHA256;
    delete env.RAP_CLOSURE_INVENTORY_SHA256;
    const r = { status: 0, stdout: '' };
    try {
      r.stdout = execFileSync('node', ['scripts/governance/provision-closure-anchors.js', '--check'], {
        cwd: RAIZ, encoding: 'utf8', stdio: 'pipe', env,
      });
    } catch (e) { r.status = e.status; r.stdout = String(e.stdout || ''); }
    expect(r.status).toBe(1);
    const rel = JSON.parse(r.stdout);
    expect(rel.ok).toBe(false);
    expect(rel.achados.join(' ')).toMatch(/RAP_CLOSURE_TRUST_ANCHOR_SHA256/);
    expect(rel.achados.join(' ')).toMatch(/RAP_APPROVAL_TRUST_ANCHOR_SHA256/);
    expect(rel.achados.join(' ')).toMatch(/RAP_CLOSURE_INVENTORY_SHA256/);
  }, 120000);

  test('--check com inventário de digest ANTIGO acusa divergência (fila mudou)', () => {
    const digestErrado = digestDoInventario([{ id: 'X', severity: 'P1', state: 'OPEN' }]);
    const chave = 'a'.repeat(64);
    const r = rodar('scripts/governance/provision-closure-anchors.js', ['--check'], {
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: chave,
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: chave,
      RAP_CLOSURE_INVENTORY_SHA256: digestErrado,
    });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).achados.join(' ')).toMatch(/a fila mudou desde o provisionamento/);
  }, 120000);
});
