const logger = require('../utils/logger');
const { generateAiResponse } = require('./aiProviderService');
const { updateTenant, getTenant } = require('./tenantService');
const faqGeneratorService = require('./faqGeneratorService');

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeExclusions(exclusions) {
  const ex = Array.isArray(exclusions) ? exclusions : [];
  return ex
    .map((t) => safeString(t).trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

function findMatchedExclusionTerm(text, loweredTerms) {
  const s = safeString(text).toLowerCase();
  if (!s || !Array.isArray(loweredTerms) || loweredTerms.length === 0) return null;
  for (const term of loweredTerms) {
    if (term && s.includes(term)) return term;
  }
  return null;
}

function ensureExcludedMetrics(executionContext) {
  if (!executionContext || typeof executionContext !== 'object') return null;
  if (!executionContext._excludedMetrics || typeof executionContext._excludedMetrics !== 'object') {
    executionContext._excludedMetrics = {
      removedQuestions: 0,
      removedExamples: 0,
      regeneratedAnswers: 0,
    };
  }
  if (typeof executionContext.excludedItemsCount !== 'number') executionContext.excludedItemsCount = 0;
  return executionContext._excludedMetrics;
}

function recomputeExcludedItemsCount(executionContext) {
  const m = executionContext?._excludedMetrics;
  if (!m) return;
  const total =
    (Number(m.removedQuestions) || 0) +
    (Number(m.removedExamples) || 0) +
    (Number(m.regeneratedAnswers) || 0);
  executionContext.excludedItemsCount = total;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function slugify(raw) {
  const s = safeString(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'intent';
}

function buildReteGraphFromIntents({ categories, startMessage }) {
  const nodes = {};

  // IDs do "Rete JSON" são as chaves do objeto (string) e são referenciadas em outputs.connections[].node
  let nextKey = 1;
  const alloc = () => String(nextKey++);

  const startKey = alloc();
  const fallbackKey = alloc();

  // Start
  nodes[startKey] = {
    id: Number(startKey),
    data: {
      type: 'start',
      config: {
        message: safeString(startMessage || 'Olá! Como posso ajudar?').trim() || 'Olá! Como posso ajudar?',
      },
    },
    position: [0, 0],
    outputs: {
      out: { connections: [] },
    },
  };

  // Fallback
  const categoryLabels = (Array.isArray(categories) ? categories : [])
    .map((c) => safeString(c?.label || c?.category || '').trim())
    .filter(Boolean);

  const fallbackMessage = `Posso ajudar com: ${categoryLabels.join(', ')}. O que você deseja?`;
  nodes[fallbackKey] = {
    id: Number(fallbackKey),
    data: {
      type: 'fallback',
      config: {
        message: fallbackMessage,
      },
    },
    position: [0, 220],
  };

  // Conecta start -> fallback (mesmo output "out")
  nodes[startKey].outputs.out.connections.push({ node: fallbackKey, input: 'in' });

  // Categorias + intents
  const categoryKeyByIndex = new Map();
  let intentRow = 0;

  (Array.isArray(categories) ? categories : []).forEach((cat, idx) => {
    const categoryKey = alloc();
    categoryKeyByIndex.set(idx, categoryKey);

    const intents = Array.isArray(cat?.intents) ? cat.intents : [];
    const label = safeString(cat?.label || cat?.category || `Categoria ${idx + 1}`).trim() || `Categoria ${idx + 1}`;

    nodes[categoryKey] = {
      id: Number(categoryKey),
      data: {
        type: 'category',
        config: {
          label,
          intents,
        },
      },
      position: [300, idx * 200],
      outputs: {
        out: { connections: [] },
      },
    };

    // Conecta start -> categoria
    nodes[startKey].outputs.out.connections.push({ node: categoryKey, input: 'in' });

    // Para cada intent, cria nó e conecta categoria -> intent
    intents.forEach((intent) => {
      const intentKey = alloc();
      const intentId = safeString(intent?.intentId || '').trim() || slugify(intent?.question || `${label}_${intentRow + 1}`);
      const question = safeString(intent?.question || '').trim();
      const answer = safeString(intent?.answer || '').trim();
      const examples = Array.isArray(intent?.examples) ? intent.examples.map((e) => safeString(e).trim()).filter(Boolean).slice(0, 5) : [];

      nodes[intentKey] = {
        id: Number(intentKey),
        data: {
          type: 'intent',
          config: {
            intentId,
            question,
            examples,
            answer,
          },
        },
        position: [650, intentRow * 120],
      };

      intentRow += 1;
      nodes[categoryKey].outputs.out.connections.push({ node: intentKey, input: 'in' });
    });
  });

  return {
    id: 'chatbot-flow@0.1.0',
    nodes,
  };
}

async function inferIntentsAndAnswersWithAI({ tenantIdForAI, faq, contextSources, executionContext }) {
  const safeFaq = (Array.isArray(faq) ? faq : [])
    .map((g) => ({
      category: safeString(g?.category || '').trim().slice(0, 80),
      questions: (Array.isArray(g?.questions) ? g.questions : [])
        .map((q) => safeString(q).trim())
        .filter(Boolean)
        .slice(0, 20),
    }))
    .filter((g) => g.category && g.questions.length > 0)
    .slice(0, 8);

  const ctx = (Array.isArray(contextSources) ? contextSources : [])
    .map((c) => safeString(c?.text || c?.excerpt || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n\n---\n\n')
    .slice(0, 14000);

  const forbidden = (Array.isArray(executionContext?.exclusions) ? executionContext.exclusions : []).slice(0, 30);
  const prompt = [
    'Você vai transformar perguntas frequentes em um conjunto de INTENTS com respostas.',
    '',
    'Contexto (base de conhecimento):',
    ctx ? ctx : '(sem contexto disponível)',
    '',
    'Entrada (FAQ por categoria):',
    JSON.stringify(safeFaq, null, 2),
    '',
    'Tarefa:',
    '- Para cada categoria, crie uma lista de intents.',
    '- Cada intent deve ter: intentId (snake_case), question (pergunta principal), examples (2 a 5 exemplos), answer (resposta curta e útil).',
    '- Seja generalista (não assuma tipo de negócio).',
    '- Se o contexto não for suficiente para responder com segurança, faça uma resposta curta pedindo uma informação que falta.',
    ...(forbidden.length > 0
      ? [
          '',
          'Regras adicionais (obrigatórias):',
          '- NÃO incluir nomes de arquivos, tokens OCR, lixo visual ou artefatos técnicos.',
          '- NÃO mencionar nem repetir os termos proibidos listados abaixo.',
          '',
          '<termos_proibidos>',
          forbidden.join('\n'),
          '</termos_proibidos>',
        ]
      : []),
    '',
    'Saída OBRIGATÓRIA: JSON puro no formato:',
    '[{ "label": "string", "intents": [{ "intentId": "string", "question": "string", "examples": ["..."], "answer": "string" }] }]',
  ].join('\n');

  const ai = await generateAiResponse(prompt, tenantIdForAI, {});
  const text = safeString(ai?.text || '').trim();
  if (!text) throw new Error('IA retornou vazio ao gerar intents/respostas');

  let parsed;
  try {
    // Best-effort: tenta isolar o primeiro array JSON quando o provider adiciona texto extra
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    const candidate = (start >= 0 && end > start) ? text.slice(start, end + 1) : text;
    parsed = JSON.parse(candidate);
  } catch (e) {
    throw new Error(`IA retornou JSON inválido ao gerar intents/respostas: ${e?.message || String(e)}`);
  }

  const groups = Array.isArray(parsed) ? parsed : [];
  const normalized = groups
    .map((g, idx) => ({
      label: safeString(g?.label || g?.category || `Categoria ${idx + 1}`).trim().slice(0, 80) || `Categoria ${idx + 1}`,
      intents: (Array.isArray(g?.intents) ? g.intents : [])
        .map((it, j) => {
          const question = safeString(it?.question || '').trim();
          const fallbackIntentId = slugify(`${idx + 1}_${j + 1}_${question || 'intent'}`).slice(0, 60);
          return {
            intentId: safeString(it?.intentId || '').trim() || fallbackIntentId,
            question,
            examples: (Array.isArray(it?.examples) ? it.examples : [])
              .map((x) => safeString(x).trim())
              .filter(Boolean)
              .slice(0, 5),
            answer: safeString(it?.answer || '').trim(),
          };
        })
        .filter((it) => it.question || it.answer),
    }))
    .filter((g) => g.intents.length > 0);

  // Pós-processamento: garante limpeza semântica usando os mesmos termos inferidos (best-effort)
  const loweredTerms = normalizeExclusions(executionContext?.exclusions);
  const metrics = ensureExcludedMetrics(executionContext);
  const executionId = safeString(executionContext?.executionId || '').trim() || null;

  async function regenerateExamples(question) {
    const p = [
      'Crie 4 variações naturais da pergunta abaixo sem mudar o significado.',
      'Regras:',
      '- Não incluir nomes de arquivos, tokens OCR, lixo visual ou artefatos técnicos.',
      '- NÃO mencionar nem repetir os termos proibidos listados abaixo.',
      '',
      '<termos_proibidos>',
      forbidden.join('\n'),
      '</termos_proibidos>',
      '',
      'Pergunta:',
      question,
      '',
      'Formato: uma frase por linha (sem numeração).',
    ].join('\n');
    const ai = await generateAiResponse(p, tenantIdForAI, {});
    return safeString(ai?.text || '')
      .split('\n')
      .map((l) => l.replace(/^\s*[-*•]\s*/g, '').trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  async function regenerateAnswer(question) {
    const p = [
      'Responda usando apenas o contexto abaixo.',
      '',
      '<contexto>',
      ctx ? ctx : '(sem contexto disponível)',
      '</contexto>',
      '',
      'Pergunta:',
      question,
      '',
      'IMPORTANTE:',
      '- Não incluir nomes de arquivos, tokens OCR, lixo visual ou artefatos técnicos.',
      '- NÃO mencionar nem repetir os termos proibidos listados abaixo.',
      '',
      '<termos_proibidos>',
      forbidden.join('\n'),
      '</termos_proibidos>',
      '',
      'Se não houver resposta no contexto, diga:',
      '"Essa informação não está disponível no material fornecido."',
    ].join('\n');
    const ai = await generateAiResponse(p, tenantIdForAI, {});
    return safeString(ai?.text || '').trim() || 'Essa informação não está disponível no material fornecido.';
  }

  const cleaned = normalized
    .map((cat) => {
      const intents = [];
      for (const it of (Array.isArray(cat?.intents) ? cat.intents : [])) {
        const q = safeString(it?.question || '').trim();
        const a = safeString(it?.answer || '').trim();
        const questionMatched = findMatchedExclusionTerm(q, loweredTerms);
        if (questionMatched) {
          metrics && (metrics.removedQuestions += 1);
          continue;
        }

        let examples = Array.isArray(it?.examples)
          ? it.examples.map((x) => safeString(x).trim()).filter(Boolean).slice(0, 5)
          : [];
        if (loweredTerms.length > 0 && examples.length > 0) {
          const before = examples.length;
          examples = examples.filter((e) => !findMatchedExclusionTerm(e, loweredTerms));
          const removed = Math.max(0, before - examples.length);
          if (removed > 0) metrics && (metrics.removedExamples += removed);
        }

        intents.push({
          ...it,
          question: q,
          answer: a,
          examples,
        });
      }
      return {
        ...cat,
        intents,
      };
    })
    .filter((c) => Array.isArray(c?.intents) && c.intents.length > 0);

  // Completa exemplos/respostas quando necessário (best-effort)
  for (const cat of cleaned) {
    for (const it of cat.intents) {
      // examples: se < 2 após filtro, tenta regenerar
      if (forbidden.length > 0 && Array.isArray(it.examples) && it.examples.length < 2) {
        try {
          const regen = await regenerateExamples(it.question);
          const regenFiltered = normalizeExclusions(executionContext?.exclusions).length > 0
            ? regen.filter((e) => !findMatchedExclusionTerm(e, loweredTerms))
            : regen;
          it.examples = Array.isArray(regenFiltered) ? regenFiltered.slice(0, 5) : it.examples;
        } catch (err) {
          logger.warn('[InitialGraph] Falha ao regenerar examples (best-effort)', {
            tenantIdForAI,
            executionId,
            error: err?.message || String(err),
            question: safeString(it.question).slice(0, 160),
          });
        }
      }

      // answer: se contiver termo excluído, regenerar (máx 2 tentativas)
      if (forbidden.length > 0) {
        const matched0 = findMatchedExclusionTerm(it.answer, loweredTerms);
        if (matched0) {
          let hadRegen = false;
          for (let attempt = 1; attempt <= 2; attempt++) {
            logger.warn('[InitialGraph] Answer contém termo excluído; regenerando', {
              tenantIdForAI,
              executionId,
              attempt,
              matchedTerm: matched0,
              question: safeString(it.question).slice(0, 160),
            });
            try {
              // eslint-disable-next-line no-await-in-loop
              it.answer = await regenerateAnswer(it.question);
              hadRegen = true;
              const matched = findMatchedExclusionTerm(it.answer, loweredTerms);
              if (!matched) break;
            } catch (err) {
              logger.warn('[InitialGraph] Falha ao regenerar answer (best-effort)', {
                tenantIdForAI,
                executionId,
                error: err?.message || String(err),
                question: safeString(it.question).slice(0, 160),
              });
              break;
            }
          }
          if (hadRegen) metrics && (metrics.regeneratedAnswers += 1);
        }
      }
    }
  }

  if (executionContext) recomputeExcludedItemsCount(executionContext);
  if (executionContext?.excludedItemsCount > 0) {
    logger.info('[InitialGraph] Itens filtrados/regenerados por exclusões', {
      tenantIdForAI,
      executionId,
      excludedItemsCount: executionContext.excludedItemsCount,
      metrics: executionContext._excludedMetrics,
    });
  }

  return cleaned;
}

/**
 * Gera (e opcionalmente persiste) um grafo inicial visual no Rete.js
 * baseado em FAQ + intents + respostas.
 *
 * @param {{
 *  tenantIdForAI: string,
 *  tenantIdTarget: string,
 *  name?: string|null,
 *  description?: string|null,
 *  urls?: string[],
 *  fileNames?: string[],
 *  executionId?: string|null,
 *  contextMode?: 'auto'|'persisted'|'ephemeral',
 *  chunks?: any[],
 *  rules?: any,
 *  dryRun?: boolean,
 * }} input
 */
async function generateInitialGraph(input) {
  const tenantIdForAI = safeString(input?.tenantIdForAI).trim();
  const tenantIdTarget = safeString(input?.tenantIdTarget).trim();
  const dryRun = input?.dryRun === true;
  const executionId = safeString(input?.executionId || '').trim() || null;

  if (!tenantIdForAI) throw new Error('tenantIdForAI é obrigatório');
  if (!tenantIdTarget) throw new Error('tenantIdTarget é obrigatório');

  // 1) Gera FAQ (agrupado + coverage)
  const faqResult = await faqGeneratorService.generateFaq({
    tenantId: tenantIdForAI,
    name: input?.name ?? null,
    description: input?.description ?? null,
    urls: Array.isArray(input?.urls) ? input.urls : [],
    fileNames: Array.isArray(input?.fileNames) ? input.fileNames : [],
    chunks: Array.isArray(input?.chunks) ? input.chunks : [],
    executionId: input?.executionId ?? null,
    contextMode: input?.contextMode ?? 'auto',
    rules: input?.rules ?? null,
    dryRun,
  });

  const faq = Array.isArray(faqResult?.faq) ? faqResult.faq : [];
  const coverage = clamp01(typeof faqResult?.coverage === 'number' ? faqResult.coverage : 0);
  const executionContext = {
    executionId,
    exclusions: Array.isArray(faqResult?.exclusions) ? faqResult.exclusions : [],
    excludedItemsCount: 0,
  };

  // 2) Obtém contexto (mesma resolução do gerador de FAQ)
  let contextSources = [];
  try {
    const internal = faqGeneratorService?._internal;
    if (internal && typeof internal.resolveContextSources === 'function') {
      const resolved = await internal.resolveContextSources({
        tenantId: tenantIdForAI,
        name: input?.name ?? null,
        description: input?.description ?? null,
        urls: Array.isArray(input?.urls) ? input.urls : [],
        fileNames: Array.isArray(input?.fileNames) ? input.fileNames : [],
        chunks: Array.isArray(input?.chunks) ? input.chunks : [],
        executionId: input?.executionId ?? null,
        contextMode: input?.contextMode ?? 'auto',
      });
      contextSources = Array.isArray(resolved?.contextSources) ? resolved.contextSources : [];
    }
  } catch (err) {
    logger.warn('[InitialGraph] Falha ao resolver contexto para intents/respostas (best-effort)', {
      tenantIdForAI,
      error: err?.message || String(err),
    });
    contextSources = [];
  }

  // 3) Intents + respostas
  const categories = await inferIntentsAndAnswersWithAI({
    tenantIdForAI,
    faq,
    contextSources,
    executionContext,
  });

  // 4) Monta grafo no formato do editor (Rete JSON)
  const reteJson = buildReteGraphFromIntents({
    categories,
    startMessage: 'Olá! Como posso ajudar?',
  });

  // 5) Persistência (se não for dry-run)
  let persisted = false;
  if (!dryRun) {
    const tenant = await getTenant(tenantIdTarget);
    if (!tenant) {
      throw new Error('Tenant alvo não encontrado para persistir grafo');
    }

    const nextSettings = {
      ...(tenant.settings || {}),
      initialGraph: reteJson,
      initialGraphMeta: {
        generatedAt: new Date().toISOString(),
        coverage,
        categories: categories.length,
        excludedItemsCount: Number(executionContext.excludedItemsCount) || 0,
      },
    };

    const upd = await updateTenant(tenantIdTarget, { settings: nextSettings });
    if (!upd?.success) {
      throw new Error(upd?.error || 'Falha ao persistir grafo no tenant');
    }
    persisted = true;
  }

  logger.info('[InitialGraph] Grafo inicial gerado', {
    tenantIdForAI,
    tenantIdTarget,
    dryRun,
    persisted,
    categories: categories.length,
  });

  return {
    reteJson,
    categories,
    coverage,
    persisted,
    excludedItemsCount: Number(executionContext.excludedItemsCount) || 0,
  };
}

module.exports = {
  generateInitialGraph,
};

