'use strict';

/**
 * Escopo da regra de NEGÓCIO no `validate-business-needs`.
 *
 * Defeito real medido (2026-09-18): a confiança de CONTRATO DE NEGÓCIO era
 * aplicada a `config/journey-contracts.json` inteiro (97 ids), mas a maioria é
 * DERIVADA de módulo/domínio/capability, cada uma com UM cenário placeholder
 * (ex.: `orders` → `business-core-cap-scheduling`, steps `["Tenant autenticado"]`).
 * Resultado: 70 avisos de baixa confiança dos quais só 2 eram jornadas de
 * negócio (`campaigns`, `billing`) — os casos acionáveis ficavam afogados em 68
 * avisos que nunca poderiam ser resolvidos sem VÍNCULO FABRICADO.
 *
 * A autoridade do escopo é o próprio catálogo, que declara:
 * "Catálogo operacional de jornadas de negócio ... Nenhum identificador técnico
 * (wave, cenário, seed, replay, passo de RPA, rota interna) pertence a este arquivo."
 *
 * Aqui se prova o PREDICADO e a fonte do escopo. O comportamento agregado do
 * relatório é verificado na execução real do gate (não por teste, para não criar
 * corrida no arquivo de relatório compartilhado).
 */

const path = require('path');

const {
  loadBusinessJourneyIds,
  isBusinessJourneyId,
} = require('../../../scripts/governance/validate-business-needs');

describe('escopo de jornada de negócio', () => {
  test('a fonte do escopo é o catálogo canônico e não vem vazia', () => {
    const ids = loadBusinessJourneyIds();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.size).toBeGreaterThan(0);
  });

  test('jornada do catálogo está NO escopo; id derivado está FORA', () => {
    const ids = loadBusinessJourneyIds();

    // `campaigns` é jornada de negócio real (está no catálogo) — foi uma das 2
    // que precisam continuar sendo avisadas.
    expect(isBusinessJourneyId('campaigns', ids)).toBe(true);

    // Entradas derivadas de módulo/capability: fora do escopo de negócio.
    for (const derived of ['capability_scheduling', 'orders', 'projects', 'inbox', 'webhooks', 'sla']) {
      expect(isBusinessJourneyId(derived, ids)).toBe(false);
    }
  });

  test('o catálogo NÃO contém identificadores técnicos (invariante declarada)', () => {
    const ids = loadBusinessJourneyIds();
    for (const id of ids) {
      expect(String(id)).not.toMatch(/^capability_/);
      expect(String(id)).not.toMatch(/^business-core-cap/);
    }
  });

  test('predicado é seguro com entrada ausente/estranha (nunca lança)', () => {
    expect(isBusinessJourneyId('orders', undefined)).toBe(false);
    expect(isBusinessJourneyId('orders', null)).toBe(false);
    expect(isBusinessJourneyId('orders', {})).toBe(false);
    expect(isBusinessJourneyId(null, loadBusinessJourneyIds())).toBe(false);
    expect(isBusinessJourneyId(undefined, loadBusinessJourneyIds())).toBe(false);
  });

  test('as duas jornadas reais abaixo do limiar continuam NO catálogo (pré-condição do aviso)', () => {
    const ids = loadBusinessJourneyIds();
    const contracts = require(path.join('..', '..', '..', 'config', 'journey-contracts.json')).journeys;

    const lowBusiness = Object.entries(contracts)
      .filter(([id, c]) => (c.confidence || 0) < 0.7 && isBusinessJourneyId(id, ids))
      .map(([id]) => id)
      .sort();

    // Se este conjunto encolher, alguém resolveu o vínculo REAL (bom) ou o
    // catálogo mudou (revisar). Nunca deve CRESCER por causa de pseudo-jornada.
    expect(lowBusiness).toEqual(['billing', 'campaigns']);
  });
});
