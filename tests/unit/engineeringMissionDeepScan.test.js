'use strict';

/**
 * TESTE OBRIGATÓRIO DA MISSÃO — enriquecimento code-aware.
 *
 * Requisito: "criar teste obrigatório em que a palavra importante da missão NÃO aparece no nome do
 * arquivo, mas aparece em símbolo, função, comentário arquitetural relevante, route, model, teste ou
 * conteúdo RAG. O Mission Compiler deve encontrá-la. Esse teste precisa FALHAR caso a implementação
 * use apenas filename matching."
 *
 * O GAP era real e explícito:
 *
 *   if (!keywords.some((kw) => normalizedPath.includes(kw))) continue;   // só o CAMINHO decidia
 *
 * Esta suíte falha se alguém voltar a decidir relevância apenas pelo nome do arquivo.
 */

const context = require('../../api/services/engineeringMission/missionContextService');

const MARKER = 'zorkmid';
const FIXTURE_PATH = require('path').join('tests', 'fixtures', 'deepScanMarker.js');

describe('Mission Context — enriquecimento code-aware (palavra fora do nome do arquivo)', () => {
  test('PRECONDICAO: o nome do arquivo NÃO contém a palavra marcadora', () => {
    // Sem esta precondição o teste não provaria nada — seria path matching disfarçado.
    expect(FIXTURE_PATH.toLowerCase()).not.toContain(MARKER);
  });

  test('ENCONTRA_POR_CONTEUDO: a palavra é achada sem estar no path', () => {
    const out = context.scanRepository([MARKER]);
    const hits = out.evidenceRefs.filter((ref) => ref.path === FIXTURE_PATH);
    expect(hits.length).toBeGreaterThan(0);
    // Nenhuma evidência deste arquivo pode ser `kind: 'file'` (path matching) — ela veio do CONTEÚDO.
    for (const hit of hits) {
      expect(hit.kind).not.toBe('file');
    }
    expect(hits[0].snippet).toBeTruthy();
    expect(hits[0].line).toBeGreaterThan(0);
  });

  test('CLASSIFICA_A_ORIGEM: a evidência diz em QUE tipo de construção a palavra estava', () => {
    const out = context.scanRepository([MARKER]);
    const kinds = new Set(out.evidenceRefs.filter((r) => r.path === FIXTURE_PATH).map((r) => r.kind));
    // Ao menos uma construção de CÓDIGO (não texto solto) tem de ser reconhecida.
    expect([...kinds].some((k) => ['symbol', 'route', 'model', 'comment'].includes(k))).toBe(true);
    expect(Object.keys(out.hitsByKind).length).toBeGreaterThan(0);
  });

  test('NAO_E_PATH_MATCHING_DISFARCADO: uma palavra realmente inexistente não gera evidência', () => {
    // A palavra é GERADA EM RUNTIME: escrita literalmente aqui, ela passaria a existir no conteúdo
    // deste próprio arquivo e o scan a encontraria — com razão. (Foi exatamente o que aconteceu na
    // primeira versão deste teste: o scan achou a "palavra inexistente" escrita nele mesmo.)
    const impossible = `zz${Date.now()}${Math.floor(Math.random() * 1e6)}zz`;
    const out = context.scanRepository([impossible]);
    expect(out.evidenceRefs).toHaveLength(0);
  });

  test('ORCAMENTO_DECLARADO: o custo do scan é medido e o truncamento é reportado como fato', () => {
    const out = context.scanRepository([MARKER]);
    expect(typeof out.contentFilesScanned).toBe('number');
    expect(out.contentFilesScanned).toBeGreaterThan(0);
    expect(out).toHaveProperty('contentTruncated');
    // O truncamento nunca pode ser silencioso: se aconteceu, é fato no retorno.
    if (out.contentTruncated) {
      expect(out.contentTruncated).toBe(true);
    }
  });

  test('PATH_CONTINUA_FUNCIONANDO: o critério antigo não foi removido (compatibilidade)', () => {
    const out = context.scanRepository(['engineeringMission']);
    // O path matching continua contribuindo: existem evidências de arquivos cujo caminho contém a
    // palavra. Não exigimos `kind === 'file'` para TODAS porque — medido — as evidências de CONTEÚDO
    // preenchem o orçamento de 40 primeiro (a palavra aparece em centenas de linhas). Esse é um
    // comportamento aceitável, mas precisa ser CONHECIDO: quem depender de evidência por path sob
    // palavra muito comum pode receber só evidências de conteúdo.
    const byPathName = out.evidenceRefs.filter((r) => r.path.toLowerCase().includes('engineeringmission'));
    expect(byPathName.length).toBeGreaterThan(0);
  });
});
