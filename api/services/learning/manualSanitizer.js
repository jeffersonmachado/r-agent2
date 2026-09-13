'use strict';

/**
 * manualSanitizer — fronteira entre PROVENIÊNCIA INTERNA e CONTEÚDO PRODUCTION.
 *
 * PROBLEMA (missão corretiva A1–A6): o manual operacional é produzido a partir
 * de `uiTrace` de replay e é classificado `PRODUCTION` (consumido por operador e
 * indexado no RAG OPERATIONAL). Ele carregava:
 *
 *   - `> Fonte: replay real \`<replayId>\``;
 *   - `(alvo \`#membership-button\`)` — seletor técnico;
 *   - `replay=true, backend=true`, `Replay (se aplicável)`, `qa-mesh/meshHistory/`,
 *     `POST /api/qa-waves/intelligence/generate-scenario`, `npx playwright install`,
 *     `npm run validate:replay-governance`.
 *
 * REGRA: conteudo PRODUCTION não expõe replay, seletor, alvo técnico, cenário de
 * QA, seed, passo de RPA, rota interna de QA/RPA nem comando de gate. A prova
 * técnica NÃO é destruída: ela é preservada em artefato interno
 * (`*.provenance.json`) com classificação SUPPORT/DEVELOPMENT.
 *
 * Este módulo é PURO (zero I/O) para poder ser usado em gerador, API, RAG e gate.
 *
 * Anti-falso-positivo (§A6/L2): as regras NÃO são regex ingênuas sobre palavras
 * soltas. Elas exigem contexto técnico inequívoco — ver `PRODUCTION_FORBIDDEN_RULES`.
 * Em especial:
 *   - `# Título` de markdown não é seletor, e `#1` não é id;
 *   - `Seletor de data` é nome OPERACIONAL de componente de UI;
 *   - `QA`, `RPA` e `seeds` são NOMES DE RECURSO do produto ("Painel de QA/RPA",
 *     "Gerador de sistemas, fluxos, RPAs e seeds"); só viram vazamento em
 *     construção técnica (`seedId`, `qa-waves`, `Wave 3`).
 */

/** Marcador aplicado a trechos removidos, para não deixar frase órfã. */
const NEUTRALIZED_MARKER = '[detalhe técnico interno removido]';

/**
 * Regras de vazamento. `pattern` deve casar SOMENTE contexto técnico inequívoco.
 * `global` é responsabilidade do consumidor (clonamos com o flag quando preciso).
 */
