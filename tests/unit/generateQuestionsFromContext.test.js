describe('generateQuestionsFromContext', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('gera no mínimo 20 perguntas quando há contexto suficiente', () => {
    const { generateQuestionsFromContext } = require('../../api/utils/ragQuestionGenerator');
    const questions = generateQuestionsFromContext({
      businessType: 'physical',
      context: {
        keyPhrases: ['aulas de pilates', 'fisioterapia', 'avaliação postural'],
        services: ['Pilates', 'Fisioterapia', 'Funcional', 'Avaliação postural'],
        prices: ['R$ 120,00', 'R$ 200,00'],
        schedules: ['Seg a Sex 08:00-18:00', 'Sáb 09:00-12:00'],
        contacts: ['(11) 99999-0000', '@studioexemplo', 'contato@exemplo.com'],
        paymentMethods: ['PIX', 'Cartão de crédito'],
        locations: ['Rua Exemplo, 123 - Centro'],
        entities: ['Studio Exemplo'],
      },
      limits: { minQuestionsIfRich: 20, maxQuestions: 120 },
    });

    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThanOrEqual(20);
    // sem duplicatas textuais (case-insensitive normalizado)
    const norm = questions.map((q) => q.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim());
    expect(new Set(norm).size).toBe(norm.length);
  });

  test('não gera “criar conta/login” para negócio físico', () => {
    const { generateQuestionsFromContext } = require('../../api/utils/ragQuestionGenerator');
    const questions = generateQuestionsFromContext({
      businessType: 'physical',
      context: {
        keyPhrases: ['aulas presenciais', 'horário de funcionamento'],
        services: ['Pilates'],
        schedules: ['Seg a Sex 08:00-18:00'],
        contacts: ['(11) 99999-0000'],
      },
    });

    const joined = questions.join(' ').toLowerCase();
    expect(joined).not.toContain('criar uma conta');
    expect(joined).not.toContain('criar conta');
    expect(joined).not.toContain('login');
  });
});

