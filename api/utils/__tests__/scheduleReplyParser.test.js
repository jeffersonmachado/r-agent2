'use strict';

const { parseScheduleReply, normalizeText } = require('../scheduleReplyParser');

describe('scheduleReplyParser', () => {
  test('normaliza acentos e espaços', () => {
    expect(normalizeText('  Não   Confirmo! ')).toBe('nao confirmo');
  });

  test('reconhece confirmação por número e variações', () => {
    expect(parseScheduleReply('1').action).toBe('confirm');
    expect(parseScheduleReply('confirmar').action).toBe('confirm');
    expect(parseScheduleReply('ok, confirmado').action).toBe('confirm');
  });

  test('reconhece reagendamento por número e variações', () => {
    expect(parseScheduleReply('2').action).toBe('reschedule');
    expect(parseScheduleReply('quero reagendar').action).toBe('reschedule');
    expect(parseScheduleReply('outro horário').action).toBe('reschedule');
  });

  test('reconhece cancelamento por número e variações', () => {
    expect(parseScheduleReply('3').action).toBe('cancel');
    expect(parseScheduleReply('cancelar').action).toBe('cancel');
    expect(parseScheduleReply('não').action).toBe('cancel');
  });

  test('quando aguardando escolha, interpreta 1/2/3 como slot', () => {
    const out = parseScheduleReply('2', { awaitingRescheduleChoice: true });
    expect(out.action).toBe('reschedule_choice');
    expect(out.choice).toBe(2);
  });

  test('retorna unknown para texto irrelevante', () => {
    expect(parseScheduleReply('bom dia').action).toBe('unknown');
  });
});
