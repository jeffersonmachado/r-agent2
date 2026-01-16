import React from 'react';
import { PropertyField, TextField, TextAreaField, JsonField, SelectField, IntentListField, KeywordsField, OptionsField, RouterField, ScheduleRouterField, NumberField, BooleanField } from './components/PropertyField';
import { getNodeSchema, getNodeProperties } from './editor/nodeSchemas';

/**
 * Painel lateral de propriedades do nó selecionado - estilo moderno
 * 
 * Usa schema centralizado (nodeSchemas.js) para obter metadados e propriedades
 */
export function SidebarProperties({ selectedNode, onChangeConfig, availableNodes = [] }) {

  if (!selectedNode) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-sm sidebar-properties-empty">
        <div className="text-center space-y-3 max-w-[240px]">
          <div className="mb-3 opacity-40">
            <span className="icon icon-logs sidebar-properties-empty-icon"></span>
          </div>
          <div className="text-base font-semibold mb-1 sidebar-properties-empty-title">
            Nenhum nó selecionado
          </div>
          <div className="text-xs leading-relaxed sidebar-properties-empty-description">
            Clique em um nó para ver e editar suas propriedades.
          </div>
        </div>
      </div>
    );
  }

  const { id, type, config = {}, validationErrors = [] } = selectedNode;

  // Obtém schema do nó do schema centralizado
  const nodeSchema = getNodeSchema(type);
  const icon = nodeSchema?.icon || '●';
  const label = nodeSchema?.label || type;
  const description = nodeSchema?.description || 'Nó do fluxo de conversa.';
  const color = nodeSchema?.color || '#ffffff';

  // Obtém propriedades do schema
  let properties = getNodeProperties(type);
  const schemaNodeForVisibility = { id, type, config };
  
  // Para nós ai_task, filtra propriedades baseado na tarefa selecionada
  if (type === 'ai_task') {
    const selectedTask = config.task;
    
    // Propriedades que sempre aparecem
    const alwaysVisible = ['task'];
    
    // Propriedades específicas por tarefa
    const taskSpecificProps = {
      intent_classification: ['allowedOutputs', 'fallback', 'confidenceThreshold', 'keywords'],
      entity_extraction: [], // Adicionar campos específicos quando necessário
      text_normalization: [], // Adicionar campos específicos quando necessário
      assisted_response: [], // Adicionar campos específicos quando necessário
    };
    
    // Filtra propriedades baseado na tarefa selecionada
    if (selectedTask && taskSpecificProps[selectedTask]) {
      const visibleProps = [...alwaysVisible, ...taskSpecificProps[selectedTask]];
      properties = properties.filter((prop) => visibleProps.includes(prop.key));
    } else {
      // Se nenhuma tarefa selecionada, mostra apenas o campo task
      properties = properties.filter((prop) => prop.key === 'task');
    }
  }

  // ✅ Aplica showWhen do schema (ex: campos condicionais no fallback)
  properties = properties.filter((prop) => {
    if (typeof prop.showWhen !== 'function') return true;
    try {
      return !!prop.showWhen(schemaNodeForVisibility);
    } catch {
      return true;
    }
  });

  const updateConfigField = (field, value) => {
    onChangeConfig({
      ...config,
      [field]: value,
    });
  };

  const updateJsonField = (field, rawValue, expectedType = 'object') => {
    try {
      const defaultEmpty = expectedType === 'array' ? '[]' : '{}';
      const parsed = JSON.parse(rawValue || defaultEmpty);
      updateConfigField(field, parsed);
    } catch {
      // Mantém o valor raw para permitir edição incremental
      // A validação será feita pelo JsonField
    }
  };

  // ✅ Variável CSS dinâmica para a cor do nó
  const nodeColorStyle = { '--node-color': color };

  return (
    <div className="w-full h-full p-5 text-sm bg-gradient-to-b from-bg-secondary to-bg-tertiary flex flex-col gap-5 overflow-y-auto scrollbar-thin scrollbar-thumb-border-default scrollbar-track-transparent">
      {/* Cabeçalho com ícone, tipo e descrição */}
      <div
        className="p-5 rounded-xl border backdrop-blur-sm shadow-lg transition-all duration-300 sidebar-properties-header"
        style={nodeColorStyle}
      >
        <div className="flex items-center gap-3.5 mb-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 shadow-lg backdrop-blur-sm transition-transform duration-200 sidebar-properties-icon">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold mb-1 truncate sidebar-properties-title">
              {label}
            </div>
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono opacity-80">
              {type}
            </div>
          </div>
        </div>
        <div className="text-xs text-text-secondary leading-relaxed pt-3 border-t sidebar-properties-description">
          {description}
        </div>
      </div>

      <div className="p-3.5 rounded-lg bg-bg-tertiary/60 border border-border-default/60">
        <div className="text-[10px] text-text-tertiary mb-2 uppercase tracking-wider font-semibold">
          ID do nó
        </div>
        <div className="font-medium text-text-primary font-mono text-xs break-all leading-relaxed">{id}</div>
      </div>

      {/* Erros de validação do nó selecionado */}
      {validationErrors.length > 0 && (
        <div className="p-3.5 rounded-lg bg-bg-tertiary/60 border border-status-error/60 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-status-error mb-1 uppercase tracking-wider font-semibold">
              Problemas de validação
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-status-error/10 text-status-error font-mono">
              {validationErrors.length}
            </span>
          </div>
          <ul className="space-y-1.5 m-0 p-0 list-none text-[11px] text-text-secondary">
            {validationErrors.map((err, idx) => {
              // ✅ Garante que o erro está no formato correto
              const errorCode = (typeof err === 'object' && err.code) ? err.code : 'VALIDATION_ERROR';
              // ✅ Frontend decide: usa messageUi (amigável) se disponível, senão usa message (técnica)
              const errorMessage = (typeof err === 'object' && err.messageUi) 
                ? err.messageUi 
                : ((typeof err === 'object' && err.message) 
                  ? err.message 
                  : (typeof err === 'string' ? err : 'Erro de validação'));
              
              return (
                <li key={`${errorCode}-${idx}`} className="flex flex-col">
                  <span className="font-mono text-status-error font-semibold">
                    [{errorCode}]
                  </span>
                  <span className="leading-snug">{errorMessage}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Nó Anterior */}
      <div className="p-3.5 rounded-lg bg-bg-tertiary/60 border border-border-default/60">
        <div className="text-[10px] text-text-tertiary mb-2 uppercase tracking-wider font-semibold">
          Nó Anterior
        </div>
        <div className="font-medium text-text-primary font-mono text-xs break-all leading-relaxed">
          {selectedNode.previousNodeId || (
            <span className="text-text-tertiary italic">Nenhum</span>
          )}
        </div>
      </div>

      {/* Nó Próximo */}
      <div className="p-3.5 rounded-lg bg-bg-tertiary/60 border border-border-default/60">
        <div className="text-[10px] text-text-tertiary mb-2 uppercase tracking-wider font-semibold">
          Nó Próximo
        </div>
        <div className="font-medium text-text-primary font-mono text-xs break-all leading-relaxed">
          {selectedNode.nextNodeId || (
            <span className="text-text-tertiary italic">Nenhum</span>
          )}
        </div>
      </div>

      {/* Renderiza propriedades dinamicamente baseado no schema */}
      {properties.length > 0 ? (
        <div className="space-y-4">
          {properties.map((prop) => {
            const value = config[prop.key] ?? prop.defaultValue ?? '';
            
            if (prop.type === 'text') {
              return (
                <TextField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(e) => updateConfigField(prop.key, e.target.value)}
                  placeholder={prop.placeholder}
                  required={prop.required}
                  className={prop.key === 'variable' || prop.key === 'outputVariable' ? 'font-mono' : ''}
                />
              );
            }

            if (prop.type === 'number') {
              return (
                <NumberField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      updateConfigField(prop.key, undefined);
                      return;
                    }
                    const num = Number(raw);
                    updateConfigField(prop.key, Number.isFinite(num) ? num : undefined);
                  }}
                  placeholder={prop.placeholder}
                  required={prop.required}
                  className={prop.key === 'confidenceThreshold' ? 'font-mono' : ''}
                />
              );
            }

            if (prop.type === 'boolean') {
              return (
                <BooleanField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={!!value}
                  onChange={(e) => updateConfigField(prop.key, !!e.target.checked)}
                  required={prop.required}
                />
              );
            }

            if (prop.type === 'select') {
              return (
                <SelectField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(e) => updateConfigField(prop.key, e.target.value)}
                  options={prop.options || []}
                  placeholder={prop.placeholder}
                  required={prop.required}
                />
              );
            }
            
            if (prop.type === 'textarea') {
              return (
                <TextAreaField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(e) => updateConfigField(prop.key, e.target.value)}
                  placeholder={prop.placeholder}
                  required={prop.required}
                  rows={prop.rows || 4}
                />
              );
            }
            
            if (prop.type === 'json') {
              return (
                <JsonField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value ? JSON.stringify(value, null, 2) : ''}
                  onChange={(rawValue) => {
                    if (prop.expectedType === 'array') {
                      updateJsonField(prop.key, rawValue, 'array');
                    } else {
                      try {
                        const parsed = rawValue.trim() ? JSON.parse(rawValue) : null;
                        updateConfigField(prop.key, parsed);
                      } catch {
                        // Mantém raw para edição incremental
                      }
                    }
                  }}
                  placeholder={prop.placeholder}
                  required={prop.required}
                  rows={prop.rows || 8}
                  expectedType={prop.expectedType || 'object'}
                />
              );
            }

            if (prop.type === 'intent_list') {
              return (
                <IntentListField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(newValue) => updateConfigField(prop.key, newValue)}
                  required={prop.required}
                  error={validationErrors.find((err) => 
                    err.code === 'AI_TASK_MISSING_ALLOWED_OUTPUTS' && 
                    typeof err === 'object' && err.nodeIds?.includes(id)
                  )?.messageUi}
                />
              );
            }

            if (prop.type === 'keywords') {
              // Obtém as intenções permitidas do campo allowedOutputs
              const allowedIntents = Array.isArray(config.allowedOutputs) ? config.allowedOutputs : [];
              return (
                <KeywordsField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(newValue) => updateConfigField(prop.key, newValue)}
                  allowedIntents={allowedIntents}
                  required={prop.required}
                />
              );
            }

            if (prop.type === 'options') {
              return (
                <OptionsField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(newValue) => updateConfigField(prop.key, newValue)}
                  required={prop.required}
                  error={validationErrors.find((err) => 
                    (err.code === 'OPTIONS_MISSING_OPTIONS' || 
                     err.code === 'OPTIONS_INVALID_OPTION' ||
                     err.code === 'OPTIONS_OPTION_MISSING_ID' ||
                     err.code === 'OPTIONS_OPTION_MISSING_LABEL' ||
                     err.code === 'OPTIONS_DUPLICATE_IDS') && 
                    typeof err === 'object' && err.nodeIds?.includes(id)
                  )?.messageUi}
                />
              );
            }

            if (prop.type === 'router') {
              return (
                <RouterField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(newValue) => updateConfigField(prop.key, newValue)}
                  availableNodes={availableNodes}
                  required={prop.required}
                  error={validationErrors.find((err) => 
                    (err.code === 'ROUTER_MISSING_RULES' || 
                     err.code === 'ROUTER_EMPTY_RULES' ||
                     err.code === 'ROUTER_INVALID_RULE' ||
                     err.code === 'ROUTER_RULE_MISSING_CONDITION' ||
                     err.code === 'ROUTER_RULE_MISSING_NEXT') && 
                    typeof err === 'object' && err.nodeIds?.includes(id)
                  )?.messageUi}
                />
              );
            }

            if (prop.type === 'schedule_router') {
              return (
                <ScheduleRouterField
                  key={prop.key}
                  label={prop.label}
                  description={prop.description}
                  value={value}
                  onChange={(newValue) => updateConfigField(prop.key, newValue)}
                  availableNodes={availableNodes}
                  required={prop.required}
                />
              );
            }
            
            return null;
          })}
          
          {/* Ajuda adicional para router */}
          {type === 'router' && (
            <div className="p-3 rounded-md bg-bg-tertiary/30 border border-border-default/30 space-y-3">
              <div>
                <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
                  Operadores Permitidos
                </div>
                <div className="text-[10px] text-text-secondary space-y-1">
                  <div><code className="text-accent-primary">"op": "always"</code> - Sempre verdadeiro (fallback)</div>
                  <div><code className="text-accent-primary">"op": "equals"</code> - Igualdade simples (===)</div>
                </div>
              </div>
              <div className="pt-2 border-t border-border-default/30">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
                  ⚠️ O Roteador NÃO Calcula
                </div>
                <div className="text-[10px] text-text-secondary space-y-1">
                  <div>❌ Proibido: <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code> regex, parsing</div>
                  <div>✅ Normalize antes: números → faixas, datas → períodos, objetos → propriedades achatadas</div>
                </div>
              </div>
              <div className="pt-2 border-t border-border-default/30">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
                  📋 Padrão de Normalização
                </div>
                <div className="text-[10px] text-text-secondary space-y-1">
                  <div><strong>STRING:</strong> categoria / intenção</div>
                  <div><strong>NUMBER:</strong> faixa categórica ("baixo", "medio", "alto")</div>
                  <div><strong>DATE:</strong> período ("hoje", "passado", "futuro") ou schedule_router</div>
                  <div><strong>ARRAY:</strong> estado ("vazia", "possui_itens")</div>
                  <div><strong>OBJECT:</strong> propriedades achatadas (user_role em vez de user.role)</div>
                  <div><strong>NULL:</strong> flag explícita (campo_existe: true/false)</div>
                </div>
              </div>
            </div>
          )}

          {/* Ajuda adicional para set_variable */}
          {type === 'set_variable' && (
            <div className="p-3 rounded-md bg-bg-tertiary/30 border border-border-default/30 space-y-3">
              <div>
                <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
                  ✅ Uso Correto
                </div>
                <div className="text-[10px] text-text-secondary space-y-1">
                  <div>• Atribuição simples: <code>{"{"}"nome": "João"{"}"}</code></div>
                  <div>• Normalização categórica: <code>{"{"}"faixa_valor": "alto"{"}"}</code></div>
                  <div>• Valores literais: strings, números, objetos simples</div>
                </div>
              </div>
              <div className="pt-2 border-t border-border-default/30">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
                  ⚠️ O Nó Variável NÃO Calcula
                </div>
                <div className="text-[10px] text-text-secondary space-y-1">
                  <div>❌ Proibido: <code>+</code> <code>-</code> <code>*</code> <code>/</code> cálculos</div>
                  <div>❌ Proibido: <code>?</code> <code>:</code> ternário, if/else, lógica condicional</div>
                  <div>✅ Use para: normalizar dados categóricos antes do Roteador</div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Fallback para nós sem propriedades (start, end) */
        <div className="space-y-4">
          {(type === 'start' || type === 'end') && (
            <div className="p-3 rounded-md bg-bg-tertiary/30 border border-border-default/30">
              <p className="text-xs text-text-secondary leading-relaxed">
                {type === 'start' 
                  ? 'Este é o nó inicial do fluxo. Não requer configuração adicional.'
                  : 'Este é o nó final do fluxo. Encerra a conversa quando alcançado.'}
              </p>
            </div>
          )}
          {Object.keys(config).length > 0 && (
            <PropertyField
              label="Configuração detectada (somente leitura)"
              description="Neste projeto, toda configuração deve ser feita pelos campos do Painel de Propriedades (sem edição manual de JSON). Se este nó ainda não expõe campos para estes valores, o schema do nó deve ser ajustado."
            >
              <pre className="w-full p-3 rounded-lg bg-bg-secondary border border-border-default text-xs font-mono text-text-primary overflow-auto max-h-48 whitespace-pre">
                {JSON.stringify(config, null, 2)}
              </pre>
            </PropertyField>
          )}
        </div>
      )}
    </div>
  );
}


