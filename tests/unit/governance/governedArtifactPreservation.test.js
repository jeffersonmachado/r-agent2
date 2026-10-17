'use strict';

/**
 * PRESERVAÇÃO DE ARTEFATO GOVERNADO EM TESTES (P2 — medido 2026-10-16).
 *
 * CADEIA DO DEFEITO (medida, não suposta):
 *   tests/unit/governance/modelDrivenE2e.test.js executa o produtor real
 *   `scripts/governance/validate-model-driven-e2e.js`, cujo OUTPUT_PATH canônico é
 *   `governance/model-driven-e2e-report.json`
 *     -> a suíte regrava o artefato governado FORA do run
 *     -> validate:current-run-temporal-integrity = INVALID_AUTHORITATIVE_ARTIFACT
 *     -> validate-engineering-router-v2-required-tests = [UNPROVEN] TEMPORAL-01/04
 *     -> engineering-router:v2-seal = NO_GO no passo REQUIRED_TESTS_V2
 *     -> npm run zip:release = BLOQUEADO (V2_SEAL_NOT_FRESH)
 *
 * Ou seja: rodar um teste de unidade impedia o selo e o empacotamento.
 *
 * A correção preserva o artefato: snapshot dos BYTES antes e restauração depois.
 * Restaurar bytes idênticos devolve também o `generatedAt`/lineage que estão DENTRO
 * do JSON — o artefato volta a pertencer ao momento em que foi produzido. Não se
 * redireciona o caminho canônico do produtor (isso enfraqueceria a evidência).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { preservarArtefato } = require('../../helpers/preserveGovernedArtifact');

function comTemporario(conteudoInicial, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artefato-governado-'));
  const alvo = path.join(dir, 'relatorio.json');
  if (conteudoInicial !== null) fs.writeFileSync(alvo, conteudoInicial);
  try {
    return fn(alvo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('artefato governado sobrevive a um teste que executa o produtor real', () => {
  it('bytes alterados durante o teste são RESTAURADOS byte a byte', () => {
    const original = JSON.stringify({ runId: 'run-1', generatedAt: '2026-10-16T00:00:00.000Z', pass: true });
    comTemporario(original, (alvo) => {
      const guarda = preservarArtefato(alvo);
      // o produtor real reescreve o arquivo (novo runId, novo generatedAt)
      fs.writeFileSync(alvo, JSON.stringify({ runId: 'run-2', generatedAt: '2026-10-17T00:00:00.000Z', pass: true }));
      expect(guarda.restaurar()).toBe('restaurado');
      expect(fs.readFileSync(alvo, 'utf8')).toBe(original);
    });
  });

  it('sem alteração real devolve `inalterado` (não reescreve à toa)', () => {
    comTemporario('{"a":1}', (alvo) => {
      const guarda = preservarArtefato(alvo);
      expect(guarda.restaurar()).toBe('inalterado');
      expect(fs.readFileSync(alvo, 'utf8')).toBe('{"a":1}');
    });
  });

  it('artefato que NÃO existia e nasceu no teste é removido', () => {
    comTemporario(null, (alvo) => {
      const guarda = preservarArtefato(alvo);
      fs.writeFileSync(alvo, '{"criado":"pelo teste"}');
      expect(guarda.restaurar()).toBe('removido');
      expect(fs.existsSync(alvo)).toBe(false);
    });
  });

  it('artefato apagado durante o teste é recriado com o conteúdo original', () => {
    comTemporario('{"original":true}', (alvo) => {
      const guarda = preservarArtefato(alvo);
      fs.rmSync(alvo);
      expect(guarda.restaurar()).toBe('restaurado');
      expect(fs.readFileSync(alvo, 'utf8')).toBe('{"original":true}');
    });
  });

  it('o teste que executa o produtor real USA a preservação (fiação)', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, 'modelDrivenE2e.test.js'),
      'utf8'
    );
    expect(fonte).toContain('preservarArtefato');
    expect(fonte).toContain('guardaDoRelatorio.restaurar()');
  });
});