const PRODUCTION_FORBIDDEN_RULES = Object.freeze([
  {
    id: 'replay_reference',
    description: 'Referência a replay (ID, hash, estado ou execução de replay).',
    pattern: /\breplay(?:Id|ID|_id|Hash|hash)?\b/i,
  },
  {
    id: 'selector_keyword',
    description: 'Palavra técnica de seletor/alvo DOM em uso TÉCNICO.',
    // §A6 anti-falso-positivo: "Seletor de data" é o NOME OPERACIONAL de um
    // componente de UI em português — texto legítimo. A palavra só é vazamento
    // quando usada como ALVO técnico (`selector: #x`, `seletor = .y`) ou como
    // API de DOM (`querySelector`, `xpath`, `data-testid`).
    pattern: /\b(?:selector|seletor)\s*[:=]|\bquerySelector\b|\bxpath\b|\bdata-test-id\b/i,
  },
  {
    id: 'css_selector_token',
    description: 'Token de seletor CSS entre crases (ex.: `#membership-button`, `.btn-primary`).',
    // Exige crase + `#`/`.` colado a identificador com hífen/underscore/letras.
    // Não casa `# Título` (espaço após #) nem valores numéricos como `#1`.
    pattern: /`(?:[#.][A-Za-z][A-Za-z0-9_-]*)(?:[ >+~][^\s`]+)?`/,
  },
  {
    id: 'playwright_engine_selector',
    description: 'Seletor de engine Playwright (css=, xpath=, role=, text=).',
    pattern: /\b(?:css|xpath|role|text)=[^\s`'"]+/i,
  },
  {
    id: 'bracket_selector',
    description: 'Seletor de atributo CSS (ex.: [data-testid="x"]).',
    pattern: /\[(?:data-testid|data-test|aria-label|name|id)\s*[=*^$~|]?\s*["'][^"']+["']\]/i,
  },
  {
    id: 'qa_wave_internal',
    description: 'Termo interno de QA Waves / QA Mesh / cenário / seed.',
    pattern: /\b(?:qa[-_ ]?waves?|qa[-_ ]?mesh|meshHistory|scenario[-_ ]?store|waveScenarioSchema|scenarioId|scenarioCode|qa wave|qa mesh)\b/i,
  },
  {
    id: 'qa_artifact_path',
    description: 'Caminho de artefato de QA/RPA.',
    pattern: /(?:\bqa[-_/][A-Za-z0-9_/-]*|\bqa-mesh\/[A-Za-z0-9_./-]*|\bqa-waves\/[A-Za-z0-9_./-]*)/,
  },
  {
    id: 'internal_qa_endpoint',
    description: 'Endpoint interno de QA/RPA/replay.',
    pattern: /\/api\/(?:qa-waves|qa-mesh|rpa|test-executions)\b[A-Za-z0-9_/:.-]*/i,
  },
  {
    id: 'internal_gate_command',
    description: 'Comando de gate de governança/QA/RPA (npm run validate:*/verify:*).',
    pattern: /\bnpm\s+run\s+(?:validate|verify|wave|report|qa|zip|system)[A-Za-z0-9:_-]*/i,
  },
  {
    id: 'browser_automation_tool',
    description: 'Ferramenta de automação de browser (Playwright/Puppeteer/Selenium).',
    pattern: /\b(?:playwright|puppeteer|selenium|chromium_headless_shell)\b/i,
  },
  {
    id: 'rpa_step_term',
    description: 'Termo de passo/adapter de RPA.',
    pattern: /\b(?:rpa step|rpa recording|uiTrace|adapter(?:\s*=|:)\s*[A-Za-z0-9_-]+|timeoutMs)\b/i,
  },
  {
    id: 'technical_failure_language',
    description: 'Linguagem de falha técnica de execução (falhou no replay, trace, stack).',
    pattern: /\b(?:falhou no replay|falha no replay|stack trace|traceback|selector not found|element not found|timeout exceeded)\b/i,
  },
  {
    id: 'internal_classification_term',
    description: 'Vocabulário de classificação de experiência (SUPPORT/DEVELOPMENT).',
    pattern: /\bclassificationCeiling\b|\brequireClassification\b|classificação\s+(?:SUPPORT|DEVELOPMENT)\b/i,
  },
  {
    id: 'seed_reference',
    description: 'Identificador/atribuição de seed de QA (seedId, seed = ...).',
    // §A6: a PALAVRA "seeds" é nome de recurso de PRODUTO (`/generate-system`
    // gera "sistemas, fluxos, RPAs e seeds"). Só é vazamento em construção
    // técnica — id ou atribuição.
    pattern: /\bseed(?:Id|ID|_id)\b|\bseeds?\s*[:=]/,
  },
  {
    id: 'qa_wave_number',
    description: 'Numeração de onda de QA (ex.: Wave 3).',
    pattern: /\bwave\s*\d/i,
  },
  {
    id: 'technical_route',
    description: 'Rota técnica de engenharia (dev/developer, qa-waves, qa-mesh, rpa-replays, tests).',
    // Rotas de engenharia não são instrução de operador. Casado no TEXTO
    // projetado (o `rag-sync` converte HTML em texto, então o caminho aparece
    // separado do markup) e em rotas citadas em prosa/crase.
    pattern: /(?:^|[\s`"'(])\/(?:dev(?:eloper)?|rpa-replays|qa-waves|qa-mesh|tests?)\b/i,
  },
  {
    id: 'raw_trace_reference',
    description: 'Referência a trace bruto de execução.',
    pattern: /\braw trace\b/i,
  },
  {
    id: 'trace_identifier',
    description: 'Identificador de trace técnico de execução (traceId/spanId).',
    // Operador de PRODUCTION não lê trace distribuído: isso é proveniência
    // interna (fica no `provenance.json` SUPPORT/DEVELOPMENT).
    pattern: /\b(?:traceId|trace_id|spanId|span_id|traceparent)\b/,
  },
  {
    id: 'xpath_expression',
    description: 'Expressão XPath de alvo técnico (eixo, predicado @atributo, contains(text()) ou caminho //elemento).',
    // §A6 anti-falso-positivo: exige ASSINATURA de XPath — caminho `//elem`
    // (com predicado ou continuação), predicado com valor (`[@id="x"]`),
    // função de nó (`contains(text(`/`contains(@`), eixo explícito
    // (`::child`) — ou o caminho absoluto canônico `/html|/body`.
    // NÃO casa caminho relativo de documentação (`./engine/`), pseudo-elemento
    // CSS (`::before`), moldura markdown (`[Importante]`) nem menção (`[@user]`).
    pattern: new RegExp([
      // Caminho `//elemento` com predicado ou continuação de caminho.
      '(?:\\/\\/|\\.\\/\\/)[A-Za-z*][\\w-]*(?:\\[[^\\]]*\\]|\\/)',
      // Predicado com valor: [@id="x"].
      '\\[@[\\w-]+\\s*[=!]\\s*[\'"]',
      // Função de nó: contains(text( / contains(@atributo.
      'contains\\(\\s*(?:text\\(|@[\\w-]+)',
      // Eixo explícito: ::child, ::self, ::descendant...
      '::(?:child|self|descendant|parent|ancestor|following|preceding|attribute|text|node)\\b',
      // Caminho absoluto canônico: /html/... ou /body...
      '(?:^|[\\s`"\'(])\\/(?:html|body)(?![A-Za-z])',
    ].join('|')),
  },
]);

