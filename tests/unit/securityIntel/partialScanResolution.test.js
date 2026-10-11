'use strict';

/**
 * H7 — ausência em scan PARCIAL não pode resolver achado.
 *
 * DEFEITO MEDIDO (2026-10-11): a resolução aposentava QUALQUER achado que não
 * aparecesse no scan (`!activeKeys.has(findingKey)`), inclusive quando o scan não
 * tinha como examinar o pacote:
 *   - escopo reduzido (`direct` não avalia dependência transitiva);
 *   - filtro por serviço;
 *   - inventário truncado (`components >= maxComponents`).
 *
 * Prova de execução do defeito no banco real: um scan `installed` (1.141 pacotes)
 * examinou 1.141; o MESMO banco sob escopo `direct` examina 82 — e os achados dos
 * outros pacotes eram aposentados, ou seja, o risco desaparecia do gate sem ter
 * sido remediado. Depois da correção, o scan `direct` devolve `unverified=87` e
 * `resolved=0`.
 *
 * Estes testes travam a REGRA (função pura), não o banco.
 */

const { decidirAposentadoria } = require('../../../api/services/securityIntel/vulnerabilityScanService');

/** Achado mínimo (só os campos que a decisão usa). */
function achado(pacote, key = `${pacote}-key`) {
  return { id: key, finding_key: key, package_name: pacote, status: 'OPEN', severity: 'HIGH' };
}

describe('decidirAposentadoria — só aposenta com evidência de cobertura', () => {
  it('pacote que SAIU do inventário corrente é resolvido (o artefato não o tem mais)', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('pacote-removido')],
      inventoryNames: new Set(['outro-pacote']),
      examinados: new Set(['outro-pacote']),
      motivoNaoVerificado: null,
    });
    expect(toResolve).toHaveLength(1);
    expect(naoVerificados).toHaveLength(0);
  });

  it('pacote no inventário + examinado neste scan ⇒ resolvido', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('lodash')],
      inventoryNames: new Set(['lodash']),
      examinados: new Set(['lodash']),
      motivoNaoVerificado: null,
    });
    expect(toResolve).toHaveLength(1);
    expect(naoVerificados).toHaveLength(0);
  });

  it('escopo REDUZIDO (cobertura parcial) ⇒ NÃO resolve, mesmo que o pacote esteja no inventário', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('transitiva')],
      inventoryNames: new Set(['transitiva']),
      examinados: new Set(['direta']),
      motivoNaoVerificado: 'scope_direct',
    });
    expect(toResolve).toHaveLength(0);
    expect(naoVerificados).toHaveLength(1);
  });

  it('pacote no inventário mas FORA do conjunto examinado ⇒ NÃO resolve', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('fora-do-examinado')],
      inventoryNames: new Set(['fora-do-examinado']),
      examinados: new Set(['outra-coisa']),
      motivoNaoVerificado: null,
    });
    expect(toResolve).toHaveLength(0);
    expect(naoVerificados).toHaveLength(1);
  });

  it('inventário TRUNCADO não aposenta nada que esteja no inventário', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('a'), achado('b')],
      inventoryNames: new Set(['a', 'b']),
      examinados: new Set(['a', 'b']),
      motivoNaoVerificado: 'inventory_truncated',
    });
    expect(toResolve).toHaveLength(0);
    expect(naoVerificados).toHaveLength(2);
  });

  it('filtro por serviço: só o que ficou fora da cobertura é preservado', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('coberto'), achado('nao-coberto')],
      inventoryNames: new Set(['coberto', 'nao-coberto']),
      examinados: new Set(['coberto']),
      motivoNaoVerificado: 'service_filter',
    });
    expect(toResolve).toHaveLength(0);
    expect(naoVerificados).toHaveLength(2);
  });

  it('pacote removido do artefato continua sendo resolvido MESMO com cobertura parcial', () => {
    // A regra não pode virar "nunca resolve": o inventário é a fonte da verdade do
    // que existe, e o gate precisa convergir quando a dependência sai do projeto.
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [achado('saiu-do-projeto'), achado('transitiva-preservada')],
      inventoryNames: new Set(['transitiva-preservada']),
      examinados: new Set(['direta']),
      motivoNaoVerificado: 'scope_direct',
    });
    expect(toResolve.map((r) => r.package_name)).toEqual(['saiu-do-projeto']);
    expect(naoVerificados.map((r) => r.package_name)).toEqual(['transitiva-preservada']);
  });

  it('sem candidatos ⇒ nada a fazer (não inventa resultado)', () => {
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos: [],
      inventoryNames: new Set(),
      examinados: new Set(),
      motivoNaoVerificado: null,
    });
    expect(toResolve).toEqual([]);
    expect(naoVerificados).toEqual([]);
  });

  it('nenhum achado é devolvido nos DOIS lados (resolver e preservar são exclusivos)', () => {
    const candidatos = [achado('x'), achado('y'), achado('z')];
    const { toResolve, naoVerificados } = decidirAposentadoria({
      candidatos,
      inventoryNames: new Set(['x', 'y']),
      examinados: new Set(['x']),
      motivoNaoVerificado: null,
    });
    const idsResolvidos = new Set(toResolve.map((r) => r.id));
    for (const row of naoVerificados) expect(idsResolvidos.has(row.id)).toBe(false);
    // E todo candidato aparece em um dos dois lados (nada desaparece em silêncio).
    expect(toResolve.length + naoVerificados.length).toBe(candidatos.length);
  });
});
