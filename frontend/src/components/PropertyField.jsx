import React, { useState } from 'react';
import { Input, Textarea } from '../styles/Input';
import { fetchJson } from '../api/client';

/**
 * Campo de propriedade com label, ajuda e validação
 */
export function PropertyField({
  label,
  description,
  required = false,
  error,
  children,
  className = '',
}) {
  return (
    <div className={`space-y-3 ${className}`}> {/* Espaçamento maior conforme diretrizes */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-[14px] text-text-primary font-semibold"> {/* Labels claras, mínimo 14px */}
            {label}
          </label>
          {required && (
            <span className="text-status-error text-[14px] font-semibold">*</span>
          )}
        </div>
        {description && (
          <p className="text-[13px] text-text-secondary leading-relaxed mb-2"> {/* Descrição legível */}
            {description}
          </p>
        )}
      </div>
      {children}
      {error && (
        <p className="text-[13px] text-status-error flex items-center gap-1.5">
          <span>⚠️</span>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Campo de texto simples
 */
export function TextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  required = false,
  error,
  type = 'text',
  className = '',
}) {
  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <Input
        type={type}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
      />
    </PropertyField>
  );
}

/**
 * Campo de textarea
 */
export function TextAreaField({
  label,
  description,
  value,
  onChange,
  placeholder,
  required = false,
  error,
  rows = 4,
  className = '',
}) {
  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <Textarea
        rows={rows}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
      />
    </PropertyField>
  );
}

/**
 * Campo de seleção (combo/dropdown)
 */
export function SelectField({
  label,
  description,
  value,
  onChange,
  options = [],
  placeholder,
  required = false,
  error,
  className = '',
}) {
  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <select
        value={value || ''}
        onChange={onChange}
        className={`w-full px-4 py-3 text-[14px] font-inherit text-text-primary bg-bg-secondary rounded-lg outline-none transition-all duration-fast border input-base ${className}`}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => {
          const optionValue = typeof option === 'object' ? option.value : option;
          const optionLabel = typeof option === 'object' ? option.label : option;
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </PropertyField>
  );
}

/**
 * Campo JSON com validação e formatação
 */
export function JsonField({
  label,
  description,
  value,
  onChange,
  placeholder,
  required = false,
  error: externalError,
  rows = 8,
  expectedType = 'object', // 'object' | 'array'
}) {
  const [jsonError, setJsonError] = useState(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleChange = (e) => {
    const rawValue = e.target.value;
    setIsValidating(true);
    setJsonError(null);

    if (!rawValue.trim()) {
      onChange(rawValue);
      setIsValidating(false);
      return;
    }

    try {
      const parsed = JSON.parse(rawValue);
      
      if (expectedType === 'array' && !Array.isArray(parsed)) {
        setJsonError(`Esperado um array, mas recebeu ${typeof parsed}`);
        onChange(rawValue);
      } else if (expectedType === 'object' && (Array.isArray(parsed) || typeof parsed !== 'object')) {
        setJsonError(`Esperado um objeto, mas recebeu ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
        onChange(rawValue);
      } else {
        onChange(rawValue);
        setJsonError(null);
      }
    } catch (err) {
      setJsonError(`JSON inválido: ${err.message}`);
      onChange(rawValue);
    }
    
    setIsValidating(false);
  };

  const handleFormat = () => {
    if (!value || !value.trim()) {
      const defaultValue = expectedType === 'array' ? '[]' : '{}';
      onChange(defaultValue);
      return;
    }
    
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange(formatted);
      setJsonError(null);
    } catch {
      setJsonError('Não é possível formatar JSON inválido');
    }
  };

  const error = externalError || jsonError;

  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <div className="relative">
        <Textarea
          rows={rows}
          value={value || ''}
          onChange={handleChange}
          placeholder={placeholder}
          className={`font-mono text-xs ${error ? 'border-status-error' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={handleFormat}
            className="absolute top-2 right-2 px-2 py-1 text-[10px] bg-bg-tertiary border border-border-default rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Formatar JSON"
          >
            ⚡ Formatar
          </button>
        )}
        {isValidating && (
          <div className="absolute top-2 right-2 text-[10px] text-text-tertiary">
            Validando...
          </div>
        )}
      </div>
    </PropertyField>
  );
}

/**
 * Campo para gerenciar lista de intenções (array de strings)
 */
export function IntentListField({
  label,
  description,
  value,
  onChange,
  required = false,
  error,
}) {
  const intents = Array.isArray(value) ? value : [];
  const [newIntent, setNewIntent] = useState('');

  const handleAddIntent = () => {
    const trimmed = newIntent.trim();
    if (trimmed && !intents.includes(trimmed)) {
      onChange([...intents, trimmed]);
      setNewIntent('');
    }
  };

  const handleRemoveIntent = (intentToRemove) => {
    onChange(intents.filter((intent) => intent !== intentToRemove));
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddIntent();
    }
  };

  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <div className="space-y-3">
        {/* Input para adicionar nova intenção */}
        <div className="flex gap-2">
          <Input
            type="text"
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Digite o nome da intenção (ex: comprar)"
            className="flex-1"
          />
          <button
            type="button"
            onClick={handleAddIntent}
            disabled={!newIntent.trim() || intents.includes(newIntent.trim())}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            + Adicionar
          </button>
        </div>

        {/* Lista de intenções */}
        {intents.length > 0 && (
          <div className="space-y-2">
            {intents.map((intent, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 bg-bg-secondary border border-border-default rounded-lg"
              >
                <span className="flex-1 text-sm text-text-primary">{intent}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveIntent(intent)}
                  className="px-2 py-1 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                  title="Remover intenção"
                >
                  ✕ Remover
                </button>
              </div>
            ))}
          </div>
        )}

        {intents.length === 0 && (
          <p className="text-xs text-text-tertiary italic">
            Nenhuma intenção adicionada ainda. Adicione pelo menos uma intenção.
          </p>
        )}
      </div>
    </PropertyField>
  );
}

/**
 * Palavras-chave sugeridas por tipo de intenção
 */
const SUGGESTED_KEYWORDS = {
  comprar: ['comprar', 'quero comprar', 'desejo comprar', 'adquirir', 'vender', 'preciso de', 'quero', 'desejo'],
  suporte: ['suporte', 'ajuda', 'problema', 'erro', 'não funciona', 'dúvida', 'preciso de ajuda', 'tenho problema', 'está com erro'],
  financeiro: ['financeiro', 'pagamento', 'boleto', 'fatura', 'conta', 'dinheiro', 'pagamento atrasado', 'segunda via', 'extrato'],
  cancelar: ['cancelar', 'cancelamento', 'quero cancelar', 'desistir', 'não quero mais'],
  reclamar: ['reclamação', 'reclamar', 'insatisfeito', 'não gostei', 'problema com'],
  elogiar: ['elogio', 'parabéns', 'gostei', 'muito bom', 'excelente'],
  informacao: ['informação', 'informações', 'quero saber', 'dúvida sobre', 'como funciona'],
};

/**
 * Campo para gerenciar palavras-chave por intenção
 */
export function KeywordsField({
  label,
  description,
  value,
  onChange,
  allowedIntents = [],
  required = false,
  error,
}) {
  const keywords = value && typeof value === 'object' ? value : {};
  const [newKeywords, setNewKeywords] = useState({});
  const [aiSuggestions, setAiSuggestions] = useState({});
  const [aiLoading, setAiLoading] = useState({});

  const handleAddKeyword = (intent) => {
    const trimmed = (newKeywords[intent] || '').trim().toLowerCase();
    if (trimmed) {
      const currentKeywords = Array.isArray(keywords[intent]) 
        ? keywords[intent] 
        : [];
      
      if (!currentKeywords.includes(trimmed)) {
        onChange({
          ...keywords,
          [intent]: [...currentKeywords, trimmed],
        });
        setNewKeywords({ ...newKeywords, [intent]: '' });
      }
    }
  };

  const handleRemoveKeyword = (intent, keywordToRemove) => {
    const currentKeywords = Array.isArray(keywords[intent]) ? keywords[intent] : [];
    onChange({
      ...keywords,
      [intent]: currentKeywords.filter((kw) => kw !== keywordToRemove),
    });
  };

  const handleKeyPress = (e, intent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddKeyword(intent);
    }
  };

  const handleRemoveIntent = (intentToRemove) => {
    const newKeywordsObj = { ...keywords };
    delete newKeywordsObj[intentToRemove];
    onChange(newKeywordsObj);
  };

  const handleAddSuggestedKeyword = (intent, suggestedKeyword) => {
    const currentKeywords = Array.isArray(keywords[intent]) ? keywords[intent] : [];
    const keywordLower = suggestedKeyword.toLowerCase();
    
    if (!currentKeywords.includes(keywordLower)) {
      onChange({
        ...keywords,
        [intent]: [...currentKeywords, keywordLower],
      });
    }
  };

  const handleAddAllSuggested = (intent) => {
    const suggested = SUGGESTED_KEYWORDS[intent] || [];
    const currentKeywords = Array.isArray(keywords[intent]) ? keywords[intent] : [];
    const newKeywordsList = [...currentKeywords];
    
    suggested.forEach((keyword) => {
      const keywordLower = keyword.toLowerCase();
      if (!newKeywordsList.includes(keywordLower)) {
        newKeywordsList.push(keywordLower);
      }
    });
    
    onChange({
      ...keywords,
      [intent]: newKeywordsList,
    });
  };

  const handleGenerateAiSuggestions = async (intent) => {
    setAiLoading({ ...aiLoading, [intent]: true });
    setAiSuggestions({ ...aiSuggestions, [intent]: [] });
    
    try {
      const prompt = `Você é um especialista em classificação de intenções de usuários em chatbots. 

Para a intenção "${intent}", gere uma lista de 10-15 palavras-chave ou frases curtas que os usuários podem usar para expressar essa intenção. 

Considere:
- Variações e sinônimos
- Formas coloquiais e formais
- Frases comuns que expressam essa intenção
- Diferentes formas de escrever a mesma ideia

Retorne APENAS um array JSON de strings, sem explicações adicionais. Exemplo: ["palavra1", "palavra2", "frase curta"]

Intenção: ${intent}
Palavras-chave já existentes: ${Array.isArray(keywords[intent]) ? keywords[intent].join(', ') : 'nenhuma'}

Gere palavras-chave novas que não estejam na lista acima.`;

      const response = await fetchJson('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          tenantId: 'tenant-demo', // TODO: obter do contexto
        }),
      });

      if (response?.text) {
        try {
          // Tenta extrair JSON da resposta
          let jsonText = response.text.trim();
          
          // Remove markdown code blocks se existirem
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          
          // Tenta encontrar array JSON na resposta
          const jsonMatch = jsonText.match(/\[[\s\S]*?\]/);
          if (jsonMatch) {
            const suggestions = JSON.parse(jsonMatch[0]);
            if (Array.isArray(suggestions)) {
              // Filtra palavras já existentes
              const currentKeywords = Array.isArray(keywords[intent]) ? keywords[intent] : [];
              const filtered = suggestions
                .filter((kw) => kw && typeof kw === 'string')
                .map((kw) => kw.toLowerCase().trim())
                .filter((kw) => kw && !currentKeywords.includes(kw));
              
              setAiSuggestions({ ...aiSuggestions, [intent]: filtered });
            }
          }
        } catch (parseError) {
          console.error('Erro ao parsear sugestões da IA:', parseError);
          setAiSuggestions({ ...aiSuggestions, [intent]: [] });
        }
      }
    } catch (error) {
      console.error('Erro ao gerar sugestões da IA:', error);
      setAiSuggestions({ ...aiSuggestions, [intent]: [] });
    } finally {
      setAiLoading({ ...aiLoading, [intent]: false });
    }
  };

  const handleAddAiSuggestion = (intent, suggestion) => {
    handleAddSuggestedKeyword(intent, suggestion);
    // Remove da lista de sugestões
    setAiSuggestions({
      ...aiSuggestions,
      [intent]: (aiSuggestions[intent] || []).filter((s) => s !== suggestion),
    });
  };

  const handleAddAllAiSuggestions = (intent) => {
    const suggestions = aiSuggestions[intent] || [];
    const currentKeywords = Array.isArray(keywords[intent]) ? keywords[intent] : [];
    const newKeywordsList = [...currentKeywords];
    
    suggestions.forEach((keyword) => {
      const keywordLower = keyword.toLowerCase();
      if (!newKeywordsList.includes(keywordLower)) {
        newKeywordsList.push(keywordLower);
      }
    });
    
    onChange({
      ...keywords,
      [intent]: newKeywordsList,
    });
    
    setAiSuggestions({ ...aiSuggestions, [intent]: [] });
  };

  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <div className="space-y-4">
        {allowedIntents.length === 0 ? (
          <p className="text-xs text-text-tertiary italic">
            Configure primeiro as intenções permitidas acima para poder adicionar palavras-chave.
          </p>
        ) : (
          <>
            {/* Lista de intenções e suas palavras-chave */}
            {allowedIntents.map((intent) => {
              const intentKeywords = Array.isArray(keywords[intent]) ? keywords[intent] : [];
              const currentNewKeyword = newKeywords[intent] || '';
              
              return (
                <div
                  key={intent}
                  className="p-3 bg-bg-secondary border border-border-default rounded-lg space-y-2"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-text-primary">
                      Intenção: <span className="text-primary">{intent}</span>
                    </h4>
                    {intentKeywords.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveIntent(intent)}
                        className="px-2 py-1 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                        title="Remover todas as palavras-chave desta intenção"
                      >
                        ✕ Limpar
                      </button>
                    )}
                  </div>

                  {/* Input para adicionar palavra-chave */}
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={currentNewKeyword}
                      onChange={(e) => setNewKeywords({ ...newKeywords, [intent]: e.target.value })}
                      onKeyPress={(e) => handleKeyPress(e, intent)}
                      placeholder="Digite uma palavra-chave (ex: comprar)"
                      className="flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddKeyword(intent)}
                      disabled={!currentNewKeyword.trim() || intentKeywords.includes(currentNewKeyword.trim().toLowerCase())}
                      className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
                    >
                      + Adicionar
                    </button>
                  </div>

                  {/* Palavras-chave sugeridas pela IA */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => handleGenerateAiSuggestions(intent)}
                        disabled={aiLoading[intent]}
                        className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-1"
                        title="Gerar sugestões de palavras-chave usando IA"
                      >
                        {aiLoading[intent] ? (
                          <>
                            <span className="animate-spin">⏳</span> Gerando...
                          </>
                        ) : (
                          <>
                            Sugerir
                          </>
                        )}
                      </button>
                    </div>
                    
                    {aiSuggestions[intent] && aiSuggestions[intent].length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-text-secondary font-medium">
                            Sugestões de IA:
                          </label>
                          <button
                            type="button"
                            onClick={() => handleAddAllAiSuggestions(intent)}
                            className="px-2 py-1 text-xs bg-bg-tertiary text-text-secondary rounded hover:bg-bg-hover transition-colors"
                            title="Adicionar todas as sugestões da IA"
                          >
                            + Adicionar todas
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {aiSuggestions[intent].map((suggestion, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleAddAiSuggestion(intent, suggestion)}
                              className="px-2 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded hover:bg-primary/20 transition-colors"
                              title={`Adicionar "${suggestion}"`}
                            >
                              + {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>


                  {/* Palavras-chave da intenção */}
                  {intentKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {intentKeywords.map((keyword, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs rounded border border-primary/20"
                        >
                          {keyword}
                          <button
                            type="button"
                            onClick={() => handleRemoveKeyword(intent, keyword)}
                            className="text-primary hover:text-status-error transition-colors ml-1"
                            title="Remover palavra-chave"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {intentKeywords.length === 0 && (
                    <p className="text-xs text-text-tertiary italic">
                      Nenhuma palavra-chave adicionada ainda para esta intenção.
                    </p>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </PropertyField>
  );
}

/**
 * Campo para configurar opções interativas (botões, checkboxes, etc.)
 */
export function OptionsField({
  label,
  description,
  value,
  onChange,
  required = false,
  error,
}) {
  const options = Array.isArray(value) ? value : [];

  const addOption = () => {
    const newOption = {
      id: `op${options.length + 1}`,
      label: '',
      value: undefined,
    };
    onChange([...options, newOption]);
  };

  const updateOption = (index, field, newValue) => {
    const updated = [...options];
    updated[index] = {
      ...updated[index],
      [field]: newValue,
    };
    onChange(updated);
  };

  const removeOption = (index) => {
    const updated = options.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <div className="space-y-4">
        {/* Botão para adicionar nova opção */}
        <button
          type="button"
          onClick={addOption}
          className="w-full px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium flex items-center justify-center gap-2"
        >
          <span>+</span>
          <span>Adicionar Opção</span>
        </button>

        {/* Lista de opções configuradas */}
        {options.length > 0 ? (
          <div className="space-y-4">
            {options.map((option, index) => (
              <div
                key={index}
                className="p-4 bg-bg-secondary border border-border-default rounded-lg space-y-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-text-primary">
                    Opção {index + 1}
                  </h4>
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="px-2 py-1 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                    title="Remover opção"
                  >
                    ✕ Remover
                  </button>
                </div>

                {/* ID da opção */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                    ID da opção *
                  </label>
                  <Input
                    type="text"
                    value={option.id || ''}
                    onChange={(e) => updateOption(index, 'id', e.target.value)}
                    placeholder="Ex: op1, opcao_sim, etc."
                    className="w-full font-mono"
                  />
                  <p className="text-xs text-text-tertiary mt-1">
                    Identificador único usado internamente. Use apenas letras, números e underscore.
                  </p>
                </div>

                {/* Label da opção */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                    Texto exibido *
                  </label>
                  <Input
                    type="text"
                    value={option.label || ''}
                    onChange={(e) => updateOption(index, 'label', e.target.value)}
                    placeholder="Ex: Sim, Não, Opção 1, etc."
                    className="w-full"
                  />
                  <p className="text-xs text-text-tertiary mt-1">
                    Texto que será exibido para o usuário. Você pode usar variáveis como {'{{nome}}'}.
                  </p>
                </div>

                {/* Value da opção (opcional) */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                    Valor armazenado (opcional)
                  </label>
                  <Input
                    type="text"
                    value={option.value !== undefined ? String(option.value) : ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      updateOption(index, 'value', val === '' ? undefined : val);
                    }}
                    placeholder="Deixe vazio para usar o ID como valor"
                    className="w-full"
                  />
                  <p className="text-xs text-text-tertiary mt-1">
                    Valor que será salvo na variável quando esta opção for selecionada. Se não preencher, usa o ID.
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-tertiary italic text-center py-4">
            Nenhuma opção configurada ainda. Clique em "Adicionar Opção" para começar.
          </p>
        )}
      </div>
    </PropertyField>
  );
}

/**
 * Campo para configurar horários do roteador por horário
 */
export function ScheduleRouterField({
  label,
  description,
  value,
  onChange,
  availableNodes = [],
  required = false,
  error,
}) {
  const schedules = Array.isArray(value) ? value : [];
  
  const daysOfWeek = [
    { value: 0, label: 'Domingo' },
    { value: 1, label: 'Segunda-feira' },
    { value: 2, label: 'Terça-feira' },
    { value: 3, label: 'Quarta-feira' },
    { value: 4, label: 'Quinta-feira' },
    { value: 5, label: 'Sexta-feira' },
    { value: 6, label: 'Sábado' },
  ];

  const addSchedule = () => {
    const newSchedule = {
      days: [],
      startTime: '09:00',
      endTime: '18:00',
      next: '',
      label: '',
    };
    onChange([...schedules, newSchedule]);
  };

  const updateSchedule = (index, field, newValue) => {
    const updated = [...schedules];
    updated[index] = {
      ...updated[index],
      [field]: newValue,
    };
    onChange(updated);
  };

  const removeSchedule = (index) => {
    const updated = schedules.filter((_, i) => i !== index);
    onChange(updated);
  };

  const toggleDay = (scheduleIndex, dayValue) => {
    const schedule = schedules[scheduleIndex];
    const currentDays = Array.isArray(schedule.days) ? schedule.days : [];
    const newDays = currentDays.includes(dayValue)
      ? currentDays.filter(d => d !== dayValue)
      : [...currentDays, dayValue].sort((a, b) => a - b);
    updateSchedule(scheduleIndex, 'days', newDays);
  };

  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <div className="space-y-4">
        {/* Botão para adicionar novo horário */}
        <button
          type="button"
          onClick={addSchedule}
          className="w-full px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium flex items-center justify-center gap-2"
        >
          <span>+</span>
          <span>Adicionar Horário</span>
        </button>

        {/* Lista de horários configurados */}
        {schedules.length > 0 ? (
          <div className="space-y-4">
            {schedules.map((schedule, index) => (
              <div
                key={index}
                className="p-4 bg-bg-secondary border border-border-default rounded-lg space-y-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-text-primary">
                    Horário {index + 1}
                  </h4>
                  <button
                    type="button"
                    onClick={() => removeSchedule(index)}
                    className="px-2 py-1 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                    title="Remover horário"
                  >
                    ✕ Remover
                  </button>
                </div>

                {/* Label do horário */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                    Nome do horário (opcional)
                  </label>
                  <Input
                    type="text"
                    value={schedule.label || ''}
                    onChange={(e) => updateSchedule(index, 'label', e.target.value)}
                    placeholder="Ex: Horário Comercial"
                    className="w-full"
                  />
                </div>

                {/* Dias da semana */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                    Dias da semana *
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {daysOfWeek.map((day) => {
                      const isSelected = Array.isArray(schedule.days) && schedule.days.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleDay(index, day.value)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                            isSelected
                              ? 'bg-primary text-white border border-primary'
                              : 'bg-bg-tertiary text-text-secondary border border-border-default hover:bg-bg-hover'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Horário de início e fim */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                      Horário de início *
                    </label>
                    <Input
                      type="time"
                      value={schedule.startTime || '09:00'}
                      onChange={(e) => updateSchedule(index, 'startTime', e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                      Horário de fim *
                    </label>
                    <Input
                      type="time"
                      value={schedule.endTime || '18:00'}
                      onChange={(e) => updateSchedule(index, 'endTime', e.target.value)}
                      className="w-full"
                    />
                  </div>
                </div>

                {/* Próximo nó (combobox) */}
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5 font-medium">
                    Próximo nó *
                  </label>
                  <select
                    value={schedule.next || ''}
                    onChange={(e) => updateSchedule(index, 'next', e.target.value)}
                    className="w-full px-4 py-3 text-[14px] font-inherit text-text-primary bg-bg-secondary rounded-lg outline-none transition-all duration-fast border input-base"
                  >
                    <option value="">Selecione um nó...</option>
                    {availableNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label || node.type} ({node.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-tertiary italic text-center py-4">
            Nenhum horário configurado ainda. Clique em "Adicionar Horário" para começar.
          </p>
        )}
      </div>
    </PropertyField>
  );
}

