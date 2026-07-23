'use strict';

/**
 * Learning Core — Anonymizer (núcleo puro, zero I/O).
 *
 * PII scrubbing determinístico para transformar dados de replays reais em
 * material de treinamento. Duas camadas, ambas explícitas (não é inferência):
 *
 *  1. Chaves sensíveis (SENSITIVE_KEYS): o valor é substituído por um
 *     placeholder tipado, independente do conteúdo.
 *  2. Padrões em strings (PATTERNS): e-mail, telefone BR, CPF, CNPJ, cartão
 *     e tokens longos são mascarados onde quer que apareçam.
 *
 * Estrutura, tipos e ids técnicos curtos são preservados (o treinamento
 * precisa permanecer útil). Nada aqui tenta "adivinhar" nomes próprios:
 * nome pessoal só é mascarado quando viaja em chave sensível declarada
 * (name/nome/cliente/responsavel...).
 *
 * Retorna sempre { value, stats } com contagem de redactions por kind —
 * auditável em testes e no pipeline.
 */

const SENSITIVE_KEYS = new Map([
  ['nome', '[nome]'], ['name', '[nome]'], ['username', '[usuario]'],
  ['usuario', '[usuario]'], ['user', '[usuario]'], ['login', '[usuario]'],
  ['cliente', '[nome]'], ['customer', '[nome]'], ['responsavel', '[nome]'],
  ['email', '[email]'], ['e-mail', '[email]'],
  ['phone', '[telefone]'], ['telefone', '[telefone]'], ['celular', '[telefone]'],
  ['whatsapp', '[telefone]'], ['mobile', '[telefone]'],
  ['cpf', '[documento]'], ['cnpj', '[documento]'], ['document', '[documento]'],
  ['documento', '[documento]'], ['rg', '[documento]'],
  ['password', '[credencial]'], ['senha', '[credencial]'], ['token', '[credencial]'],
  ['secret', '[credencial]'], ['apikey', '[credencial]'], ['api_key', '[credencial]'],
  ['authorization', '[credencial]'],
  ['address', '[endereco]'], ['endereco', '[endereco]'], ['logradouro', '[endereco]'],
  ['card', '[cartao]'], ['cartao', '[cartao]'], ['cvv', '[cartao]'],
  ['birthdate', '[data]'], ['data_nascimento', '[data]'], ['nascimento', '[data]'],
]);

// Ordem importa: padrões mais específicos primeiro (cartão/CNPJ/CPF antes de
// telefone, que é o mais genérico).
const PATTERNS = [
  { kind: 'credencial', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, placeholder: '[credencial]' },
  { kind: 'credencial', regex: /\b(?:bearer|token|apikey|api_key)[\s:=[\]"']*[A-Za-z0-9_\-./+]{16,}/gi, placeholder: '[credencial]' },
  { kind: 'cartao', regex: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g, placeholder: '[cartao]' },
  { kind: 'documento', regex: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, placeholder: '[documento]' },
  { kind: 'documento', regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, placeholder: '[documento]' },
  { kind: 'email', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, placeholder: '[email]' },
  { kind: 'telefone', regex: /(?:\+?55[-.\s]?)?(?:\(?\d{2}\)?[-.\s]?)?9?\d{4}[-.\s]?\d{4}/g, placeholder: '[telefone]' },
];

/**
 * Classifica campos de formulário por atributos declarados (selector/step) —
 * regra estrutural determinística de domínio RPA, não inferência semântica.
 * Retorna o placeholder adequado ou null quando não há sinal de campo
 * sensível.
 */
function classifyFormField({ selector, step } = {}) {
  const signal = `${selector || ''} ${step || ''}`.toLowerCase();
  if (!signal.trim()) return null;
  if (/password|senha|secret|token/.test(signal)) return '[credencial]';
  if (/email|e-mail/.test(signal)) return '[email]';
  if (/cpf|cnpj|document/.test(signal)) return '[documento]';
  if (/phone|telefone|celular|whatsapp|mobile/.test(signal)) return '[telefone]';
  if (/user|usuario|login/.test(signal)) return '[usuario]';
  if (/name|nome|cliente|customer/.test(signal)) return '[nome]';
  if (/card|cartao|cvv/.test(signal)) return '[cartao]';
  return null;
}

function redactString(input, stats) {
  let output = input;
  for (const { kind, regex, placeholder } of PATTERNS) {
    output = output.replace(regex, (match) => {
      stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;
      stats.redactions += 1;
      return placeholder;
    });
  }
  return output;
}

function anonymizeAny(value, stats, keyHint) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (keyHint && SENSITIVE_KEYS.has(keyHint)) {
      if (value.length === 0) return value;
      const placeholder = SENSITIVE_KEYS.get(keyHint);
      stats.byKind.chave_sensivel = (stats.byKind.chave_sensivel || 0) + 1;
      stats.redactions += 1;
      return placeholder;
    }
    return redactString(value, stats);
  }

  if (Array.isArray(value)) {
    return value.map((item) => anonymizeAny(item, stats, null));
  }

  if (typeof value === 'object') {
    // Ação de replay RPA: valores preenchidos (fill) são sempre dados do
    // usuário — mascarados com placeholder classificado pelo campo.
    if (value.type === 'fill' && typeof value.value === 'string' && value.value.length > 0) {
      const placeholder = classifyFormField(value) || '[valor]';
      stats.byKind.campo_preenchido = (stats.byKind.campo_preenchido || 0) + 1;
      stats.redactions += 1;
      const clone = {};
      for (const [key, item] of Object.entries(value)) {
        clone[key] = key === 'value' ? placeholder : anonymizeAny(item, stats, null);
      }
      return clone;
    }

    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = String(key).toLowerCase().replace(/[^a-z_\-]/g, '');
      result[key] = anonymizeAny(item, stats, normalizedKey);
    }
    return result;
  }

  return value;
}

/**
 * Anonimiza qualquer valor JSON-serializável.
 *
 * @param {*} input
 * @returns {{ value: *, stats: { redactions: number, byKind: Object<string, number> } }}
 */
function anonymize(input) {
  const stats = { redactions: 0, byKind: {} };
  const value = anonymizeAny(input, stats, null);
  return { value, stats };
}

module.exports = {
  anonymize,
  classifyFormField,
  SENSITIVE_KEYS,
  PATTERNS,
};
