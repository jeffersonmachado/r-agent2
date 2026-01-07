# Suporte Completo a Envio de Arquivos no Chat

## 📋 Visão Geral

Este documento detalha o que precisa ser implementado para suporte completo a envio de arquivos no chat, permitindo que usuários enviem arquivos (imagens, documentos, PDFs, etc.) durante conversas e que o sistema processe e utilize esses arquivos no contexto da conversa.

## 🎯 Objetivos

1. Permitir upload de arquivos no componente de chat
2. Processar e extrair conteúdo de arquivos (texto, imagens, PDFs)
3. Indexar arquivos no RAG quando relevante
4. Enviar arquivos como parte do contexto da mensagem para a engine
5. Exibir arquivos enviados/recebidos na interface do chat
6. Suportar múltiplos formatos de arquivo

## 📦 Componentes que Precisam ser Modificados/Criados

### 1. Frontend - Componente de Chat

#### 1.1. `FlowTestChat.jsx` - Modificações Necessárias

**Localização:** `frontend/src/components/FlowTestChat.jsx`

**Mudanças:**

1. **Adicionar estado para arquivos anexados:**
```javascript
const [attachedFiles, setAttachedFiles] = useState([]);
const [uploadingFiles, setUploadingFiles] = useState([]);
const fileInputRef = useRef(null);
```

2. **Adicionar botão de anexo no input:**
```jsx
<div className="flow-test-chat-input p-4 border-t border-border-default bg-bg-secondary">
  <form className="flex gap-2">
    {/* Botão de anexo */}
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className="px-3 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-tertiary/80 transition-colors"
      title="Anexar arquivo"
    >
      📎
    </button>
    
    {/* Input de arquivo oculto */}
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={handleFileSelect}
      accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv"
    />
    
    {/* Input de texto existente */}
    <input
      ref={inputRef}
      type="text"
      value={inputText}
      onChange={(e) => setInputText(e.target.value)}
      // ... resto do código
    />
    
    <button type="submit">Enviar</button>
  </form>
  
  {/* Preview de arquivos anexados */}
  {attachedFiles.length > 0 && (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachedFiles.map((file) => (
        <div key={file.id} className="flex items-center gap-2 p-2 bg-bg-tertiary rounded">
          <span>{file.name}</span>
          <button onClick={() => removeFile(file.id)}>✕</button>
        </div>
      ))}
    </div>
  )}
</div>
```

3. **Adicionar funções de manipulação de arquivos:**
```javascript
const handleFileSelect = async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const newFiles = files.map(file => ({
    file,
    id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: file.name,
    size: file.size,
    type: file.type,
    status: 'pending', // pending, uploading, ready, error
    preview: null, // Para imagens
    content: null, // Conteúdo extraído
  }));

  setAttachedFiles([...attachedFiles, ...newFiles]);
  
  // Processa cada arquivo
  newFiles.forEach(fileObj => processFile(fileObj));
};

const processFile = async (fileObj) => {
  try {
    setAttachedFiles(prev => prev.map(f => 
      f.id === fileObj.id ? { ...f, status: 'uploading' } : f
    ));

    // Extrai conteúdo baseado no tipo
    let content = null;
    let preview = null;

    if (fileObj.file.type.startsWith('image/')) {
      // Para imagens, cria preview
      preview = await createImagePreview(fileObj.file);
      // Para imagens, pode precisar de OCR ou descrição por IA
      content = await extractImageContent(fileObj.file);
    } else if (fileObj.file.type === 'application/pdf') {
      content = await extractPdfContent(fileObj.file);
    } else if (fileObj.file.type.startsWith('text/')) {
      content = await extractTextContent(fileObj.file);
    } else {
      // Para outros tipos, tenta extrair como texto
      content = await extractTextContent(fileObj.file);
    }

    setAttachedFiles(prev => prev.map(f => 
      f.id === fileObj.id 
        ? { ...f, status: 'ready', content, preview } 
        : f
    ));
  } catch (error) {
    logger.error('Erro ao processar arquivo:', error);
    setAttachedFiles(prev => prev.map(f => 
      f.id === fileObj.id 
        ? { ...f, status: 'error', error: error.message } 
        : f
    ));
  }
};

const removeFile = (fileId) => {
  setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
};
```

