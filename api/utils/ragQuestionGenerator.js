/**
 * Gerador determinístico de perguntas (FAQ) a partir de texto.
 *
 * Espelhado do util do frontend (`frontend/src/utils/ragQuestionGenerator.js`)
 * para permitir uso no backend (ex.: ranking/clusterização com embeddings).
 */

function getDefaultQuestionGenerationRules() {
  return {
    titleBased: {
      enabled: true,
      minTitleLength: 3,
      excludedWords: ['como', 'para', 'sobre', 'guia', 'manual', 'documento', 'arquivo', 'studio', 'stúdio'],
      templates: ['O que é {{mainTopic}}?', 'Como funciona {{mainTopic}}?'],
      maxQuestionsFromTitle: 2,
    },
    keywordPatterns: {
      enabled: true,
      patterns: [
        {
          pattern: '\\bpagamento\\b|\\bpayment\\b|\\bpagar\\b|\\bpix\\b|\\bcomprovante\\b',
          questions: ['Quais formas de pagamento são aceitas?', 'Posso pagar via PIX?', 'Como enviar o comprovante?', 'Qual é a chave PIX?'],
        },
        {
          pattern: '\\bwhatsapp\\b|\\btelefone\\b|\\bcontato\\b|\\bsite\\b',
          questions: ['Qual é o WhatsApp?', 'Qual é o telefone?', 'Qual é o site?', 'Como entrar em contato?'],
        },
        {
          pattern: 'hor[aá]rio|\\bhorarios\\b|\\bfuncionamento\\b|\\bgrade\\b|\\bagenda\\b|\\b\\d{1,2}:\\d{2}\\b',
          questions: ['Qual é o horário de funcionamento?', 'Quais são os horários durante a semana?', 'Abre aos sábados?', 'Funciona aos domingos?'],
        },
        {
          pattern: '\\bplano\\b|\\bplanos\\b|\\bmensal\\b|\\bsemestral\\b|\\banual\\b',
          questions: ['Quais planos estão disponíveis?', 'Quanto custa o plano mensal?', 'Existem planos semestrais?', 'Existem planos anuais?'],
        },
        {
          pattern: '\\bvalor\\b|\\bvalores\\b|pre[cç]o|\\bprecos\\b|\\br\\$\\b',
          questions: ['Quais são os valores?', 'Quais são os preços dos planos?'],
        },
        {
          pattern: 'black\\s*friday|promo[cç][aã]o|\\bdesconto\\b|\\boferta\\b',
          questions: ['Existe promoção de Black Friday?', 'Até quando vai a promoção?'],
        },
        {
          pattern: '\\bfisioterapia\\b|\\bfisio\\b|sess[aã]o|sess[oõ]es|\\bpacote\\b',
          questions: ['Quanto custa uma sessão de fisioterapia?', 'Quanto custa o pacote com 5 sessões?', 'Quanto custa o pacote com 10 sessões?'],
        },
        {
          pattern: '\\bpilates\\b|bal[eé]|\\bcrossfit\\b|\\bfuncional\\b',
          questions: ['Quais modalidades estão disponíveis?'],
        },
      ],
    },
    domainCoverage: {
      /**
       * Regras para gerar perguntas "tipo ChatGPT" por cobertura de domínio,
       * a partir de entidades/padrões explícitos no texto (modalidades, horários, planos etc.).
       *
       * É determinístico e só adiciona perguntas quando encontra gatilhos no conteúdo/título.
       */
      enabled: true,
      entities: {
        // Modalidades/serviços devem ser inferidos do contexto do tenant (ver questionGenerationRules.service).
        // Mantemos vazio no default para evitar "domínio fixo" por código.
        modalities: [],
      },
      templates: {
        business: ['O que é {{business}}?', 'Quais serviços {{business}} oferece?', 'Quais modalidades estão disponíveis?'],
        hoursGeneric: [
          'Qual é o horário de funcionamento?',
          'Quais são os horários durante a semana?',
          'Abre aos sábados?',
          'Funciona aos domingos?',
        ],
        hoursByModality: ['Quais são os horários de {{modality}}?', 'Como consultar a grade de horários de {{modality}}?'],
        plans: [
          'Quais planos estão disponíveis?',
          'Quanto custa o plano mensal?',
          'Existem planos semestrais?',
          'Existem planos anuais?',
        ],
        pricingGeneric: ['Quais são os valores?', 'Quais são os preços dos planos?'],
        pricingByModality: ['Qual o valor de {{modality}}?'],
        balletPricing: ['Qual o valor do balé 1x por semana?', 'Qual o valor do balé 2x por semana?'],
        physioPackages: [
          'Quanto custa uma sessão de fisioterapia?',
          'Quanto custa o pacote com 5 sessões?',
          'Quanto custa o pacote com 10 sessões?',
        ],
        promotions: ['Existe promoção de Black Friday?', 'Até quando vai a promoção?', 'Qual o valor promocional do pilates?'],
        payment: [
          'Quais formas de pagamento são aceitas?',
          'Posso pagar via PIX?',
          'Qual é a chave PIX?',
          'Como enviar o comprovante?',
          'Para qual WhatsApp envio o comprovante?',
        ],
        contact: ['Qual é o WhatsApp?', 'Qual é o telefone?', 'Qual é o site?', 'Como entrar em contato?'],
        rules: ['Quais são as regras básicas?', 'Quais dados devo informar no pagamento (nome do aluno etc.)?'],
      },
      triggers: {
        hours: ['horário', 'horarios', 'funcionamento', 'grade'],
        plans: ['plano', 'planos', 'mensal', 'semestral', 'anual'],
        pricing: ['valor', 'valores', 'preço', 'precos', 'r$'],
        promotions: ['black friday', 'promo', 'promoc', 'desconto', 'oferta'],
        payment: ['pix', 'comprovante', 'pagamento', 'pagar'],
        contact: ['whatsapp', 'telefone', 'site', 'contato'],
        rules: ['comprovante', 'nome do aluno', 'nome do(a) aluno', 'aluno', 'enviar o comprovante', 'envio do comprovante'],
      },
    },
    contentBased: {
      enabled: true,
      minContentLength: 50,
      actionVerbs: ['acesse', 'clique', 'selecione', 'digite', 'insira', 'configure', 'ativar', 'desativar'],
      sentenceFilters: { minLength: 20, maxLength: 150 },
      maxSentencesToProcess: 3,
      questionTemplate: 'Como {{action}}?',
      fallbackEnabled: true,
      fallbackMaxSentences: 2,
      fallbackMinLength: 20,
      fallbackMaxLength: 100,
    },
    deduplication: {
      enabled: true,
      similarityThreshold: 0.8,
      normalizeForComparison: true,
    },
    limits: {
      maxQuestionsPerDocument: 45,
      maxQuestionsFromTitle: 2,
      maxQuestionsFromKeywords: 25,
      maxQuestionsFromContent: 10,
    },
  };
}

