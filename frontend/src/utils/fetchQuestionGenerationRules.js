/**
 * Carrega regras de geração de perguntas (RAG) do contrato.
 * Mantém compatibilidade com o endpoint antigo.
 */
export async function fetchQuestionGenerationRules() {
  // Contrato canônico
  const primary = '/contracts/rag/question-generation.rules.json';
  // Compat retroativa (deprecated)
  const fallback = '/api/data/rag_question_generation_rules.json';

  try {
    let res = await fetch(primary);
    if (!res.ok) {
      res = await fetch(fallback);
    }
    if (!res.ok) return null;
    const json = await res.json();
    return json || null;
  } catch {
    return null;
  }
}

