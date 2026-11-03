'use strict';

/**
 * MISSAO-DEMO-SELF-ENGINEERING — a demonstração tem de continuar VERIFICÁVEL.
 *
 * O item afirma: "o RAP encontrou defeitos reais que passaram por todos os gates", citando seis
 * defeitos e dizendo que cada um tem prova reproduzível. Uma narrativa dessas envelhece mal: basta
 * alguém remover o item da fila, apagar a prova ou tirar o `regressionTest` para a afirmação virar
 * folclore. Esta suíte mede a afirmação — não a repete.
 *
 * O que ela exige, para cada defeito citado:
 *   1. existe na fila oficial;
 *   2. tem `closureProof` apontando para arquivo REAL em disco;
 *   3. a prova corresponde ao defeito (`defectId`) e está ASSINADA (`signature`);
 *   4. tem suíte de regressão DECLARADA e o arquivo existe.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const FILA = JSON.parse(fs.readFileSync(path.join(RAIZ, 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));

/** Os seis defeitos que o item cita como descobertos/expostos pelo próprio sistema. */
const CITADOS = [
  'DEF-TIMEBOMB-EVOSYNC-JANELA30D',
  'DEF-WS-AUTH-POS-LOGIN',
  'DEF-REMOVECHILD-HEADER-ENHANCEMENT',
  'DEF-QUEUE-DELETE-DB-ONLY',
  'MISSAO-B8-ESTADOS-FILA',
  'MISSAO-B1-CADEIA-CRIPTOGRAFICA',
];

const itens = new Map((FILA.items || []).map((i) => [i.id, i]));

describe('demonstração de self-engineering — os defeitos citados existem na fila', () => {
  test.each(CITADOS)('%s está na fila oficial', (id) => {
    expect(itens.has(id)).toBe(true);
  });

  test('são seis defeitos distintos (a demonstração não repete o mesmo caso)', () => {
    expect(new Set(CITADOS).size).toBe(6);
    for (const id of CITADOS) expect(typeof itens.get(id).title).toBe('string');
  });
});

describe('demonstração de self-engineering — cada defeito citado tem prova ASSINADA em disco', () => {
  test.each(CITADOS)('%s tem closureProof existente e assinado', (id) => {
    const item = itens.get(id);
    expect(typeof item.closureProof).toBe('string');

    const abs = path.join(RAIZ, item.closureProof);
    expect(fs.existsSync(abs)).toBe(true);

    const prova = JSON.parse(fs.readFileSync(abs, 'utf8'));
    // A prova é DESTE defeito (não um arquivo reaproveitado de outro item).
    expect(prova.defectId).toBe(id);
    // Assinada por autoridade humana registrada — atestação sem assinatura não é prova.
    expect(prova.signature && typeof prova.signature).toBe('object');
    expect(prova.signature.alg).toBe('Ed25519');
    expect(prova.signature.keyId).toBeTruthy();
    expect(String(prova.signature.value).length).toBeGreaterThan(32);
    expect(prova.signature.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(prova.actor && prova.actor.id).toBeTruthy();
    // Veredito de política declarado (não é um rascunho salvo com outro nome).
    expect(prova.policyDecision && typeof prova.policyDecision).toBe('object');
    expect(['CLOSE_VERIFIED', 'REVERIFY_EXISTING_CLOSURE']).toContain(prova.policyDecision.decision);
    expect(prova.policyDecision.policyId).toBeTruthy();
  });
});

describe('demonstração de self-engineering — a prova é reproduzível (suíte declarada e existente)', () => {
  test.each(CITADOS)('%s declara regressionTest que existe', (id) => {
    const item = itens.get(id);
    expect(typeof item.regressionTest).toBe('string');
    expect(item.regressionTest.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(RAIZ, item.regressionTest))).toBe(true);
  });
});

describe('demonstração de self-engineering — as duas classes opostas estão representadas', () => {
  test('o time bomb (falha só com a passagem do tempo) tem prova com execução registrada', () => {
    const prova = JSON.parse(fs.readFileSync(
      path.join(RAIZ, itens.get('DEF-TIMEBOMB-EVOSYNC-JANELA30D').closureProof), 'utf8',
    ));
    expect(Array.isArray(prova.executions)).toBe(true);
    expect(prova.executions.length).toBeGreaterThan(0);
    // A prova amarra a execução a um commit avaliado e a um fingerprint de código.
    expect(typeof prova.evaluatedCommit).toBe('string');
    expect(prova.evaluatedCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(typeof prova.codeFingerprint).toBe('string');
  });

  test('o fail-open do hook (estado desconhecido) tem suíte que exercita o validador', () => {
    const rel = itens.get('MISSAO-B8-ESTADOS-FILA').regressionTest;
    const fonte = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    // Não basta o arquivo existir: a suíte tem de exercitar a REGRA (estados), não outra coisa.
    expect(fonte).toMatch(/validar\(/);
    expect(fonte).toMatch(/STATUS_DESCONHECIDO/);
    expect(fonte).toMatch(/fixed_unverified/);
  });
});