/** Clona o pattern com flag `g` para varredura completa sem mutar a regra congelada. */
function globalPattern(rule) {
  const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
  return new RegExp(rule.pattern.source, flags);
}

/**
 * Detecta vazamentos de PRODUÇÃO. Retorna lista auditável — nunca booleano solto.
 * @returns {Array<{ruleId:string, description:string, match:string, index:number}>}
 */
function detectProductionLeaks(text) {
  const source = typeof text === 'string' ? text : '';
  if (source.length === 0) return [];
  const findings = [];
  for (const rule of PRODUCTION_FORBIDDEN_RULES) {
    const re = globalPattern(rule);
    let match;
    while ((match = re.exec(source)) !== null) {
      findings.push({
        ruleId: rule.id,
        description: rule.description,
        match: match[0],
        index: match.index,
      });
      if (match[0].length === 0) re.lastIndex += 1; // guarda contra loop infinito
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/**
 * Sanitiza texto para PRODUCTION.
 *
 * Estratégia: remove a CONSTRUÇÃO técnica inteira quando ela é delimitada
 * (parênteses com `alvo`, crases de seletor, linhas de citação com replay),
 * e só então neutraliza ocorrências residuais. Nunca deixa frase quebrada.
 *
 * @returns {{ text:string, findings:Array, changed:boolean }}
 */
function sanitizeProductionText(text) {
  const source = typeof text === 'string' ? text : '';
  const findings = detectProductionLeaks(source);
  if (findings.length === 0) return { text: source, findings: [], changed: false };

  let out = source;

  // 1. Construto de alvo técnico: `(alvo \`#x\`)` / `(seletor: ...)`.
  out = out.replace(/\s*\((?:alvo|seletor|selector)\s*[:=]?\s*`[^`]*`\)/gi, '');
  out = out.replace(/\s*\((?:alvo|seletor|selector)\s*[:=]?\s*[^)]*\)/gi, '');

  // 2. Crase técnica de seletor: `` `#x` `` / `` `.x` ``.
  const cssSelectorRule = PRODUCTION_FORBIDDEN_RULES.find((rule) => rule.id === 'css_selector_token');
  out = out.replace(new RegExp(cssSelectorRule.pattern.source, 'g'), '');

  // 3. Linha de citação de rastreabilidade interna (bloco `>` do gerador de manual).
  out = out
    .split('\n')
    .filter((line) => !/^\s*>\s*.*\breplay\b/i.test(line))
    .filter((line) => !/^\s*>\s*.*Valores de campos anonimizados/i.test(line))
    .join('\n');

  // 4. Termos residuais: neutraliza o token, preservando a frase.
  for (const rule of PRODUCTION_FORBIDDEN_RULES) {
    out = out.replace(globalPattern(rule), (match) => (/^\s|\s$/.test(match) ? ' ' : NEUTRALIZED_MARKER));
  }

  // 5. Limpezas de forma (espaços duplos, linhas vazias repetidas, crases vazias).
  out = out
    .replace(/`\s*`/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n');

  return { text: out, findings, changed: out !== source };
}

/**
 * Fail-closed: lança se ainda houver qualquer vazamento PRODUCTION.
 * Usado como backstop no gerador/API para que nenhum manual PRODUCTION saia sujo.
 */
function assertProductionClean(text, context = 'conteúdo') {
  const findings = detectProductionLeaks(text);
  if (findings.length > 0) {
    const detail = findings.map((f) => `${f.ruleId}("${f.match}")`).join(', ');
    const error = new Error(`production_content_leak: ${context} contém detalhe interno — ${detail}`);
    error.code = 'PRODUCTION_CONTENT_LEAK';
    error.findings = findings;
    throw error;
  }
  return true;
}

module.exports = {
  NEUTRALIZED_MARKER,
  PRODUCTION_FORBIDDEN_RULES,
  detectProductionLeaks,
  sanitizeProductionText,
  assertProductionClean,
};
