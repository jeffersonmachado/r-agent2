'use strict';

/**
 * L1–L3 — SEPARAÇÃO FORMAL entre o modelo INTERNO e o DTO de PRODUÇÃO.
 *
 * Defeito real (auditoria 2026-09-12/13): `GET /api/learning/manuals` devolvia
 * o `metadata.json` interno direto (`replayId`, `steps[].selector`, `success`) e
 * o PDF era montado do mesmo objeto — imprimindo `Fonte: replay real <id>`,
 * `alvo <code>#selector</code>` e `falhou no replay`. Não havia projeção: o
 * objeto interno ERA a resposta.
 *
 * Contrato agora exigido:
 *   - `toProductionManualMetadata` constrói por ALLOWLIST (não deleta campos);
 *   - o DTO carrega `shape` próprio e o assert recusa qualquer outra coisa;
 *   - chave técnica no DTO derruba com `PRODUCTION_MANUAL_LEAK` (estrutural);
 *   - texto com detalhe interno derruba com o mesmo código;
 *   - a proveniência interna NÃO é destruída: vive no artefato DEVELOPMENT.
 */

const {
  INTERNAL_MANUAL_SHAPE,
  PRODUCTION_MANUAL_SHAPE,
  PRODUCTION_MANUAL_DTO_VERSION,
  toProductionManualMetadata,
  toProductionManualStep,
  isProductionManualDto,
  assertProductionManualDto,
  assertInternalManualMetadata,
  toInternalManualProvenance,
  toProductionRagDocument,
} = require('../../../api/services/learning/manualProjection');

/** Modelo INTERNO de referência (o que vive em `metadata.json`). */
function internalMetadata(overrides = {}) {
  return {
    shape: INTERNAL_MANUAL_SHAPE,
    id: 'manual-1',
    title: 'Manual — jornada fitness_checkin',
    tenantId: 'academia-a',
    replayId: 'replay-abc-123',
    journeyKey: 'fitness_checkin',
    createdBy: 'agent-1',
    createdAt: '2026-09-13T10:00:00.000Z',
    steps: [
      {
        order: 1,
        action: 'click',
        label: 'Clicar',
        name: 'Abrir Matrícula do aluno',
        selector: '#membership-button',
        value: null,
        success: true,
        image: 'img/01-abrir-matricula.png',
      },
      {
        order: 2,
        action: 'fill',
        label: 'Preencher campo',
        name: 'Seletor de data',
        selector: 'textarea.support-form-textarea',
        value: 'Nota interna',
        success: false,
        image: null,
      },
    ],
    stepCount: 2,
    imageCount: 1,
    redactions: 2,
    ragDocumentId: 'manual:manual-1',
    contentType: 'manual',
    version: 1,
    ragChunksCreated: 3,
    ragIndexedAt: '2026-09-13T10:00:01.000Z',
    ...overrides,
  };
}

function collectKeys(value, acc = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, acc));
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.add(key);
      collectKeys(child, acc);
    }
  }
  return acc;
}

