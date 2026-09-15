'use strict';

/**
 * TAREFA 91 — verificação OFFLINE do release entregue, de ponta a ponta.
 *
 * Antes: `tools/system/release-evidence-verify.js` era offline por construção
 * (só fs/path/crypto) e ÓRFÃO — exigia um diretório com `SHA256SUMS` que não
 * existia em lugar nenhum do repositório (`find . -name "SHA256SUMS*"` = vazio) e
 * `RELEASE_EVIDENCE_DIR` só aparecia dentro do próprio verificador. Sem produtor
 * do contrato de entrada, "verificar offline" era impossível.
 *
 * Agora: `scripts/release/release-evidence-bundle.js` produz o bundle (hashes
 * DECLARADOS no manifesto do envelope — não recalculados do que se vai verificar,
 * o que seria circular) e este teste prova os DOIS lados:
 *   - bundle íntegro → verificação PASS (exit 0);
 *   - 1 byte adulterado → verificação FAIL com `mismatch` (exit != 0).
 *
 * A prova negativa usou alteração GARANTIDA (byte +1 mod 256), porque a primeira
 * tentativa (escrever `\x00`) era inconclusiva: o byte já podia ser 0 e o PASS
 * seria correto — falso negativo do teste, não do verificador.
 *
 * PRECONDIÇÃO: exige um release entregue em `dist/release/`. Sem ele o teste é
 * PULADO com aviso explícito (o ciclo de selagem é quem produz o envelope); o
 * gate que bloqueia release é `verify:delivered-release`, no agregado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');
const BUNDLE = path.join(ROOT, 'scripts', 'release', 'release-evidence-bundle.js');
const VERIFIER = path.join(ROOT, 'tools', 'system', 'release-evidence-verify.js');

function runNode(script, args = [], env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    };
  }
}

function deliveredRelease() {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const manifests = fs.readdirSync(RELEASE_DIR).filter((name) => name.endsWith('.manifest.json'));
  return manifests.length > 0 ? manifests[0].replace(/\.manifest\.json$/, '') : null;
}

const release = deliveredRelease();
const describeOrSkip = release ? describe : describe.skip;

if (!release) {
  // Visibilidade: pulo sem aviso é o que transforma gate em enfeite.
  // eslint-disable-next-line no-console
  console.warn('[release-evidence-offline] PULADO: nenhum release entregue em dist/release (rode o ciclo de selagem).');
}

describeOrSkip('verificação offline do release entregue', () => {
  const outDir = path.join(os.tmpdir(), `ragent2-evidence-test-${process.pid}`);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(`${outDir}-tampered`, { recursive: true, force: true });
  });

  it('produz o bundle com SHA256SUMS a partir do declarado e verifica PASS', () => {
    const bundle = runNode(BUNDLE, ['--release', release, '--out', outDir]);
    expect(bundle.code).toBe(0);
    expect(bundle.output).toContain('PASS');
    expect(fs.existsSync(path.join(outDir, 'SHA256SUMS'))).toBe(true);

    const sums = fs.readFileSync(path.join(outDir, 'SHA256SUMS'), 'utf8').trim().split('\n');
    expect(sums.length).toBeGreaterThan(0);

    const verify = runNode(VERIFIER, [], { RELEASE_EVIDENCE_DIR: outDir });
    expect(verify.code).toBe(0);
    expect(verify.output).toContain('PASS');
  }, 300000);

  it('detecta 1 byte adulterado (prova negativa com alteração garantida)', () => {
    const tampered = `${outDir}-tampered`;
    fs.rmSync(tampered, { recursive: true, force: true });
    fs.cpSync(outDir, tampered, { recursive: true });

    const entry = fs.readFileSync(path.join(tampered, 'SHA256SUMS'), 'utf8').trim().split('\n')[0];
    const fileName = entry.split(/\s+/).pop();
    const filePath = path.join(tampered, fileName);

    const original = fs.readFileSync(filePath);
    const offset = Math.min(100, original.length - 1);
    const tamperedBytes = Buffer.from(original);
    tamperedBytes[offset] = (tamperedBytes[offset] + 1) % 256;
    expect(tamperedBytes.equals(original)).toBe(false);
    fs.writeFileSync(filePath, tamperedBytes);

    const verify = runNode(VERIFIER, [], { RELEASE_EVIDENCE_DIR: tampered });
    expect(verify.code).not.toBe(0);
    expect(verify.output).toContain('FAIL');
    expect(verify.output).toContain('mismatch');
  }, 300000);
});
