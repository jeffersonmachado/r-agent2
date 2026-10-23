'use strict';

/**
 * `sourceFingerprint` tem de ser função do CÓDIGO VERSIONADO, não do estado de execução do
 * workspace.
 *
 * Defeito medido (2026-10-23): `qa/evidence/` está na superfície provada porque os VALIDADORES
 * de evidência vivem lá, mas o mesmo diretório recebe SAÍDAS de execução (`*-latest.json`,
 * ignoradas pelo git). Uma delas entrava no fingerprint, então o MESMO commit produzia
 * fingerprints diferentes conforme o workspace tivesse rodado a jornada:
 *
 *   worktree limpo ................ babb60d5f1b4
 *   workspace que rodou a jornada .. 3eac1cbf8859
 *
 * Consequência: 118 provas mintadas em um checkout ficavam `INVALID_EVIDENCE` no outro — a
 * prova deixava de ser portável e o portão acusava adulteração onde havia apenas um artefato
 * gerado. Estes testes fixam o contrato nos dois sentidos: artefato gerado NUNCA muda o
 * fingerprint, e mudança real em validador versionado SEMPRE muda.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computeSourceFingerprint,
  SKIP_REL_FILE_PATTERNS,
} = require('../../../governance/proof-engine/fingerprint-chain');

function raizTemporaria() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-gerado-'));
  fs.mkdirSync(path.join(root, 'qa', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qa', 'evidence', 'stepEvidenceContracts.js'), "'use strict';\nmodule.exports = {};\n");
  return root;
}

function escrever(abs, conteudo) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

describe('sourceFingerprint — artefatos GERADOS em qa/evidence não participam', () => {
  test('o padrão cobre as saídas -latest (json/txt/log) e só elas', () => {
    const casa = (rel) => SKIP_REL_FILE_PATTERNS.some((p) => p.test(rel));
    expect(casa('qa/evidence/journey-functional-latest.json')).toBe(true);
    expect(casa('qa/evidence/ask-ai-latest.txt')).toBe(true);
    expect(casa('qa/evidence/runner-latest.log')).toBe(true);
    // Validadores versionados continuam na superfície.
    expect(casa('qa/evidence/stepEvidenceContracts.js')).toBe(false);
    // Fora de qa/evidence o padrão não se aplica.
    expect(casa('config/latest.json')).toBe(false);
  });

  test('rodar a jornada (criar *-latest.json) NÃO muda o fingerprint', () => {
    const root = raizTemporaria();
    const antes = computeSourceFingerprint(root);
    escrever(path.join(root, 'qa', 'evidence', 'journey-functional-latest.json'), '{"jornada":"ok"}\n');
    escrever(path.join(root, 'qa', 'evidence', 'journey-functional-latest.txt'), 'ok\n');
    const depois = computeSourceFingerprint(root);
    expect(depois).toBe(antes);
  });

  test('mudança REAL em validador versionado SEMPRE muda o fingerprint', () => {
    const root = raizTemporaria();
    const antes = computeSourceFingerprint(root);
    escrever(path.join(root, 'qa', 'evidence', 'stepEvidenceContracts.js'), "'use strict';\nmodule.exports = { mudou: true };\n");
    expect(computeSourceFingerprint(root)).not.toBe(antes);
  });

  test('JSON versionado dentro de qa/evidence (sem sufixo -latest) continua contando', () => {
    const root = raizTemporaria();
    const antes = computeSourceFingerprint(root);
    escrever(path.join(root, 'qa', 'evidence', 'contrato-de-evidencia.json'), '{"contrato":1}\n');
    expect(computeSourceFingerprint(root)).not.toBe(antes);
  });
});