describe('L1 — InternalManualMetadata × ProductionManualDTO', () => {
  test('a projeção devolve o shape de produção e a versão do DTO', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    expect(dto.shape).toBe(PRODUCTION_MANUAL_SHAPE);
    expect(dto.dtoVersion).toBe(PRODUCTION_MANUAL_DTO_VERSION);
    expect(isProductionManualDto(dto)).toBe(true);
  });

  test('o modelo interno NÃO é um DTO de produção (não são confundíveis)', () => {
    expect(isProductionManualDto(internalMetadata())).toBe(false);
    expect(() => assertProductionManualDto(internalMetadata(), 'teste'))
      .toThrow(/production_manual_leak/);
    try {
      assertProductionManualDto(internalMetadata(), 'teste');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error.code).toBe('PRODUCTION_MANUAL_LEAK');
    }
  });

  test('o assert do lado interno recusa o DTO de produção', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    expect(() => assertInternalManualMetadata(dto)).toThrow(/INTERNAL_MANUAL_METADATA/);
    expect(assertInternalManualMetadata(internalMetadata()).id).toBe('manual-1');
  });

  test('nenhuma chave interna sobrevive à projeção', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    const keys = collectKeys(dto);
    for (const forbidden of [
      'replayId', 'replay', 'selector', 'action', 'success', 'tenantId',
      'createdBy', 'ragDocumentId', 'ragChunksCreated', 'ragIndexedAt',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect([...keys].sort()).toEqual([
      'completed', 'contentType', 'createdAt', 'dtoVersion', 'id', 'image',
      'imageCount', 'journeyKey', 'label', 'name', 'order', 'redactions',
      'shape', 'stepCount', 'steps', 'title', 'value', 'version',
    ]);
  });

  test('nenhum valor interno (replayId/seletor) aparece no DTO serializado', () => {
    const serialized = JSON.stringify(toProductionManualMetadata(internalMetadata()));
    expect(serialized).not.toContain('replay-abc-123');
    expect(serialized).not.toContain('#membership-button');
    expect(serialized).not.toContain('textarea.support-form-textarea');
    expect(serialized).not.toMatch(/replay/i);
    expect(serialized).not.toMatch(/selector/i);
    expect(serialized).not.toContain('"success"');
  });

  test('o resultado operacional do passo é traduzido (completed), não repassado', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    expect(dto.steps[0].completed).toBe(true);
    expect(dto.steps[1].completed).toBe(false);
    expect(dto.steps[1].success).toBeUndefined();
  });

  test('a projeção preserva o conteúdo operacional legítimo', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    expect(dto.title).toBe('Manual — jornada fitness_checkin');
    expect(dto.steps[0].name).toBe('Abrir Matrícula do aluno');
    expect(dto.steps[1].name).toBe('Seletor de data');
    expect(dto.steps[1].value).toBe('Nota interna');
    expect(dto.steps[0].image).toBe('img/01-abrir-matricula.png');
    expect(dto.imageCount).toBe(1);
  });

  test('toProductionManualStep ignora campos técnicos conhecidos', () => {
    const step = toProductionManualStep({
      order: 3, name: 'x', label: 'Clicar', value: null, image: null,
      completed: true, selector: '#x', success: false, adapter: 'playwright', timeoutMs: 10,
    });
    expect(Object.keys(step).sort()).toEqual(['completed', 'image', 'label', 'name', 'order', 'value']);
    // `success:false` é um flag TÉCNICO; `completed` é o resultado operacional
    // explícito. Quando ambos existem, o operacional tem precedência.
    expect(step.completed).toBe(true);
  });

  test('a projeção é idempotente (projetar o DTO devolve o mesmo DTO)', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    const twice = toProductionManualMetadata(dto);
    expect(twice).toEqual(dto);
    expect(() => assertProductionManualDto(twice, 'idempotência')).not.toThrow();
  });

  test('passo sem flag alguma é considerado concluído (default operacional)', () => {
    expect(toProductionManualStep({ order: 1, name: 'x', label: 'Clicar' }).completed).toBe(true);
    expect(toProductionManualStep({ order: 1, name: 'x', success: false }).completed).toBe(false);
  });
});

