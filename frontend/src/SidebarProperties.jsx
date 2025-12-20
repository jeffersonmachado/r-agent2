import React from 'react';
import { PropertyField, TextField, TextAreaField, JsonField } from './components/PropertyField';

/**
 * Painel lateral de propriedades do nó selecionado - estilo moderno
 */
export function SidebarProperties({ selectedNode, onChangeConfig }) {

  if (!selectedNode) {
    return (
      <div className="w-80 border-l border-border-default p-8 text-sm bg-gradient-to-br from-bg-secondary to-bg-tertiary flex flex-col items-center justify-center text-text-tertiary">
        <div className="text-center space-y-3 max-w-[240px]">
          <div className="text-4xl mb-3 opacity-40">📋</div>
          <div className="text-base font-semibold text-text-secondary mb-1">
            Nenhum nó selecionado
          </div>
          <div className="text-xs text-text-tertiary leading-relaxed">
            Clique em um nó para ver e editar suas propriedades.
          </div>
        </div>
      </div>
    );
  }

  const { id, type, config = {} } = selectedNode;

  const updateConfigField = (field, value) => {
    onChangeConfig({
      ...config,
      [field]: value,
    });
  };

  const updateJsonField = (field, rawValue) => {
    try {
      const parsed = JSON.parse(rawValue || (field === 'rules' ? '[]' : '{}'));
      updateConfigField(field, parsed);
    } catch {
      // Mantém o valor raw para permitir edição incremental
      // A validação será feita pelo JsonField
    }
  };

  // Cores suaves conforme diretrizes
  const nodeTypeColors = {
    start: '#4A90E2',        // Azul suave
    message: '#52C9A2',      // Verde suave
    user_input: '#52C9A2',   // Verde suave
    router: '#F5A623',       // Amarelo suave
    set_variable: '#7B68EE', // Roxo suave
    handoff: '#9B59B6',      // Roxo suave
    ai: '#16A085',           // Verde-água suave
    end: '#95A5A6',          // Cinza suave
  };

  const nodeTypeIcons = {
    start: '▶',
    message: '💬',
    user_input: '⌨️',
    router: '🔀',
    set_variable: '📝',
    handoff: '👤',
    ai: '🤖',
    end: '⏹',
  };

  const nodeTypeLabels = {
    start: 'Início',
    message: 'Mensagem',
    user_input: 'Entrada',
    router: 'Roteador',
    set_variable: 'Variável',
    handoff: 'Transferência',
    ai: 'IA',
    end: 'Fim',
  };

  const nodeTypeDescriptions = {
    start: 'Nó inicial do fluxo. Define o ponto de entrada da conversa.',
    message: 'Envia uma mensagem ao usuário. Pode conter texto formatado.',
    user_input: 'Captura entrada do usuário e armazena em uma variável.',
    router: 'Roteia o fluxo baseado em condições e regras definidas.',
    set_variable: 'Define ou atualiza o valor de variáveis do fluxo.',
    handoff: 'Transfere a conversa para um agente humano ou fila de atendimento.',
    ai: 'Processa a entrada usando IA e gera uma resposta contextual.',
    end: 'Nó final do fluxo. Encerra a conversa.',
  };

  const icon = nodeTypeIcons[type] || '●';
  const label = nodeTypeLabels[type] || type;
  const description = nodeTypeDescriptions[type] || 'Nó do fluxo de conversa.';
  const color = nodeTypeColors[type] || '#ffffff';

  return (
    <div className="w-80 border-l border-border-default p-5 text-sm bg-gradient-to-b from-bg-secondary to-bg-tertiary flex flex-col gap-5 overflow-y-auto scrollbar-thin scrollbar-thumb-border-default scrollbar-track-transparent">
      {/* Cabeçalho com ícone, tipo e descrição */}
      <div
        className="p-5 rounded-xl border backdrop-blur-sm shadow-lg transition-all duration-300"
        style={{
          background: `linear-gradient(135deg, ${color}18 0%, ${color}10 100%)`,
          borderColor: `${color}35`,
        }}
      >
        <div className="flex items-center gap-3.5 mb-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 shadow-lg backdrop-blur-sm transition-transform duration-200"
            style={{
              backgroundColor: `${color}25`,
              boxShadow: `0 4px 12px ${color}30`,
            }}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-lg font-semibold mb-1 truncate"
              style={{ color }}
            >
              {label}
            </div>
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono opacity-80">
              {type}
            </div>
          </div>
        </div>
        <div
          className="text-xs text-text-secondary leading-relaxed pt-3 border-t"
          style={{
            borderTopColor: `${color}25`,
          }}
        >
          {description}
        </div>
      </div>

      <div className="p-3.5 rounded-lg bg-bg-tertiary/60 border border-border-default/60">
        <div className="text-[10px] text-text-tertiary mb-2 uppercase tracking-wider font-semibold">
          ID do nó
        </div>
        <div className="font-medium text-text-primary font-mono text-xs break-all leading-relaxed">{id}</div>
      </div>

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

      {type === 'message' && (
        <TextAreaField
          label="Texto da mensagem"
          description="Mensagem que será enviada ao usuário. Pode conter texto simples ou formatado."
          value={config.text || ''}
          onChange={(e) => updateConfigField('text', e.target.value)}
          placeholder="Ex.: Olá! Como posso ajudá-lo hoje?"
          required
          rows={4}
        />
      )}

      {type === 'user_input' && (
        <TextField
          label="Variável de destino"
          description="Nome da variável onde o input do usuário será armazenado. Use apenas letras, números e underscore."
          value={config.variable || ''}
          onChange={(e) => updateConfigField('variable', e.target.value)}
          placeholder="Ex.: user_message"
          required
          className="font-mono"
        />
      )}

      {type === 'handoff' && (
        <TextField
          label="Fila de atendimento"
          description="Identificador da fila ou equipe de atendimento humano que receberá a conversa."
          value={config.queue || ''}
          onChange={(e) => updateConfigField('queue', e.target.value)}
          placeholder="Ex.: suporte_n1"
          required
        />
      )}

      {type === 'ai' && (
        <div className="space-y-4">
          <TextAreaField
            label="Template do Prompt"
            description="Template do prompt para a IA. Use {{variavel}} para substituir valores das variáveis do fluxo. Exemplo: {{user_message}} será substituído pelo valor da variável user_message."
            value={config.promptTemplate || ''}
            onChange={(e) => updateConfigField('promptTemplate', e.target.value)}
            placeholder="Ex.: Você é um assistente útil. O usuário disse: {{user_message}}. Responda de forma amigável."
            required
            rows={6}
          />
          <TextField
            label="Variável de Saída"
            description="Nome da variável onde a resposta da IA será armazenada. Esta variável pode ser usada em outros nós do fluxo."
            value={config.outputVariable || ''}
            onChange={(e) => updateConfigField('outputVariable', e.target.value)}
            placeholder="Ex.: ai_answer"
            className="font-mono"
          />
          <JsonField
            label="Schema de Saída (Opcional)"
            description="Schema JSON Schema para validar e estruturar a resposta da IA. Se definido, a resposta da IA será validada contra este schema. Deixe vazio para resposta em texto livre."
            value={config.outputSchema ? JSON.stringify(config.outputSchema, null, 2) : ''}
            onChange={(rawValue) => {
              try {
                const parsed = rawValue.trim() ? JSON.parse(rawValue) : null;
                updateConfigField('outputSchema', parsed);
              } catch {
                // Mantém raw para edição incremental
              }
            }}
            placeholder={`{
  "type": "object",
  "properties": {
    "answer": {
      "type": "string",
      "description": "Resposta da IA"
    }
  },
  "required": ["answer"]
}`}
            rows={8}
            expectedType="object"
          />
          <TextField
            label="Texto de Fallback"
            description="Mensagem exibida caso a IA falhe, não esteja disponível ou a validação do schema falhe. Esta mensagem será enviada ao usuário como resposta."
            value={config.fallbackText || ''}
            onChange={(e) => updateConfigField('fallbackText', e.target.value)}
            placeholder="Ex.: Desculpe, não consegui processar sua solicitação no momento."
          />
        </div>
      )}

      {type === 'router' && (
        <div className="space-y-3">
          <JsonField
            label="Regras de Roteamento"
            description="Array de regras que determinam o próximo nó. Cada regra tem uma condição e um next. As regras são avaliadas em ordem da primeira para a última."
            value={JSON.stringify(config.rules || [], null, 2)}
            onChange={(rawValue) => updateJsonField('rules', rawValue)}
            placeholder={`[
  {
    "condition": {
      "op": "contains",
      "var": "user_message",
      "value": "suporte"
    },
    "next": "node-suporte"
  },
  {
    "condition": {
      "op": "always"
    },
    "next": "node-default"
  }
]`}
            required
            rows={10}
            expectedType="array"
          />
          <div className="p-3 rounded-md bg-bg-tertiary/30 border border-border-default/30">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5">
              Operadores de Condição
            </div>
            <div className="text-[10px] text-text-secondary space-y-1">
              <div><code className="text-accent-primary">"op": "always"</code> - Sempre verdadeiro (fallback)</div>
              <div><code className="text-accent-primary">"op": "contains"</code> - Verifica se variável contém valor</div>
              <div><code className="text-accent-primary">"op": "equals"</code> - Verifica igualdade exata</div>
            </div>
          </div>
        </div>
      )}

      {type === 'set_variable' && (
        <JsonField
          label="Atribuições de Variáveis"
          description="Objeto JSON onde cada chave é o nome de uma variável e o valor será atribuído a ela. Valores podem ser strings, números, booleanos ou objetos."
          value={JSON.stringify(config.assignments || {}, null, 2)}
          onChange={(rawValue) => updateJsonField('assignments', rawValue)}
          placeholder={`{
  "intent": "greeting",
  "user_name": "João",
  "count": 0
}`}
          required
          rows={8}
          expectedType="object"
        />
      )}

      {/* Fallback genérico para outros tipos (start, end) */}
      {type !== 'message' && type !== 'user_input' && type !== 'handoff' && type !== 'ai' && type !== 'router' && type !== 'set_variable' && (
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
            <JsonField
              label="Configuração Avançada"
              description="Configuração customizada em formato JSON. Use apenas se necessário."
              value={JSON.stringify(config, null, 2)}
              onChange={(rawValue) => {
                try {
                  const parsed = JSON.parse(rawValue || '{}');
                  onChangeConfig(parsed);
                } catch {
                  // Mantém raw para edição incremental
                }
              }}
              rows={6}
              expectedType="object"
            />
          )}
        </div>
      )}
    </div>
  );
}