4. **Modificar `handleSend` para incluir arquivos:**
```javascript
const handleSend = async () => {
  if (!inputText.trim() && attachedFiles.length === 0) return;
  if (!isRunning) return;

  const userMessage = {
    id: `msg-${Date.now()}-${Math.random()}`,
    role: 'user',
    text: inputText.trim(),
    files: attachedFiles.filter(f => f.status === 'ready').map(f => ({
      name: f.name,
      type: f.type,
      size: f.size,
      content: f.content,
      preview: f.preview,
    })),
    timestamp: new Date().toISOString(),
  };

  setMessages((prev) => [...prev, userMessage]);
  
  // Prepara input com texto e arquivos
  const input = {
    text: inputText.trim(),
    files: userMessage.files,
  };
  
  setInputText('');
  setAttachedFiles([]);

  await sendMessage(input);
};
```

5. **Modificar renderização de mensagens para exibir arquivos:**
```jsx
{messages.map((msg) => (
  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[80%] rounded-lg px-4 py-2 ${...}`}>
      {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
      
      {/* Renderiza arquivos anexados */}
      {msg.files && msg.files.length > 0 && (
        <div className="mt-2 space-y-2">
          {msg.files.map((file, idx) => (
            <div key={idx} className="p-2 bg-bg-tertiary rounded">
              {file.preview && (
                <img src={file.preview} alt={file.name} className="max-w-full h-auto rounded mb-2" />
              )}
              <div className="flex items-center gap-2">
                <span className="text-sm">📎 {file.name}</span>
                <span className="text-xs text-text-tertiary">
                  {(file.size / 1024).toFixed(2)} KB
                </span>
              </div>
              {file.content && (
                <p className="text-xs text-text-secondary mt-1 line-clamp-3">
                  {file.content.substring(0, 200)}...
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* ... resto do código de opções */}
    </div>
  </div>
))}
```

#### 1.2. Criar utilitários de processamento de arquivos

**Novo arquivo:** `frontend/src/utils/fileProcessor.js`

```javascript
/**
 * Utilitários para processar arquivos no chat
 */

/**
 * Cria preview de imagem
 */
export async function createImagePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Extrai conteúdo de texto de um arquivo
 */
export async function extractTextContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Extrai conteúdo de PDF (requer biblioteca externa)
 */
export async function extractPdfContent(file) {
  // TODO: Implementar com pdf.js ou similar
  // Por enquanto, retorna placeholder
  return `[Conteúdo do PDF: ${file.name}]`;
}

/**
 * Extrai conteúdo de imagem (OCR ou descrição por IA)
 */
export async function extractImageContent(file) {
  // TODO: Implementar OCR ou chamada para IA para descrever imagem
  // Por enquanto, retorna placeholder
  return `[Imagem: ${file.name}]`;
}

/**
 * Valida tamanho e tipo de arquivo
 */
export function validateFile(file, maxSizeMB = 10, allowedTypes = []) {
  const maxSize = maxSizeMB * 1024 * 1024;
  
  if (file.size > maxSize) {
    throw new Error(`Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`);
  }
  
  if (allowedTypes.length > 0 && !allowedTypes.some(type => file.type.match(type))) {
    throw new Error(`Tipo de arquivo não permitido. Tipos permitidos: ${allowedTypes.join(', ')}`);
  }
  
  return true;
}
```

### 2. Frontend - Hook useFlowRunner

#### 2.1. Modificar `useFlowRunner.js`

**Localização:** `frontend/src/hooks/useFlowRunner.js`

**Mudanças:**

1. **Modificar `sendMessage` para aceitar arquivos:**
```javascript
const sendMessage = useCallback(
  async (input) => {
    // input pode ser string (compatibilidade) ou objeto { text, files }
    const userText = typeof input === 'string' ? input : input.text || '';
    const files = typeof input === 'object' ? (input.files || []) : [];

    if (!isRunning || !conversationState || processingRef.current) {
      return;
    }

    if (!userText.trim() && files.length === 0) {
      return;
    }

    try {
      processingRef.current = true;
      setIsProcessing(true);
      
      // Prepara input com texto e arquivos
      const stepInput = { 
        text: userText.trim(),
        files: files.map(f => ({
          name: f.name,
          type: f.type,
          content: f.content,
        }))
      };
      
      let currentState = conversationState;
      const outputs = [];
      // ... resto do código de processamento
    } catch (error) {
      // ... tratamento de erro
    }
  },
  [isRunning, conversationState, /* ... outras dependências */]
);
```

### 3. Engine - Processamento de Arquivos

#### 3.1. Modificar `userInputNodeHandler`

**Localização:** `engine/nodes/basicNodes.js`

**Mudanças:**

```javascript
async function userInputNodeHandler(node, state, input, deps = null) {
  // input agora pode ter { text, files }
  const userText = input?.text || '';
  const files = input?.files || [];

  // Processa arquivos se houver
  if (files.length > 0) {
    // Salva arquivos no estado para uso posterior
    state.variables = state.variables || {};
    state.variables.lastFiles = files;
    
    // Indexa arquivos no RAG se configurado
    if (node.config?.autoIndexFiles) {
      await indexFilesInRag(files, state.tenantId);
    }
    
    // Extrai texto dos arquivos para contexto
    const filesText = files
      .map(f => f.content || `[Arquivo: ${f.name}]`)
      .join('\n\n');
    
    // Adiciona conteúdo dos arquivos ao texto do usuário
    const enhancedText = userText 
      ? `${userText}\n\n[Arquivos anexados]:\n${filesText}`
      : `[Arquivos anexados]:\n${filesText}`;
    
    return {
      state: {
        ...state,
        variables: {
          ...state.variables,
          lastUserInput: enhancedText,
        },
      },
      output: {
        type: 'message',
        text: enhancedText,
        files: files,
      },
    };
  }

  // Comportamento original se não houver arquivos
  return {
    state: {
      ...state,
      variables: {
        ...state.variables || {},
        lastUserInput: userText,
      },
    },
    output: {
      type: 'message',
      text: userText,
    },
  };
}
```

#### 3.2. Criar função de indexação de arquivos no RAG

**Novo arquivo:** `engine/services/fileRagService.js`

```javascript
const ragService = require('../../api/services/ragService');
const logger = require('../../api/utils/logger');

/**
 * Indexa arquivos no RAG
 */
async function indexFilesInRag(files, tenantId) {
  const results = [];
  
  for (const file of files) {
    try {
      if (!file.content) continue;
      
      const documentData = {
        title: file.name,
        content: file.content,
        metadata: {
          source: 'chat_upload',
          category: getFileCategory(file.type),
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
        },
        autoIndex: true,
      };
      
      // Usa o serviço de documentos RAG existente
      const ragDocumentsService = require('../../api/services/ragDocumentsService');
      const result = await ragDocumentsService.createDocument(documentData, tenantId);
      
      results.push({
        file: file.name,
        success: result.success,
        documentId: result.document?.id,
      });
    } catch (error) {
      logger.error('Erro ao indexar arquivo no RAG:', error);
      results.push({
        file: file.name,
        success: false,
        error: error.message,
      });
    }
  }
  
  return results;
}

function getFileCategory(fileType) {
  if (fileType.startsWith('image/')) return 'imagem';
  if (fileType === 'application/pdf') return 'documento';
  if (fileType.startsWith('text/')) return 'texto';
  return 'outro';
}

module.exports = {
  indexFilesInRag,
};
```

### 4. Backend - API de Upload de Arquivos

#### 4.1. Criar endpoint para upload de arquivos do chat

**Modificar:** `api/server.js`

**Adicionar endpoint:**

```javascript
// POST /chat/upload-file - Upload de arquivo do chat
if (method === 'POST' && pathname === '/chat/upload-file') {
  // Valida autenticação
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    unauthorized(res);
    return;
  }

  try {
    // Processa multipart/form-data
    const formData = await parseMultipartFormData(req);
    const file = formData.files?.file;
    
    if (!file) {
      badRequest(res, 'Arquivo é obrigatório');
      return;
    }

    // Valida tamanho (ex: 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      badRequest(res, `Arquivo muito grande. Tamanho máximo: 10MB`);
      return;
    }

    // Processa arquivo
    const content = await processFileContent(file);
    
    // Retorna resultado
    sendJson(res, 200, {
      success: true,
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
        content: content,
      },
    });
  } catch (err) {
    logger.error('Erro ao processar upload de arquivo:', err);
    sendJson(res, 500, { 
      error: 'internal_error', 
      message: err.message || 'Erro ao processar arquivo' 
    });
  }
  return;
}
```

#### 4.2. Criar utilitário para processar multipart/form-data

**Novo arquivo:** `api/utils/multipartParser.js`

```javascript
/**
 * Parser simples de multipart/form-data
 * Nota: Para produção, considere usar uma biblioteca como 'busboy' ou 'formidable'
 */

const { Readable } = require('stream');

async function parseMultipartFormData(req) {
  // TODO: Implementar parser de multipart/form-data
  // Por enquanto, retorna estrutura básica
  // Em produção, usar biblioteca como 'busboy'
  
  return {
    fields: {},
    files: {},
  };
}

module.exports = {
  parseMultipartFormData,
};
```

### 5. Integração com RAG

#### 5.1. Modificar query RAG para considerar arquivos do chat

**Modificar:** `api/services/ragService.js`

Quando um arquivo é enviado no chat, ele pode ser automaticamente indexado no RAG para uso futuro. A função `queryRag` já deve buscar documentos indexados, incluindo os enviados via chat.

### 6. Dependências Necessárias

#### 6.1. Frontend

```json
{
  "dependencies": {
    "pdfjs-dist": "^3.0.0", // Para processar PDFs
    "tesseract.js": "^4.0.0" // Para OCR em imagens (opcional)
  }
}
```

#### 6.2. Backend

```json
{
  "dependencies": {
    "busboy": "^1.6.0", // Para processar multipart/form-data
    "pdf-parse": "^1.1.1", // Para extrair texto de PDFs
    "sharp": "^0.32.0" // Para processar imagens (opcional)
  }
}
```

## 📝 Checklist de Implementação

### Fase 1: Frontend Básico
- [ ] Adicionar botão de anexo no `FlowTestChat`
- [ ] Implementar seleção de arquivos
- [ ] Criar preview de arquivos anexados
- [ ] Modificar `handleSend` para incluir arquivos
- [ ] Exibir arquivos nas mensagens do chat

### Fase 2: Processamento de Arquivos
- [ ] Criar `fileProcessor.js` com funções de extração
- [ ] Implementar extração de texto de arquivos de texto
- [ ] Implementar preview de imagens
- [ ] Adicionar validação de tamanho e tipo

### Fase 3: Integração com Engine
- [ ] Modificar `useFlowRunner` para aceitar arquivos
- [ ] Modificar `userInputNodeHandler` para processar arquivos
- [ ] Adicionar arquivos ao contexto da conversa

### Fase 4: Backend e RAG
- [ ] Criar endpoint `/chat/upload-file`
- [ ] Implementar parser de multipart/form-data
- [ ] Criar função de indexação de arquivos no RAG
- [ ] Integrar indexação automática no chat

### Fase 5: Melhorias
- [ ] Adicionar suporte a PDF (extração de texto)
- [ ] Adicionar OCR para imagens (opcional)
- [ ] Adicionar descrição de imagens por IA (opcional)
- [ ] Implementar compressão de imagens
- [ ] Adicionar progresso de upload
- [ ] Implementar drag-and-drop de arquivos

## 🔒 Considerações de Segurança

1. **Validação de tipos de arquivo:** Restringir tipos permitidos
2. **Validação de tamanho:** Limitar tamanho máximo (ex: 10MB)
3. **Sanitização:** Validar e sanitizar conteúdo extraído
4. **Quarantena:** Considerar quarentena para arquivos suspeitos
5. **Rate limiting:** Limitar número de uploads por usuário/tempo

## 📊 Limitações Conhecidas

1. **PDF:** Extração de texto de PDFs complexos pode ser limitada
2. **Imagens:** OCR requer biblioteca externa e pode ser lento
3. **Tamanho:** Arquivos grandes podem impactar performance
4. **Storage:** Arquivos não são persistidos permanentemente (apenas conteúdo extraído)

## 🚀 Próximos Passos

1. Começar pela Fase 1 (Frontend Básico)
2. Testar com arquivos de texto simples
3. Expandir para outros tipos de arquivo gradualmente
4. Adicionar integração com RAG quando básico estiver funcionando
5. Implementar melhorias conforme necessário