describe('L2/L3 — fail-closed tipado', () => {
  test('chave técnica no DTO derruba mesmo com valor inofensivo', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    dto.steps[0].selector = 'button.save';
    try {
      assertProductionManualDto(dto, 'teste estrutural');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error.code).toBe('PRODUCTION_MANUAL_LEAK');
      expect(error.findings.some((f) => f.ruleId === 'key_not_allowed_in_production')).toBe(true);
      expect(error.findings.some((f) => f.path.includes('selector'))).toBe(true);
    }
  });

  test('chave desconhecida na raiz derruba (allowlist, não blocklist)', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    dto.uiTrace = [{ selector: '#x' }];
    expect(() => assertProductionManualDto(dto, 'teste raiz')).toThrow(/production_manual_leak/);
  });

  test('texto com referência a replay dentro de campo permitido derruba', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    dto.steps[0].name = 'Fonte: replay real `abc-1`';
    try {
      assertProductionManualDto(dto, 'teste textual');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error.code).toBe('PRODUCTION_MANUAL_LEAK');
      expect(error.findings.some((f) => f.ruleId === 'replay_reference')).toBe(true);
    }
  });

  test('o erro carrega os achados auditáveis (não é um booleano solto)', () => {
    try {
      assertProductionManualDto(internalMetadata(), 'auditoria');
    } catch (error) {
      expect(Array.isArray(error.findings)).toBe(true);
      expect(error.findings.length).toBeGreaterThan(0);
      expect(error.name).toBe('ProductionManualLeakError');
    }
  });

  test('anti-falso-positivo: DTO com "Seletor de data" e "# Título" passa', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    dto.steps[1].name = 'Seletor de data';
    dto.steps[0].name = '# Título';
    dto.steps[0].label = 'Use o seletor de canal';
    expect(() => assertProductionManualDto(dto, 'anti-falso-positivo')).not.toThrow();
  });

  test('DTO válido atravessa o assert inalterado', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    const snapshot = JSON.stringify(dto);
    expect(assertProductionManualDto(dto, 'ok')).toBe(dto);
    expect(JSON.stringify(dto)).toBe(snapshot);
  });
});

describe('L7 — proveniência interna preservada (não destruída)', () => {
  test('o artefato de proveniência é DEVELOPMENT/SYSTEM e carrega a prova técnica', () => {
    const provenance = toInternalManualProvenance(internalMetadata());
    expect(provenance.artifactType).toBe('manual-provenance');
    expect(provenance.classification).toBe('DEVELOPMENT');
    expect(provenance.domain).toBe('SYSTEM');
    expect(provenance.replayId).toBe('replay-abc-123');
    expect(provenance.technicalSteps[0].selector).toBe('#membership-button');
    expect(provenance.technicalSteps[1].executedSuccessfully).toBe(false);
    expect(provenance.technicalSteps[0].action).toBe('click');
  });

  test('a proveniência NÃO é um DTO de produção', () => {
    expect(isProductionManualDto(toInternalManualProvenance(internalMetadata()))).toBe(false);
  });
});

describe('L6 — projeção do RAG OPERACIONAL', () => {
  test('o documento do índice é OPERATIONAL/PRODUCTION e não expõe replay', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    const { document, tenantId } = toProductionRagDocument({
      productionManual: dto,
      content: '# Manual\n\nAcesse Matrícula e confirme o pagamento.',
      tenantId: 'academia-a',
    });
    expect(tenantId).toBe('academia-a');
    expect(document.id).toBe('manual:manual-1');
    expect(document.domain).toBe('OPERATIONAL');
    expect(document.classification).toBe('PRODUCTION');
    expect(document.sensitivity).toBe('INTERNAL');
    expect(document.metadata.replayId).toBeUndefined();
    expect(document.metadata.sourceType).toBeUndefined();

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('replay-abc-123');
    expect(serialized).not.toContain('#membership-button');
    expect(serialized).not.toMatch(/replay/i);
    expect(serialized).not.toMatch(/selector/i);
  });

  test('a projeção do RAG revalida o CONTEÚDO (não confia no chamador)', () => {
    const dto = toProductionManualMetadata(internalMetadata());
    expect(() => toProductionRagDocument({
      productionManual: dto,
      content: 'Fonte: replay real `abc-1` (alvo `#membership-button`)',
      tenantId: 'academia-a',
    })).toThrow(/production_content_leak/);
  });

  test('a projeção do RAG revalida o DTO', () => {
    expect(() => toProductionRagDocument({
      productionManual: internalMetadata(),
      content: 'conteúdo limpo',
      tenantId: 'academia-a',
    })).toThrow(/production_manual_leak/);
  });
});
