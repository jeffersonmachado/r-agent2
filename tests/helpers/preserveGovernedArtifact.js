'use strict';

/**
 * Preserva um artefato GOVERNADO em volta de um teste que executa o produtor real.
 *
 * PROBLEMA REAL (medido 2026-10-16): `tests/unit/governance/modelDrivenE2e.test.js`
 * executa `scripts/governance/validate-model-driven-e2e.js`, cujo OUTPUT_PATH
 * canônico é `governance/model-driven-e2e-report.json`. Rodar a suíte reescrevia
 * aquele relatório FORA do run governado, e o resultado foi medido no pipeline:
 *
 *   validate:current-run-temporal-integrity -> INVALID_AUTHORITATIVE_ARTIFACT
 *     governance/model-driven-e2e-report.json
 *   validate-engineering-router-v2-required-tests -> [UNPROVEN] TEMPORAL-01/04/06
 *   engineering-router:v2-seal -> NO_GO no passo obrigatório REQUIRED_TESTS_V2
 *   npm run zip:release -> BLOQUEADO (V2_SEAL_NOT_FRESH)
 *
 * isto é, uma execução de teste de desenvolvedor bloqueava o selo e o empacotamento.
 *
 * A correção NÃO é redirecionar o caminho canônico do produtor (isso enfraqueceria
 * a evidência): é devolver os BYTES originais ao final. Restaurar bytes idênticos
 * preserva também o `generatedAt`/lineage gravados DENTRO do JSON, então o
 * artefato volta a pertencer exatamente ao momento em que foi produzido.
 *
 * Uso:
 *   const { preservarArtefato } = require('../../helpers/preserveGovernedArtifact');
 *   let guarda;
 *   beforeAll(() => { guarda = preservarArtefato(CAMINHO); });
 *   afterAll(() => { guarda.restaurar(); });
 */

const fs = require('fs');

/**
 * @param {string} absPath caminho absoluto do artefato governado
 * @returns {{ restaurar: () => 'inalterado'|'restaurado'|'removido', existia: boolean }}
 */
function preservarArtefato(absPath) {
  const existia = fs.existsSync(absPath);
  const original = existia ? fs.readFileSync(absPath) : null;

  return {
    existia,
    restaurar() {
      const existeAgora = fs.existsSync(absPath);

      if (!existia) {
        // Nasceu durante o teste: remover (artefato não existia no estado real).
        if (existeAgora) {
          fs.rmSync(absPath, { force: true });
          return 'removido';
        }
        return 'inalterado';
      }

      if (!existeAgora) {
        fs.writeFileSync(absPath, original);
        return 'restaurado';
      }

      const atual = fs.readFileSync(absPath);
      if (atual.equals(original)) return 'inalterado';

      fs.writeFileSync(absPath, original);
      return 'restaurado';
    },
  };
}

module.exports = { preservarArtefato };