function calculateSimilarity(str1, str2) {
  const words1 = String(str1 || '').split(/\s+/).filter(Boolean);
  const words2 = String(str2 || '').split(/\s+/).filter(Boolean);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function isValidQuestionBasic(question) {
  if (typeof question !== 'string') return false;
  const q = question.trim();
  if (!q) return false;
  if (q.length < 8) return false;
  if (q.length > 220) return false;

  // Evita placeholders/metadados comuns
  if (/\[imagem:.*?\]/i.test(q)) return false;
  if (/texto extraído.*ocr/i.test(q)) return false;
  if (/jpeg.*texto extraído/i.test(q)) return false;

  // Evita duplicação evidente (OCR/ruído): "semana semana", "valor valor"
  if (/\b([\p{L}]{3,})\s+\1\b/iu.test(q)) return false;

  // Evita frases truncadas no final (ex.: "bem-estar fí?")
  // Importante: o padrão precisa garantir que o *último token* tenha 1–2 letras (não apenas os
  // últimos 1–2 caracteres da palavra final), senão rejeita perguntas normais como "oferece?".
  if (/(^|[^\p{L}])[\p{L}]{1,2}\?\s*$/iu.test(q)) return false;

  // Evita alguns bigramas típicos de OCR quebrado (best-effort)
  if (/\b(cada\s+fica|faca\s+plano)\b/i.test(q)) return false;

  // Evita URLs e nomes de arquivos (ruído técnico)
  if (/https?:\/\/\S+/i.test(q)) return false;
  if (
    /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:pdf|jpe?g|png|gif|webp|bmp|tiff|svg|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/i.test(q)
  ) {
    return false;
  }
  if (/\b[\w.-]{3,}\.(?:pdf|jpe?g|png|gif|webp|bmp|tiff|svg|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/i.test(q)) {
    return false;
  }

  // UUIDs muito curtos
  const uuidInTextPattern = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
  if (uuidInTextPattern.test(q) && q.length < 50) return false;

  // Muitos símbolos
  const alphanumericCount = (q.match(/[a-záàâãéêíóôõúç0-9]/gi) || []).length;
  const totalChars = q.replace(/\s/g, '').length;
  if (totalChars > 0 && alphanumericCount / totalChars < 0.6) return false;

  return true;
}

function parseQuestionsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function mergeUniqueQuestions(existing, toAdd, maxItems = 50) {
  const out = [];
  const seen = new Set();
  const push = (q) => {
    if (!isValidQuestionBasic(q)) return;
    const normalized = q.trim();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  (Array.isArray(existing) ? existing : []).forEach(push);
  (Array.isArray(toAdd) ? toAdd : []).forEach(push);
  return out.slice(0, maxItems);
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = String(v || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function containsToken(normalizedText, token) {
  const t = normalizeForMatch(token).trim();
  if (!t) return false;
  // Normalizado (ASCII-ish) para evitar problemas com \b em unicode.
  const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
  return re.test(normalizedText);
}

function matchAnyTrigger(textLower, triggers) {
  const list = Array.isArray(triggers) ? triggers : [];
  for (const t of list) {
    const needle = String(t || '').toLowerCase().trim();
    if (!needle) continue;
    if (textLower.includes(needle)) return true;
  }
  return false;
}

function detectModalities(textLower, domainCoverage) {
  const mods = domainCoverage?.entities?.modalities;
  if (!Array.isArray(mods) || mods.length === 0) return [];
  const normalizedText = normalizeForMatch(textLower);
  const found = [];
  for (const m of mods) {
    const label = String(m?.label || '').trim();
    const patterns = Array.isArray(m?.patterns) ? m.patterns : [];
    if (!label || patterns.length === 0) continue;
    for (const p of patterns) {
      if (containsToken(normalizedText, p)) {
        found.push(label);
        break;
      }
    }
  }
  return uniqStrings(found);
}

function applyDomainCoverageQuestions({ questions, titleStr, contentStr, rules }) {
  const dc = rules?.domainCoverage;
  if (!dc?.enabled) return;

  const textLower = `${String(titleStr || '').toLowerCase()}\n${String(contentStr || '').toLowerCase()}`;
  const normalizedText = normalizeForMatch(textLower);
  const templates = dc.templates || {};
  const triggers = dc.triggers || {};

  const add = (q) => {
    if (isValidQuestionBasic(q)) questions.push(q);
  };

  // Se existe um "nome" de negócio (ex.: tenant name no aggregated), ajuda.
  const business = String(titleStr || '').trim();
  if (business && business.length >= 3 && business.length <= 80 && !/\.[a-z]{2,6}$/i.test(business)) {
    if (Array.isArray(templates.business)) {
      templates.business.forEach((t) => add(String(t).replace(/\{\{business\}\}/g, business)));
    }
  }

  const modalities = detectModalities(textLower, dc);
  const hasHours = matchAnyTrigger(textLower, triggers.hours) || /\b\d{1,2}:\d{2}\b/.test(textLower);
  const hasPlans = matchAnyTrigger(textLower, triggers.plans);
  const hasPricing = matchAnyTrigger(textLower, triggers.pricing) || /\br\$\s*\d/.test(textLower);
  const hasPromos = matchAnyTrigger(textLower, triggers.promotions);
  const hasPayment = matchAnyTrigger(textLower, triggers.payment);
  const hasContact = matchAnyTrigger(textLower, triggers.contact);
  const hasRules = matchAnyTrigger(textLower, triggers.rules);

  // Priorização: perguntas "macro" primeiro (para não estourar limite só com variações por modalidade)
  if (hasHours && Array.isArray(templates.hoursGeneric)) templates.hoursGeneric.forEach(add);
  if (hasPlans && Array.isArray(templates.plans)) templates.plans.forEach(add);
  if (hasPricing && Array.isArray(templates.pricingGeneric)) templates.pricingGeneric.forEach(add);
  if (hasPromos && Array.isArray(templates.promotions)) templates.promotions.forEach(add);
  if (hasPayment && Array.isArray(templates.payment)) templates.payment.forEach(add);
  if (hasContact && Array.isArray(templates.contact)) templates.contact.forEach(add);
  if (hasRules && Array.isArray(templates.rules)) templates.rules.forEach(add);

  // Casos especiais (Balé / Fisioterapia) se as palavras aparecem
  if (containsToken(normalizedText, 'bale') && Array.isArray(templates.balletPricing)) templates.balletPricing.forEach(add);
  if ((containsToken(normalizedText, 'fisioterapia') || containsToken(normalizedText, 'fisio')) && Array.isArray(templates.physioPackages)) {
    templates.physioPackages.forEach(add);
  }

  // Modalidades (por último) - gera menos variações por modalidade para preservar diversidade
  const topModalities = modalities.slice(0, 6);
  if (topModalities.length > 0) {
    if (hasHours && Array.isArray(templates.hoursByModality) && templates.hoursByModality.length > 0) {
      const t = templates.hoursByModality[0]; // 1 template por modalidade
      for (const mod of topModalities) add(String(t).replace(/\{\{modality\}\}/g, mod));
    }
    if (hasPricing && Array.isArray(templates.pricingByModality) && templates.pricingByModality.length > 0) {
      const t = templates.pricingByModality[0]; // 1 template por modalidade
      for (const mod of topModalities) add(String(t).replace(/\{\{modality\}\}/g, mod));
    }
  }
}

function generateQuestionsFromContent(title, content, rulesInput) {
  const titleStr = typeof title === 'string' ? title : '';
  const contentStr = typeof content === 'string' ? content : '';
  const titleLower = titleStr.toLowerCase();
  const contentLower = contentStr.toLowerCase();

  const rules = rulesInput || getDefaultQuestionGenerationRules();
  const questions = [];

  // Título
  if (rules.titleBased?.enabled && titleStr) {
    const excludedWords = rules.titleBased.excludedWords || [];
    const minTitleLength = rules.titleBased.minTitleLength || 3;
    const titleWords = titleStr
      .split(/\s+/)
      .filter((w) => w.length >= minTitleLength && !excludedWords.includes(w.toLowerCase()));

    if (titleWords.length > 0) {
      const mainTopic = titleWords[0];
      // Evita "O que é X?" com tokens curtos (ex.: "Oly") quando o título tem mais contexto.
      if (mainTopic.length < 5 && titleStr.split(/\s+/).filter(Boolean).length > 1) {
        // skip
      } else {
      const templates = rules.titleBased.templates || [];
      const maxFromTitle = rules.titleBased.maxQuestionsFromTitle || 2;
      templates.slice(0, maxFromTitle).forEach((template) => {
        const question = template.replace(/\{\{mainTopic\}\}/g, mainTopic);
        if (isValidQuestionBasic(question)) questions.push(question);
      });
      }
    }
  }

  // Cobertura de domínio (perguntas estilo ChatGPT baseadas em gatilhos/entidades no texto)
  // Rodamos cedo para priorizar perguntas "reais" antes de perguntas genéricas.
  applyDomainCoverageQuestions({ questions, titleStr, contentStr, rules });

  // Palavras-chave
  if (rules.keywordPatterns?.enabled && Array.isArray(rules.keywordPatterns.patterns)) {
    const maxFromKeywords = rules.limits?.maxQuestionsFromKeywords || 10;
    let count = 0;
    for (const patternConfig of rules.keywordPatterns.patterns) {
      if (count >= maxFromKeywords) break;
      const regex = new RegExp(patternConfig.pattern, 'i');
      if (regex.test(contentLower) || regex.test(titleLower)) {
        (patternConfig.questions || []).forEach((q) => {
          if (count >= maxFromKeywords) return;
          if (isValidQuestionBasic(q)) {
            questions.push(q);
            count += 1;
          }
        });
      }
    }
  }

  // Conteúdo
  if (rules.contentBased?.enabled) {
    const minContentLength = rules.contentBased.minContentLength || 50;
    const maxFromContent = rules.limits?.maxQuestionsFromContent || 5;
    if (contentStr.length >= minContentLength) {
      const actionVerbs = rules.contentBased.actionVerbs || [];
      const filters = rules.contentBased.sentenceFilters || { minLength: 20, maxLength: 150 };
      const maxSentences = rules.contentBased.maxSentencesToProcess || 3;
      const questionTemplate = rules.contentBased.questionTemplate || 'Como {{action}}?';

      const sentences = contentStr
        .split(/[.!?]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= filters.minLength && s.length <= filters.maxLength);

      let contentCount = 0;
      for (const sentence of sentences.slice(0, maxSentences)) {
        if (contentCount >= maxFromContent) break;
        const sentenceLower = sentence.toLowerCase().trim();
        for (const verb of actionVerbs) {
          if (sentenceLower.startsWith(verb)) {
            const action = sentence.replace(/^[^\w]*\w+\s+/, '').trim();
            if (action.length > 10 && action.length < 80) {
              const fullQuestion = questionTemplate.replace(/\{\{action\}\}/g, action);
              if (isValidQuestionBasic(fullQuestion)) {
                questions.push(fullQuestion);
                contentCount += 1;
              }
            }
            break;
          }
        }
      }

      // Fallback simples
      if (rules.contentBased.fallbackEnabled && questions.length < 3 && sentences.length > 0) {
        const fallbackMax = rules.contentBased.fallbackMaxSentences || 2;
        const fallbackMin = rules.contentBased.fallbackMinLength || 20;
        const fallbackMaxLen = rules.contentBased.fallbackMaxLength || 100;
        for (const sentence of sentences.slice(0, fallbackMax)) {
          const trimmed = sentence.trim();
          if (trimmed.length >= fallbackMin && trimmed.length <= fallbackMaxLen) {
            const candidate = trimmed.includes('?') ? trimmed : `${trimmed}?`;
            if (isValidQuestionBasic(candidate)) questions.push(candidate);
          }
        }
      }
    }
  }

  // Dedup + limite
  const maxQuestions = rules.limits?.maxQuestionsPerDocument || 5;
  if (rules.deduplication?.enabled) {
    const unique = [];
    const seen = new Set();
    const threshold = rules.deduplication.similarityThreshold || 0.8;
    for (const q of questions) {
      const qLower = q.toLowerCase().trim();
      const normalized = rules.deduplication.normalizeForComparison
        ? qLower.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ')
        : qLower;
      let dup = false;
      for (const prev of seen) {
        if (calculateSimilarity(normalized, prev) > threshold) {
          dup = true;
          break;
        }
      }
      if (!dup && isValidQuestionBasic(q)) {
        unique.push(q);
        seen.add(normalized);
      }
      if (unique.length >= maxQuestions) break;
    }
    return unique.slice(0, maxQuestions);
  }

  return questions.filter(isValidQuestionBasic).slice(0, maxQuestions);
}

function looksLikeDigitalBusinessToken(s) {
  const t = String(s || '').toLowerCase();
  return (
    t.includes('login') ||
    t.includes('cadastro') ||
    t.includes('criar conta') ||
    t.includes('minha conta') ||
    t.includes('dashboard') ||
    t.includes('painel') ||
    t.includes('saas') ||
    t.includes('api') ||
    t.includes('assinatura')
  );
}

function normalizeForDedupe(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s?]/gu, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Gera perguntas a partir de um contexto semântico estruturado.
 *
 * @param {{
 *  context: {
 *    keyPhrases?: string[],
 *    services?: string[],
 *    prices?: string[],
 *    schedules?: string[],
 *    contacts?: string[],
 *    paymentMethods?: string[],
 *    locations?: string[],
 *    entities?: string[],
 *  },
 *  businessType?: 'physical'|'digital'|'hybrid',
 *  limits?: { maxQuestions?: number, minQuestionsIfRich?: number }
 * }} input
 */
function generateQuestionsFromContext(input = {}) {
  const ctx = input?.context || {};
  const businessType = (input?.businessType === 'digital' || input?.businessType === 'hybrid') ? input.businessType : 'physical';
  const maxQuestions = Math.max(10, Math.min(120, Number(input?.limits?.maxQuestions) || 80));
  const minQuestionsIfRich = Math.max(10, Math.min(60, Number(input?.limits?.minQuestionsIfRich) || 20));

  const services = Array.isArray(ctx.services) ? ctx.services : [];
  const prices = Array.isArray(ctx.prices) ? ctx.prices : [];
  const schedules = Array.isArray(ctx.schedules) ? ctx.schedules : [];
  const contacts = Array.isArray(ctx.contacts) ? ctx.contacts : [];
  const paymentMethods = Array.isArray(ctx.paymentMethods) ? ctx.paymentMethods : [];
  const locations = Array.isArray(ctx.locations) ? ctx.locations : [];
  const keyPhrases = Array.isArray(ctx.keyPhrases) ? ctx.keyPhrases : [];

  // “X” = entidade/negócio: preferir keyPhrase mais informativa, senão serviço, senão genérico
  const businessLabel =
    (keyPhrases.find((p) => String(p || '').trim().length >= 6) || services[0] || 'este negócio').toString().trim();

  const out = [];
  const push = (q) => {
    const s = String(q || '').trim();
    if (!s) return;
    if (!s.endsWith('?')) return;
    // regra: não gerar “criar conta” fora de digital/hybrid
    if (businessType !== 'digital' && looksLikeDigitalBusinessToken(s)) return;
    out.push(s);
  };

  // Sobre o negócio
  push(`O que é ${businessLabel}?`);
  push(`Quais serviços ${businessLabel} oferece?`);
  if (locations.length > 0) push(`Onde fica ${businessLabel}?`);
  else push(`Como obter mais informações sobre ${businessLabel}?`);

  // Serviços
  const topServices = services.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 18);
  for (const service of topServices) {
    push(`O que é ${service}?`);
    push(`Como funciona ${service}?`);
    push(`Tem ${service}?`);
  }

  // Horários
  if (schedules.length > 0) {
    push('Quais são os horários de funcionamento?');
    push('Funciona aos sábados?');
    push('Funciona aos domingos?');
  }

  // Valores
  if (prices.length > 0) {
    push('Quanto custa?');
    push('Tem pacotes?');
    push('Quais valores estão disponíveis?');
  }

  // Pagamento
  if (paymentMethods.length > 0) {
    push('Quais formas de pagamento são aceitas?');
    if (paymentMethods.some((p) => normalizeForDedupe(p).includes('pix'))) push('Aceita PIX?');
    push('Como pagar?');
  }

  // Contato
  if (contacts.length > 0) {
    push('Qual é o telefone?');
    push('Qual é o WhatsApp?');
    push('Qual é o Instagram?');
    push('Como entrar em contato?');
  }

  // Localização
  if (locations.length > 0) {
    push('Qual é o endereço?');
    push('Como chegar?');
  }

  // Digital (somente quando digital/hybrid)
  if (businessType === 'digital' || businessType === 'hybrid') {
    push('Como fazer login?');
    push('Como criar uma conta?');
    push('Quais planos estão disponíveis?');
  }

  // Reforço com keyPhrases (gera variações específicas)
  const topPhrases = keyPhrases.map((p) => String(p || '').trim()).filter((p) => p.length >= 6).slice(0, 10);
  for (const p of topPhrases) {
    push(`Como funciona ${p}?`);
    push(`Quanto custa ${p}?`);
    push(`Como contratar ${p}?`);
  }

  // Dedupe textual (conservador)
  const deduped = [];
  const seen = new Set();
  for (const q of out) {
    const k = normalizeForDedupe(q);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(q);
    if (deduped.length >= maxQuestions) break;
  }

  // Mínimo 20 “se houver contexto suficiente”
  const richnessScore =
    (services.length ? 1 : 0) +
    (prices.length ? 1 : 0) +
    (schedules.length ? 1 : 0) +
    (contacts.length ? 1 : 0) +
    (paymentMethods.length ? 1 : 0) +
    (locations.length ? 1 : 0) +
    (keyPhrases.length ? 1 : 0);

  const isRich = richnessScore >= 3;
  if (isRich && deduped.length < minQuestionsIfRich) {
    // Adiciona variações “macro” para atingir diversidade sem inventar domínio.
    const fillers = [
      'Quais são as principais opções disponíveis?',
      'Como funciona o atendimento?',
      'É necessário agendar?',
      'Existe suporte por WhatsApp?',
      'Há condições especiais ou promoções?',
      'Como solicitar um orçamento?',
      'Como tirar dúvidas antes de contratar?',
      'Quais documentos ou informações são necessários?',
      'Existe política de cancelamento?',
      'Qual o prazo de resposta?',
      'Como acompanhar o status do atendimento/serviço?',
      'Quais são as regras e orientações gerais?',
    ];
    for (const f of fillers) {
      const q = f.endsWith('?') ? f : `${f}?`;
      const k = normalizeForDedupe(q);
      if (!seen.has(k)) {
        if (businessType !== 'digital' && looksLikeDigitalBusinessToken(q)) continue;
        seen.add(k);
        deduped.push(q);
      }
      if (deduped.length >= minQuestionsIfRich) break;
    }
  }

  return deduped.slice(0, maxQuestions);
}

module.exports = {
  getDefaultQuestionGenerationRules,
  parseQuestionsFromText,
  mergeUniqueQuestions,
  generateQuestionsFromContent,
  generateQuestionsFromContext,
};

