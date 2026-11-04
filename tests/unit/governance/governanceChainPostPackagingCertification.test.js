'use strict';

/**
 * Regressão do defeito H20 (cadeia pós-certificação divergente).
 *
 * DEFEITO MEDIDO (2026-11-04): o ciclo de release terminava com a cadeia criptográfica
 * ESTRUTURALMENTE inválida porque os relatórios finais (`evidence-manifest.json`,
 * `final-proof-report.json`, `final-readiness-report.json`, `package-validation-report.json` e
 * `proof-signature.json`) são reescritos DEPOIS de a cadeia ser construída e assinada no PASS 4 do
 * two-pass — e nenhum passo a reconstruía. Prova antes da correção: 13 divergências em
 * `validate-governance-chain.js` e `assert-canonical-release-decision.js` em
 * `CADEIA_RECOMPUTADA_INVALIDA` (publicação impossível, em TODO ciclo).
 *
 * Este arquivo cobre os dois lados:
 *   1. COMPORTAMENTO: `verifyChain` RECALCULA os bytes e acusa divergência quando um membro muda
 *      depois de a cadeia ser gravada (a cadeia não é auto-declaração).
 *   2. GUARDA ESTRUTURAL: a fase `certify` do orquestrador de selagem PRECISA reconstruir a cadeia
 *      pelo caminho sancionado (`governance/sign-governance.js`), verificar os bytes e afirmar a
 *      decisão canônica — nesta ordem. Remover qualquer um dos três reabre o defeito em silêncio.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const crypto = require('crypto');
const { verifyChainHashes } = require('../../../governance/governance-chain');

function escrever(dir, rel, conteudo) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo, 'utf8');
  return abs;
}

describe('H20 — cadeia pós-certificação', () => {
  test('verifyChainHashes acusa divergência quando um membro muda depois da gravação', () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'h20-chain-'));
    try {
      const membro = escrever(raiz, 'governance/final-readiness-report.json', '{"readiness":"DEFERRED"}\n');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(membro)).digest('hex');
      const chain = { chainRoot: '', links: [{ id: 'final_readiness', path: 'governance/final-readiness-report.json', hash, exists: true }] };

      const antes = verifyChainHashes(chain, { raiz });
      expect((antes.failures || []).some((f) => f.reason === 'hash_mismatch')).toBe(false);

      // O passo pós-empacotamento reescreve o relatório DEPOIS de a cadeia existir.
      escrever(raiz, 'governance/final-readiness-report.json', '{"readiness":"AUTONOMOUS_READY_GO"}\n');
      const depois = verifyChainHashes(chain, { raiz });

      expect(depois.valid).toBe(false);
      expect(depois.failures.map((f) => f.reason)).toContain('hash_mismatch');
    } finally {
      fs.rmSync(raiz, { recursive: true, force: true });
    }
  });

  test('a fase certify reconstrói, verifica e afirma a decisão canônica nesta ordem', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'seal-release.sh'), 'utf8');
    // Escopo da fase `certify`: a mesma assertiva canônica também aparece na fase `publish`,
    // então a ordem só significa algo DENTRO da fase que certifica antes de publicar.
    const inicio = script.indexOf('phase_certify()');
    const fim = script.indexOf('phase_verify_delivery()');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const fase = script.slice(inicio, fim);

    const posReconstrucao = fase.indexOf('governance/sign-governance.js');
    const posVerificacao = fase.indexOf('node scripts/governance/validate-governance-chain.js');
    const posAssertiva = fase.indexOf('assert-canonical-release-decision.js');

    expect(posReconstrucao).toBeGreaterThan(-1);
    expect(posVerificacao).toBeGreaterThan(posReconstrucao);
    expect(posAssertiva).toBeGreaterThan(posVerificacao);

    // O --env-file-if-exists=.env é obrigatório: sem ele o preSign aborta DEPOIS de gravar a
    // cadeia, deixando par cadeia↔atestado divergente (pior que não reconstruir).
    expect(fase).toContain('node --env-file-if-exists=.env governance/sign-governance.js');
  });
});
