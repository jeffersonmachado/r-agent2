export const PIPELINE_LABELS = {
  providerValidated: 'Provider de IA validado',
  ragValidated: 'Servico RAG validado',
  webScraping: 'Web scraping',
  descriptionSuggested: 'Sugerir descricao',
  questionsGenerated: 'Perguntas geradas',
  filesInferred: 'Arquivos inferidos e indexados',
  payloadValid: 'Payload valido',
  contractValid: 'Contrato valido',
  contextBuilt: 'Contexto montado',
  ragContextBuilt: 'Contexto RAG construido',
  aiExecuted: 'Executando IA (geracao do fluxo)',
  flowGenerated: 'Fluxo gerado',
  seedGenerated: 'Seed gerado',
  rpaGenerated: 'RPA gerado',
  rpaExecuted: 'RPA executado',
  approved: 'Aprovado',
};

const STEP_MESSAGES = {
  providerValidated: {
    completed: 'Provider de IA validado',
    in_progress: 'Validando provider de IA...',
    error: 'Provider de IA nao configurado',
  },
  ragValidated: {
    completed: 'Servico RAG validado',
    in_progress: 'Validando servico RAG...',
    error: 'Servico RAG nao disponivel',
  },
  webScraping: {
    completed: 'Web scraping concluido',
    in_progress: 'Raspando URLs (web scraping)...',
    error: 'Nenhuma URL foi raspada com sucesso',
  },
  descriptionSuggested: {
    completed: 'Descricao sugerida pela IA',
    in_progress: 'Sugerindo descricao com IA...',
    error: 'Erro ao sugerir descricao',
  },
  questionsGenerated: {
    completed: 'Perguntas geradas',
    in_progress: 'Gerando perguntas...',
    error: 'Erro ao gerar perguntas',
  },
  filesInferred: {
    completed: 'Arquivos processados e indexados no RAG',
    in_progress: 'Processando e indexando arquivos...',
    error: 'Erro ao processar arquivos',
  },
  payloadValid: {
    completed: 'Payload validado com sucesso',
    in_progress: 'Validando payload...',
    error: 'Payload invalido',
  },
  contractValid: {
    completed: 'Contrato validado com sucesso',
    in_progress: 'Validando contrato...',
    error: 'Validacao de contrato falhou',
  },
  contextBuilt: {
    completed: 'Contexto montado com sucesso',
    in_progress: 'Montando contexto para IA...',
    error: 'Erro ao montar contexto',
  },
  ragContextBuilt: {
    completed: 'Contexto RAG construido',
    in_progress: 'Buscando evidencias no RAG...',
    error: 'Evidencia insuficiente no RAG',
  },
  aiExecuted: {
    completed: 'IA executada com sucesso',
    in_progress: 'Executando IA...',
    error: 'Erro na execucao da IA',
  },
  flowGenerated: {
    completed: 'Fluxo gerado com sucesso',
    in_progress: 'Gerando fluxo...',
    error: 'Erro ao gerar fluxo',
  },
  seedGenerated: {
    completed: 'Seed gerado com sucesso',
    in_progress: 'Gerando seed...',
    error: 'Erro ao gerar seed',
  },
  rpaGenerated: {
    completed: 'RPA gerado com sucesso',
    in_progress: 'Gerando teste RPA...',
    error: 'Erro ao gerar RPA',
  },
  rpaExecuted: {
    completed: 'RPA executado com sucesso',
    in_progress: 'Executando teste RPA...',
    error: 'Erro na execucao do RPA',
  },
  approved: {
    completed: 'Sistema aprovado',
    in_progress: 'Aguardando aprovacao...',
    error: 'Sistema reprovado',
  },
};

export function getStepMessage(step, status) {
  return STEP_MESSAGES[step]?.[status] || `${step}: ${status}`;
}
