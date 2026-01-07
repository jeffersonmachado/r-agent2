# Padrão de Telas Frontend

## Estrutura de Páginas

### Container Principal

**Opção 1 (SupportPage style):**
```jsx
<div className="support-page">
  <div className="support-header">
    <h1>Título da Página</h1>
    <div className="support-controls">
      <Button onClick={handleAction}>Ação</Button>
    </div>
  </div>
  {/* Conteúdo */}
</div>
```

**Opção 2 (QuickRepliesPage style):**
```jsx
<div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
  <div className="max-w-7xl mx-auto">
    <div className="mb-6 flex justify-between items-center">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Título
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Descrição
        </p>
      </div>
      <Button onClick={handleAction}>Ação</Button>
    </div>
    {/* Conteúdo */}
  </div>
</div>
```

### Cards/Containers

**Padrão 1 (AgentsPage):**
```jsx
<div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
  <h3 className="text-xl font-semibold text-text-primary mb-6">
    Título do Card
  </h3>
  {/* Conteúdo */}
</div>
```

**Padrão 2 (QuickRepliesPage):**
```jsx
<div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
  {/* Conteúdo */}
</div>
```

### Inputs

**Padrão AgentsPage:**
```jsx
<label className="block mb-2 text-sm font-medium text-text-primary">
  Label
</label>
<input
  type="text"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
/>
```

**Padrão QuickRepliesPage:**
```jsx
<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
  Label
</label>
<input
  type="text"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
/>
```

### Modais

```jsx
{showModal && (
  <div 
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    onClick={(e) => {
      if (e.target === e.currentTarget) {
        setShowModal(false);
      }
    }}
  >
    <div 
      className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-2xl font-bold text-text-primary mb-6">
        Título do Modal
      </h2>
      {/* Formulário */}
    </div>
  </div>
)}
```

### Botões

```jsx
import { Button } from '../styles/Button';

<Button onClick={handleClick} variant="primary">
  Texto do Botão
</Button>

// Variantes: 'primary', 'danger', 'ghost', 'default'
```

### Hooks Comuns

```jsx
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';

const { agent, isAuthenticated } = useAuth();
const { navigate } = useRouter();
const { showToast, ToastContainer } = useToast();
const { confirm, ConfirmDialog } = useConfirmDialog();
```

### Estrutura de API

Arquivo em `frontend/src/api/`:

```javascript
import { fetchJson } from './client';

export async function listDocuments(filters = {}) {
  const params = new URLSearchParams();
  if (filters.category) params.append('category', filters.category);
  const query = params.toString();
  return fetchJson(`/rag/documents${query ? `?${query}` : ''}`);
}

export async function createDocument(data) {
  return fetchJson('/rag/documents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
```

### Loading States

```jsx
{loading ? (
  <div className="text-center py-12">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
    <p className="text-text-secondary">Carregando...</p>
  </div>
) : (
  {/* Conteúdo */}
)}
```

### Tabelas/Listas

```jsx
<div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
  <table className="w-full">
    <thead className="bg-gray-50 dark:bg-gray-700">
      <tr>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
          Coluna
        </th>
      </tr>
    </thead>
    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
            {item.name}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

## Regras Gerais

1. **Sempre usar dark mode:** Classes devem ter variantes `dark:`
2. **Componentes reutilizáveis:** Usar `Button`, `Toast`, `ConfirmDialog`
3. **Proteção de rotas:** Verificar autenticação com `useAuth`
4. **Loading states:** Sempre mostrar feedback visual
5. **Error handling:** Usar `showToast` para erros
6. **Confirmações:** Usar `confirm` para ações destrutivas

