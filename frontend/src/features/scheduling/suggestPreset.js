import { SCHEDULING_PRESET_IDS } from './schedulingPresets';

function normalizeText(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function includesAny(text, needles = []) {
  return needles.some((needle) => text.includes(needle));
}

export function suggestSchedulingPreset({ messages = [], contextType = '', purpose = '', notes = '', channel = '' } = {}) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.map((msg) => String(msg || '').trim()).filter(Boolean)
    : [];
  if (normalizedMessages.length === 0) return null;

  const mergedText = normalizeText([
    purpose,
    notes,
    contextType,
    channel,
    ...normalizedMessages,
  ].join(' '));

  if (!mergedText.trim()) return null;

  if (includesAny(mergedText, ['janela', 'entre', 'qualquer horario', 'assim que possivel', 'faixa de horario'])) {
    return {
      suggestedPreset: SCHEDULING_PRESET_IDS.INTELIGENTE_IA_DECIDE,
      confidence: 0.78,
      reason: 'mensagem indica janela de horário flexível',
    };
  }

  if (includesAny(mergedText, ['confirm', 'confirmacao', 'confirma', 'confirmar presenca'])) {
    return {
      suggestedPreset: SCHEDULING_PRESET_IDS.COM_CONFIRMACAO,
      confidence: 0.82,
      reason: 'mensagem sugere confirmação prévia',
    };
  }

  if (includesAny(mergedText, ['time comercial', 'equipe', 'responsavel', 'owner', 'atendente'])) {
    return {
      suggestedPreset: SCHEDULING_PRESET_IDS.HUMANO_AGENDADO,
      confidence: 0.74,
      reason: 'mensagem sugere alocação humana/equipe',
    };
  }

  if (includesAny(mergedText, ['workflow', 'automatic', 'automatica', 'sistema', 'processo'])) {
    return {
      suggestedPreset: SCHEDULING_PRESET_IDS.PROCESSO_AUTOMATICO,
      confidence: 0.76,
      reason: 'mensagem sugere execução automática',
    };
  }

  if (includesAny(mergedText, ['retorno', 'follow up', 'follow-up', 'avisar', 'lembrar'])) {
    return {
      suggestedPreset: SCHEDULING_PRESET_IDS.CONTATO_AUTOMATICO,
      confidence: 0.71,
      reason: 'mensagem sugere contato rápido de retorno',
    };
  }

  return null;
}
