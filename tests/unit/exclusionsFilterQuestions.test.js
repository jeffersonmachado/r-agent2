const { filterQuestions, sanitizeContext, augmentExclusions, _internal } = require('../../api/services/exclusions.service');

describe('exclusions.service', () => {
  test('sanitizeContext remove padrões fixos', () => {
    const input = [
      'Fonte: relatório interno',
      '[Imagem: foo.jpeg]',
      'https://exemplo.com/pagina',
      'Arquivo: 123e4567-e89b-12d3-a456-426614174000.pdf',
      'Conteúdo real aqui',
    ].join('\n');

    const out = sanitizeContext(input);
    expect(out).toContain('Conteúdo real aqui');
    expect(out.toLowerCase()).not.toContain('fonte:');
    expect(out.toLowerCase()).not.toContain('[imagem:');
    expect(out.toLowerCase()).not.toContain('http');
    expect(out.toLowerCase()).not.toContain('123e4567-e89b-12d3-a456-426614174000.pdf');
  });

  test('filterQuestions remove perguntas contendo termos (case-insensitive)', () => {
    const questions = [
      'Qual o preço do plano mensal?',
      'O que significa dc664ec2-7fa7-4f12-a457-6c1e35138939.jpeg?',
      'Como faço contato?',
    ];
    const exclusions = ['.jpeg', 'dc664ec2-7fa7-4f12-a457-6c1e35138939'];
    const out = filterQuestions(questions, exclusions);
    expect(out).toEqual([
      'Qual o preço do plano mensal?',
      'Como faço contato?',
    ]);
  });

  test('filterQuestions remove perguntas com artefatos (arquivo/URL) mesmo sem exclusions', () => {
    const questions = [
      'O que é dc664ec2-7fa7-4f12-a457-6c1e35138939.jpeg?',
      'O que é https://studiooly.com.br/?',
      'Quais são as formas de pagamento?',
    ];
    const out = filterQuestions(questions, []);
    expect(out).toEqual([
      'Quais são as formas de pagamento?',
    ]);
  });

  test('augmentExclusions inclui nomes de arquivos/extensões para exibição no UI', () => {
    const inferred = ['Skip to content', 'Menu'];
    const out = augmentExclusions(inferred, {
      fileNames: ['dc664ec2-7fa7-4f12-a457-6c1e35138939.jpeg'],
    });
    expect(out).toEqual(expect.arrayContaining([
      'dc664ec2-7fa7-4f12-a457-6c1e35138939.jpeg',
      '.jpeg',
      'dc664ec2-7fa7-4f12-a457-6c1e35138939',
      'Skip to content',
    ]));
  });

  test('parseExclusionsFromText limita a 30 termos e dedupe', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `- termo${i % 10}`).join('\n');
    const parsed = _internal.parseExclusionsFromText(lines);
    expect(parsed.length).toBeLessThanOrEqual(30);
    // como dedupe por % 10, deve ficar 10
    expect(parsed.length).toBe(10);
  });

  test('sanitizeContext tolera valor hostil sem quebrar', () => {
    const hostile = { toString: () => { throw new Error('boom-sanitize'); } };
    expect(sanitizeContext(hostile)).toBe('');
  });

  test('filterQuestions ignora pergunta hostil e mantém válidas', () => {
    const questions = [
      { toString: () => { throw new Error('boom-question'); } },
      'Quais são as formas de pagamento?',
    ];
    const out = filterQuestions(questions, []);
    expect(out).toEqual(['Quais são as formas de pagamento?']);
  });
});

