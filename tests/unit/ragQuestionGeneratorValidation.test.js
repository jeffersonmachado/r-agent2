describe('ragQuestionGenerator - validação de perguntas', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('não deve rejeitar perguntas normais terminando com palavras comuns (ex.: "oferece?")', () => {
    const { mergeUniqueQuestions } = require('../../api/utils/ragQuestionGenerator');

    const input = [
      'O que é Studio Oly?',
      'Quais serviços Studio Oly oferece?',
      'Quais modalidades estão disponíveis?',
      'Como entrar em contato?',
    ];

    const out = mergeUniqueQuestions([], input, 50);
    expect(out).toEqual(input);
  });

  test('deve rejeitar token truncado no final (ex.: "fí?")', () => {
    const { mergeUniqueQuestions } = require('../../api/utils/ragQuestionGenerator');
    const out = mergeUniqueQuestions([], ['bem-estar fí?'], 50);
    expect(out).toEqual([]);
  });
});

