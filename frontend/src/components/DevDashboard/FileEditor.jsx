import React from 'react';
import { useTheme } from '../../styles/themeContext';

/**
 * Componente para renderizar formulário JSON recursivo
 */
function JsonFormField({ data, path = '', onUpdate, rootPath = '', theme }) {
  if (data === null || data === undefined) {
    return (
      <div key={path} className="p-3 rounded bg-bg-secondary">
        <label className="block text-sm font-medium mb-1 text-text-secondary">
          {path || 'Valor'}
        </label>
        <input
          type="text"
          value="null"
          disabled
          className="w-full p-2 rounded"
          style={{
            backgroundColor: theme.colors.bg.tertiary,
            border: `1px solid ${theme.colors.border.default}`,
            color: theme.colors.text.tertiary,
          }}
        />
      </div>
    );
  }

  if (Array.isArray(data)) {
    return (
      <div key={path} className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">📋</span>
          <label className="font-semibold text-text-primary">
            {path || 'Array'}
          </label>
          <span className="text-xs px-2 py-1 rounded" style={{ 
            backgroundColor: theme.colors.bg.tertiary,
            color: theme.colors.text.tertiary
          }}>
            {data.length} item{data.length !== 1 ? 's' : ''}
          </span>
        </div>
        {data.map((item, index) => (
          <div key={index} className="ml-4 p-3 rounded border-l-2" style={{ 
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.bg.secondary
          }}>
            <div className="text-xs mb-2 font-medium text-text-secondary">
              Item {index + 1}
            </div>
            <JsonFormField 
              data={item} 
              path={`${path}[${index}]`} 
              onUpdate={(newValue, itemPath) => {
                const newData = [...data];
                newData[index] = newValue;
                onUpdate(newData, rootPath || path);
              }} 
              rootPath={rootPath || path}
              theme={theme}
            />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    return (
      <div key={path} className="space-y-4">
        {path && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📦</span>
            <label className="font-semibold text-base text-text-primary">
              {path}
            </label>
          </div>
        )}
        {Object.entries(data).map(([key, value]) => {
          const currentPath = path ? `${path}.${key}` : key;
          
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return (
              <div key={key} className="ml-2 p-4 rounded-lg border" style={{ 
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.bg.secondary
              }}>
                <JsonFormField 
                  data={value} 
                  path={currentPath} 
                  onUpdate={(newValue, valuePath) => {
                    const newData = { ...data };
                    newData[key] = newValue;
                    onUpdate(newData, rootPath || currentPath);
                  }} 
                  rootPath={rootPath || currentPath}
                  theme={theme}
                />
              </div>
            );
          } else if (Array.isArray(value)) {
            return (
              <div key={key} className="ml-2">
                <JsonFormField 
                  data={value} 
                  path={currentPath} 
                  onUpdate={(newValue, valuePath) => {
                    const newData = { ...data };
                    newData[key] = newValue;
                    onUpdate(newData, rootPath || currentPath);
                  }} 
                  rootPath={rootPath || currentPath}
                  theme={theme}
                />
              </div>
            );
          } else {
            return (
              <div key={key} className="mb-3">
                <label className="block text-sm font-medium mb-2 text-text-primary">
                  {key}
                  {typeof value === 'string' && value.length > 100 && (
                    <span className="ml-2 text-xs text-text-tertiary">
                      ({value.length} caracteres)
                    </span>
                  )}
                </label>
                {typeof value === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => {
                        const newData = { ...data };
                        newData[key] = e.target.checked;
                        onUpdate(newData, rootPath || currentPath);
                      }}
                      className="w-5 h-5"
                      style={{ accentColor: theme.colors.accent.primary }}
                    />
                    <span className="text-sm text-text-secondary">
                      {value ? '✅ Ativado' : '❌ Desativado'}
                    </span>
                  </label>
                ) : typeof value === 'number' ? (
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => {
                      const newData = { ...data };
                      newData[key] = parseFloat(e.target.value) || 0;
                      onUpdate(newData, rootPath || currentPath);
                    }}
                    className="w-full p-2 rounded"
                    style={{
                      backgroundColor: theme.colors.bg.secondary,
                      border: `1px solid ${theme.colors.border.default}`,
                      color: theme.colors.text.primary,
                    }}
                  />
                ) : (
                  <textarea
                    value={String(value)}
                    onChange={(e) => {
                      const newData = { ...data };
                      newData[key] = e.target.value;
                      onUpdate(newData, rootPath || currentPath);
                    }}
                    rows={typeof value === 'string' && value.length > 100 ? 4 : 1}
                    className="w-full p-2 rounded resize-none"
                    style={{
                      backgroundColor: theme.colors.bg.secondary,
                      border: `1px solid ${theme.colors.border.default}`,
                      color: theme.colors.text.primary,
                      fontFamily: 'inherit',
                    }}
                  />
                )}
              </div>
            );
          }
        })}
      </div>
    );
  }

  // Valores primitivos
  return (
    <div key={path} className="p-3 rounded bg-bg-secondary">
      <label className="block text-sm font-medium mb-1 text-text-secondary">
        {path || 'Valor'}
      </label>
      <input
        type="text"
        value={String(data)}
        onChange={(e) => onUpdate(e.target.value)}
        className="w-full p-2 rounded"
        style={{
          backgroundColor: theme.colors.bg.tertiary,
          border: `1px solid ${theme.colors.border.default}`,
          color: theme.colors.text.primary,
        }}
      />
    </div>
  );
}

/**
 * Editor de arquivos genérico
 */
