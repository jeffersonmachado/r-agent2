'use strict';

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

function pushFact(facts, fact) {
  if (!fact || !fact.key || !fact.value) return;
  const key = `${fact.key}::${String(fact.value).toLowerCase()}`;
  const exists = facts.some((item) => `${item.key}::${String(item.value).toLowerCase()}` === key);
  if (!exists) facts.push(fact);
}

function extractConversationFacts({ text, message = {} } = {}) {
  const raw = safeText(text || message.text);
  if (!raw) return [];

  const facts = [];

  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) {
    pushFact(facts, {
      key: 'customer_email',
      value: String(email[0]).toLowerCase(),
      confidence: 0.95,
      source: 'regex',
    });
  }

  const phone = raw.match(/(\+?\d[\d\s().-]{9,}\d)/);
  if (phone) {
    const digits = String(phone[1]).replace(/\D/g, '');
    if (digits.length >= 10) {
      pushFact(facts, {
        key: 'customer_phone',
        value: digits,
        confidence: 0.9,
        source: 'regex',
      });
    }
  }

  const orderId = raw.match(/\b(?:pedido|ordem|order)\s*#?\s*([A-Z0-9-]{4,})\b/i);
  if (orderId) {
    pushFact(facts, {
      key: 'order_reference',
      value: String(orderId[1]).toUpperCase(),
      confidence: 0.88,
      source: 'regex',
    });
  }

  const name = raw.match(/\b(?:meu nome [eé]|me chamo|eu sou)\s+([A-Za-zÀ-ÿ'\- ]{2,60})\b/i);
  if (name) {
    pushFact(facts, {
      key: 'customer_name',
      value: safeText(name[1]),
      confidence: 0.8,
      source: 'regex',
    });
  }

  const low = raw.toLowerCase();
  if (/\b(cancelar|cancelamento|cancelei)\b/.test(low)) {
    pushFact(facts, { key: 'intent', value: 'cancelamento', confidence: 0.7, source: 'heuristic' });
  }
  if (/\b(agendar|agendamento|horario|marcar)\b/.test(low)) {
    pushFact(facts, { key: 'intent', value: 'agendamento', confidence: 0.7, source: 'heuristic' });
  }
  if (/\b(pagamento|pagar|pix|boleto|cartao)\b/.test(low)) {
    pushFact(facts, { key: 'intent', value: 'pagamento', confidence: 0.68, source: 'heuristic' });
  }
  if (/\b(reclam|problema|erro|falha|nao funciona)\b/.test(low)) {
    pushFact(facts, { key: 'sentiment', value: 'negative_signal', confidence: 0.62, source: 'heuristic' });
  }

  return facts;
}

module.exports = {
  extractConversationFacts,
};
