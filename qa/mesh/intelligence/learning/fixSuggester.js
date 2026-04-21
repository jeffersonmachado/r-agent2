'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'qa', 'mesh', 'intelligence', 'learning', 'fixSuggestions.json');

function suggestionByCause(cause) {
  if (cause === 'ui-selector') {
    return {
      type: 'semantic-migration',
      recommendations: [
        'migrar seletor rigido para action semantica',
        'atualizar screen model para tolerar alteracao visual',
        'reduzir dependencia de seletor css direto',
      ],
    };
  }
  if (cause === 'runtime-timing') {
    return {
      type: 'stability-hardening',
      recommendations: [
        'substituir timeout fixo por wait por estado observavel',
        'isolar clock e estado compartilhado no cenario',
        'registrar metrica de latencia e timeout por passo',
      ],
    };
  }
  if (cause === 'access-control') {
    return {
      type: 'rbac-session-fix',
      recommendations: [
        'validar permissao e sessao no setup do cenario',
        'explicitar erro de autenticacao sem fallback silencioso',
        'revisar fixture de tenant e perfil',
      ],
    };
  }
  if (cause === 'state-nondeterminism') {
    return {
      type: 'determinism-fix',
      recommendations: [
        'fixar seed e resetar estado antes de cada execucao',
        'isolar dependencias externas com mock controlado',
        'comparar 3 execucoes consecutivas para validar repetibilidade',
      ],
    };
  }
  return {
    type: 'contract-alignment',
    recommendations: [
      'alinhar contrato esperado do cenario com implementacao',
      'adicionar assertiva de causa raiz no passo de falha',
      'garantir evidencias minimas para diagnostico',
    ],
  };
}

function generateFixSuggestions(ranked) {
  const suggestions = (ranked.ranked || []).map((item) => {
    const suggestion = suggestionByCause(item.probableCause);
    return {
      clusterId: item.clusterId,
      module: item.module,
      priorityScore: item.priorityScore,
      probableCause: item.probableCause,
      suggestionType: suggestion.type,
      recommendations: suggestion.recommendations,
      signatures: item.signatures,
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    totalSuggestions: suggestions.length,
    suggestions,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  generateFixSuggestions,
  OUTPUT_PATH,
};
