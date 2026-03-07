'use strict';

function normalizeText(raw) {
  const input = String(raw || '').trim().toLowerCase();
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text === keyword || text.includes(keyword));
}

function parseScheduleReply(rawText, options = {}) {
  const normalizedText = normalizeText(rawText);
  const awaitingRescheduleChoice = options.awaitingRescheduleChoice === true;

  if (!normalizedText) {
    return {
      action: 'unknown',
      normalizedText,
      choice: null,
    };
  }

  if (awaitingRescheduleChoice) {
    const m = normalizedText.match(/\b([1-3])\b/);
    if (m) {
      return {
        action: 'reschedule_choice',
        normalizedText,
        choice: Number(m[1]),
      };
    }
  }

  const confirmKeywords = [
    '1',
    'confirmar',
    'confirmo',
    'ok',
    'sim',
    'confirmado',
  ];
  const rescheduleKeywords = [
    '2',
    'reagendar',
    'remarcar',
    'trocar',
    'outro horario',
    'outro horario por favor',
  ];
  const cancelKeywords = [
    '3',
    'cancelar',
    'cancela',
    'nao',
    'desmarcar',
  ];

  if (hasAnyKeyword(normalizedText, confirmKeywords)) {
    return { action: 'confirm', normalizedText, choice: null };
  }
  if (hasAnyKeyword(normalizedText, rescheduleKeywords)) {
    return { action: 'reschedule', normalizedText, choice: null };
  }
  if (hasAnyKeyword(normalizedText, cancelKeywords)) {
    return { action: 'cancel', normalizedText, choice: null };
  }

  return {
    action: 'unknown',
    normalizedText,
    choice: null,
  };
}

module.exports = {
  normalizeText,
  parseScheduleReply,
};
