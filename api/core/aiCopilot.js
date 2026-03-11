/**
 * Integração AI Copilot com Sugestões Canônicas
 * 
 * Conecta o sistema de análise canônico ao assistente de IA para:
 * - Geração automática de protocolos otimizados
 * - Sugestões de melhoria impulsionadas por IA
 * - Refatoração automática de processos
 * - Documentação inteligente
 * 
 * @module canonical/aiCopilot
 */

/**
 * Orquestrador de Copilot Canônico
 */
export class CanonicalCopilotOrchestrator {
  constructor(aiService, canonicalService) {
    this.aiService = aiService;
    this.canonicalService = canonicalService;
    this.suggestionCache = new Map();
  }

  /**
   * Processa sugestões canônicas e gera propostas de refatoração com IA
   * 
   * @param {Object} canonical - Definição de processo canônico
   * @param {Object} suggestions - Sugestões da análise canônica
   * @returns {Promise<Object>} Propostas de refatoração com código
   */
  async generateRefactoringProposals(canonical, suggestions) {
    const proposals = [];

    for (const suggestion of suggestions) {
      const proposal = await this.generateProposal(canonical, suggestion);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    return {
      suggestions: proposals,
      generatedAt: new Date().toISOString(),
      totalProposals: proposals.length,
    };
  }

  /**
   * Gera proposta única de refatoração para uma sugestão
   * @private
   */
  async generateProposal(canonical, suggestion) {
    const cacheKey = `${suggestion.code}-${JSON.stringify(suggestion.nodeIds)}`;

    // Verificar cache
    if (this.suggestionCache.has(cacheKey)) {
      return this.suggestionCache.get(cacheKey);
    }

    const prompt = this.buildPrompt(canonical, suggestion);

    try {
      const aiResponse = await this.aiService.generate({
        model: 'gpt-4',
        prompt,
        maxTokens: 1000,
        temperature: 0.3, // Mais determinístico para código
      });

      const proposal = this.parseAiResponse(
        aiResponse,
        suggestion,
        canonical
      );

      // Cache por 1 hora
      this.suggestionCache.set(cacheKey, proposal);
      setTimeout(
        () => this.suggestionCache.delete(cacheKey),
        3600000
      );

      return proposal;
    } catch (error) {
      console.error(`Erro ao gerar proposta para ${suggestion.code}:`, error);
      return null;
    }
  }

  /**
   * Constrói prompt para IA baseado em sugestão canônica
   * @private
   */
  buildPrompt(canonical, suggestion) {
    const affectedNodes = canonical.nodes.filter((n) =>
      suggestion.nodeIds.includes(n.id)
    );

    return `
## Contexto
Você é um especialista em otimização de processos. Analise o seguinte sugestão de melhoria e proponha uma refatoração.

## Processo Canônico
ID: ${canonical.id}
Nós: ${canonical.nodes.length}
Edges: ${canonical.edges.length}

## Nós Afetados
${affectedNodes.map((n) => `- ${n.id} (${n.type}): ${n.label}`).join('\n')}

## Sugestão
Código: ${suggestion.code}
Mensagem: ${suggestion.message}

## Tarefa
1. Analise por que essa sugestão foi feita
2. Proponha uma refatoração específica
3. Forneça o novo código ou configuração
4. Explique os benefícios da mudança
5. Indique qualquer risco potencial

## Formato da Resposta
Responda em JSON com esta estrutura:
{
  "reasoning": "Por que a mudança é necessária",
  "refactoring": {
    "type": "restructure|optimize|simplify",
    "affectedNodes": ["node-ids"],
    "changes": [{ "nodeId": "id", "from": {...}, "to": {...} }]
  },
  "expectedBenefits": ["benefício1", "benefício2"],
  "risks": ["risco1"],
  "implementation": "Detalhes de implementação",
  "estimatedEffort": "baixa|média|alta"
}
`;
  }

  /**
   * Parsa resposta da IA
   * @private
   */
  parseAiResponse(aiResponse, suggestion, canonical) {
    try {
      const parsed = JSON.parse(aiResponse);

      return {
        ...suggestion,
        proposal: parsed,
        status: 'generated',
        generatedAt: new Date().toISOString(),
        appliedChanges: [], // Preenchido quando aplicado
      };
    } catch (error) {
      console.error('Erro ao fazer parse da resposta da IA:', error);
      return null;
    }
  }

  /**
   * Aplica refatoração proposta ao processo
   * 
   * @param {Object} canonical - Processo original
   * @param {Object} proposal - Proposta de refatoração
   * @returns {Object} Processo refatorado
   */
  applyProposal(canonical, proposal) {
    const refactored = JSON.parse(JSON.stringify(canonical));

    if (proposal.proposal?.refactoring?.changes) {
      for (const change of proposal.proposal.refactoring.changes) {
        const nodeIndex = refactored.nodes.findIndex(
          (n) => n.id === change.nodeId
        );

        if (nodeIndex >= 0) {
          refactored.nodes[nodeIndex] = {
            ...refactored.nodes[nodeIndex],
            ...change.to,
          };
        }
      }
    }

    return {
      ...refactored,
      metadata: {
        ...refactored.metadata,
        appliedProposals: [
          ...(refactored.metadata?.appliedProposals || []),
          {
            code: proposal.code,
            appliedAt: new Date().toISOString(),
            proposal: proposal.proposal,
          },
        ],
      },
    };
  }

  /**
   * Gera documentação automática de processo usando IA
   * 
   * @param {Object} canonical - Definição de processo
   * @returns {Promise<string>} Documentação em markdown
   */
  async generateDocumentation(canonical) {
    const prompt = `
Gere documentação clara e profissional para o seguinte processo de negócio em Markdown.

## Processo
ID: ${canonical.id}
Nome: ${canonical.name}
Nós: ${canonical.nodes.length}
Tipo: ${canonical.type}

## Nós
${canonical.nodes
  .map(
    (n) =>
      `- **${n.id}** (${n.type}): ${n.label}\n  Configuração: ${JSON.stringify(n.config || {})}`
  )
  .join('\n')}

## Fluxo de Execução
${canonical.edges.map((e) => `- ${e.source} → ${e.target}${e.label ? ` (${e.label})` : ''}`).join('\n')}

Gere uma documentação que inclua:
1. Descrição executiva do processo
2. Fluxo passo-a-passo
3. Atores e responsabilidades
4. Pontos de decisão críticos
5. Tratamento de erros
6. SLAs e métricas esperadas
7. Recomendações de melhoria
`;

    try {
      const documentation = await this.aiService.generate({
        model: 'gpt-4',
        prompt,
        maxTokens: 2000,
      });

      return documentation;
    } catch (error) {
      console.error('Erro ao gerar documentação:', error);
      throw error;
    }
  }

  /**
   * Gera teste automatizado baseado no processo
   * 
   * @param {Object} canonical - Definição de processo
   * @returns {Promise<string>} Código de teste (Jest/Vitest)
   */
  async generateTestCase(canonical) {
    const prompt = `
Gere um teste automatizado completo (usando Jest/Vitest) para o seguinte processo canônico.

## Processo
${JSON.stringify(canonical, null, 2)}

O teste deve incluir:
1. Setup inicial do processo
2. Dados de entrada válidos
3. Asserções para verificar estados esperados
4. Testes de caso extremo
5. Testes de erro/tratamento de exceções
6. Testes de performance (se relevante)

Forneça o código pronto para rodar.`;

    try {
      const testCode = await this.aiService.generate({
        model: 'gpt-4',
        prompt,
        maxTokens: 2500,
      });

      return testCode;
    } catch (error) {
      console.error('Erro ao gerar teste:', error);
      throw error;
    }
  }

  /**
   * Analisa padrões em múltiplos processos e propõe template reutilizável
   * 
   * @param {Array<Object>} canonicalProcesses - Múltiplos processos
   * @returns {Promise<Object>} Template genérico proposto
   */
  async extractCommonPattern(canonicalProcesses) {
    if (canonicalProcesses.length < 2) {
      throw new Error('Pelo menos 2 processos são necessários para extrair padrão');
    }

    const prompt = `
Analise os seguintes ${canonicalProcesses.length} processos canônicos e identifique padrões comuns.

## Processos
${canonicalProcesses
  .map((p, i) => `\n### Processo ${i + 1}: ${p.name}\\n${JSON.stringify(p, null, 2)}`)
  .join('\n')}

Identifique:
1. Estrutura comum
2. Sequências repetidas
3. Variações esperadas
4. Pontos de customização

Proponha um template genérico que possa ser especializado para cada caso.
Forneça como JSON com estrutura canônica.`;

    try {
      const analysis = await this.aiService.generate({
        model: 'gpt-4',
        prompt,
        maxTokens: 3000,
      });

      return JSON.parse(analysis);
    } catch (error) {
      console.error('Erro ao extrair padrão comum:', error);
      throw error;
    }
  }

  /**
   * Valida processo contra boas práticas usando IA
   * 
   * @param {Object} canonical - Processo a validar
   * @returns {Promise<Object>} Relatório de validação
   */
  async validateAgainstBestPractices(canonical) {
    const prompt = `
Valide o seguinte processo canônico contra as melhores práticas de design:

## Processo
${JSON.stringify(canonical, null, 2)}

## Checklist de Validação
- [ ] Tem no máximo 1 nó de início
- [ ] Tem no máximo 1 nó de fim
- [ ] Todos os caminhos levam ao fim
- [ ] Não há nós órfãos (sem conexão)
- [ ] Nomes descritivos (evita "Task 1", "Task 2")
- [ ] Lógica de condicional é clara
- [ ] Sem loops infinitos aparentes
- [ ] Testes de erro definidos
- [ ] SLA ou timeout especificados quando relevante
- [ ] Documentação de negócio

Forneça um relatório JSON com:
- violations: Lista de violações de best practices
- score: 0-100 de conformidade
- recommendations: Sugestões de melhoria
- severity: crítico|aviso|info para cada item
`;

    try {
      const report = await this.aiService.generate({
        model: 'gpt-4',
        prompt,
        maxTokens: 2000,
      });

      return JSON.parse(report);
    } catch (error) {
      console.error('Erro ao validar boas práticas:', error);
      throw error;
    }
  }

  /**
   * Explica um processo em linguagem natural para diferentes públicos
   * 
   * @param {Object} canonical - Processo a explicar
   * @param {string} audience - 'business|technical|executive'
   * @returns {Promise<string>} Explicação em linguagem natural
   */
  async explainProcess(canonical, audience = 'business') {
    const audiencePrompts = {
      business:
        'Explique como um profissional de negócio leigo poderia entender. Foque no valor para o negócio.',
      technical:
        'Explique para um desenvolvedor. Foque em implementação e arquitetura.',
      executive:
        'Explique em nível executivo. Foque em impacto, ROI e riscos.',
    };

    const audienceContext = audiencePrompts[audience] || audiencePrompts.business;

    const prompt = `
${audienceContext}

## Processo
${JSON.stringify(canonical, null, 2)}

Forneça uma explicação clara, concisa e não-técnica (exceto se audience=technical).
Use exemplos práticos quando possível.`;

    try {
      const explanation = await this.aiService.generate({
        model: 'gpt-3.5-turbo',
        prompt,
        maxTokens: 1500,
      });

      return explanation;
    } catch (error) {
      console.error('Erro ao explicar processo:', error);
      throw error;
    }
  }

  /**
   * Limpa cache de sugestões
   */
  clearCache() {
    this.suggestionCache.clear();
  }
}

/**
 * Hook React para AI Copilot
 * 
 * @example
 * const { generateRefactoring, explainProcess } = useAiCopilot();
 */
export function useAiCopilot(orchestrator = null) {
  if (!orchestrator && typeof window !== 'undefined') {
    orchestrator = window.__aiCopilotOrchestrator;
  }

  return {
    generateRefactoring: async (canonical, suggestions) =>
      orchestrator?.generateRefactoringProposals(canonical, suggestions),
    generateDocumentation: async (canonical) =>
      orchestrator?.generateDocumentation(canonical),
    generateTests: async (canonical) =>
      orchestrator?.generateTestCase(canonical),
    explainProcess: async (canonical, audience) =>
      orchestrator?.explainProcess(canonical, audience),
    validateBestPractices: async (canonical) =>
      orchestrator?.validateAgainstBestPractices(canonical),
    extractPattern: async (processes) =>
      orchestrator?.extractCommonPattern(processes),
    applyProposal: (canonical, proposal) =>
      orchestrator?.applyProposal(canonical, proposal),
  };
}

export default {
  CanonicalCopilotOrchestrator,
  useAiCopilot,
};