export function FileEditor({ 
  selectedFile, 
  fileContent, 
  setFileContent, 
  fileLoading, 
  fileSaving, 
  fileError, 
  jsonData,
  onSave,
  onUpdateJson
}) {
  const { theme } = useTheme();

  if (!selectedFile) {
    return (
      <div className="rounded-lg p-12 text-center" style={{ 
        backgroundColor: theme.colors.bg.secondary,
        border: `2px dashed ${theme.colors.border.default}`,
        minHeight: '600px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div className="text-6xl mb-4">📝</div>
        <h3 className="text-2xl font-bold mb-3 text-text-primary">
          Nenhum arquivo selecionado
        </h3>
        <p className="text-base mb-2 text-text-secondary">
          Selecione um arquivo da lista ao lado para visualizar e editar
        </p>
      </div>
    );
  }

  const isJson = selectedFile.path.endsWith('.json') && jsonData;

  return (
    <div className="rounded-lg" style={{ 
      backgroundColor: theme.colors.bg.secondary,
      border: `2px solid ${theme.colors.border.default}`,
      boxShadow: theme.name === 'dark' ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.1)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '600px',
      maxHeight: '800px'
    }}>
      {/* Header */}
      <div className="p-5 border-b" style={{ 
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.bg.primary
      }}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="text-3xl">
                {selectedFile.type === 'contracts' ? '📋' : selectedFile.type === 'documents' ? '📚' : '🔧'}
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-xl mb-1 text-text-primary">
                  {selectedFile.path.split('/').pop()}
                </h3>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm px-3 py-1 rounded-full" style={{ 
                    backgroundColor: selectedFile.type === 'contracts' ? '#3b82f620' : '#8b5cf620',
                    color: selectedFile.type === 'contracts' ? '#3b82f6' : '#8b5cf6',
                    fontWeight: '500'
                  }}>
                    {selectedFile.type === 'contracts' ? '📄 Contrato' : selectedFile.type === 'documents' ? '📚 Documento' : '🔧 Nó'}
                  </span>
                  {selectedFile.modified && (
                    <span className="text-xs text-text-secondary">
                      📅 Modificado: {new Date(selectedFile.modified).toLocaleString('pt-BR')}
                    </span>
                  )}
                  <span className="text-xs text-text-tertiary">
                    📊 {(selectedFile.size / 1024).toFixed(2)} KB
                  </span>
                </div>
              </div>
            </div>
            {selectedFile.path.includes('/') && (
              <div className="text-xs mt-2 text-text-secondary">
                📁 {selectedFile.path}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={fileSaving || fileLoading}
            className="px-6 py-2.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            style={{ 
              backgroundColor: fileSaving || fileLoading
                ? theme.colors.text.tertiary
                : theme.colors.status.success,
              color: '#ffffff',
              boxShadow: !fileSaving && !fileLoading ? '0 2px 8px rgba(16, 185, 129, 0.3)' : 'none'
            }}
            onMouseEnter={(e) => {
              if (!fileSaving && !fileLoading) {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!fileSaving && !fileLoading) {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
              }
            }}
          >
            {fileSaving ? '⏳ Salvando...' : '💾 Salvar Alterações'}
          </button>
          {isJson && (
            <div className="text-xs px-3 py-1.5 rounded" style={{ 
              backgroundColor: theme.colors.status.info + '20',
              color: theme.colors.status.info
            }}>
              ⚠️ JSON será validado antes de salvar
            </div>
          )}
        </div>
        {fileError && (
          <div className="mt-3 p-3 rounded-lg text-sm flex items-center gap-2" style={{ 
            backgroundColor: theme.colors.status.error + '20',
            border: `1px solid ${theme.colors.status.error}40`,
            color: theme.colors.status.error
          }}>
            <span>❌</span>
            <span>{fileError}</span>
          </div>
        )}
      </div>

      {/* Área de Edição */}
      <div className="flex-1 p-5 overflow-auto" style={{ 
        backgroundColor: theme.colors.bg.primary,
        maxHeight: 'calc(800px - 200px)'
      }}>
        {fileLoading ? (
          <div className="text-center py-12 text-text-tertiary">
            <div className="text-4xl mb-4">⏳</div>
            <p className="text-lg">Carregando arquivo...</p>
          </div>
        ) : isJson ? (
          <div className="space-y-6">
            <JsonFormField 
              data={jsonData} 
              path="" 
              onUpdate={(newData, currentPath = '') => {
                onUpdateJson(newData, currentPath);
              }} 
              rootPath=""
              theme={theme}
            />
          </div>
        ) : (
          <textarea
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            className="w-full font-mono text-sm p-4 rounded-lg resize-none"
            style={{
              backgroundColor: theme.name === 'dark' ? '#1a1a1a' : '#ffffff',
              border: `2px solid ${theme.colors.border.default}`,
              color: theme.colors.text.primary,
              fontFamily: '"Fira Code", "Consolas", "Monaco", "Courier New", monospace',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              minHeight: '500px',
              tabSize: 2,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            spellCheck={false}
            placeholder="Conteúdo do arquivo aparecerá aqui..."
          />
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t text-xs" style={{ 
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.bg.primary
      }}>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-text-secondary">
            💡 <strong>Dica:</strong> {selectedFile.type === 'contracts' 
              ? 'Contratos definem a estrutura de dados. Alterações podem afetar a compatibilidade do sistema.'
              : selectedFile.type === 'documents' 
              ? 'Documentos orientam o comportamento da IA. Teste as alterações antes de usar em produção.'
              : 'Definições de nós controlam quais tipos de nós estão disponíveis nos fluxos.'}
          </span>
        </div>
      </div>
    </div>
  );
}

