# Guia de Atualização do Frontend para PostgreSQL

## Mudanças Necessárias

### 1. Endpoint de Configuração de IA

**Antes (config.json global):**
```javascript
// ❌ Antigo - lê configuração global
const response = await fetch('/config');
const config = await response.json();
const aiConfig = config.ai; // Pode conter API keys (RISCO!)
```

**Depois (tenant-aware):**
```javascript
// ✅ Novo - lê configuração por tenant
const tenantKey = getCurrentTenantKey(); // Ex: "tenant-acme"
const response = await fetch(`/tenants/${tenantKey}/ai-config`);
const aiConfig = await response.json();
// aiConfig não contém API keys (seguro)
```

### 2. Salvar Configuração de IA

**Antes:**
```javascript
// ❌ Antigo - salva em config.json global
await fetch('/config', {
  method: 'PUT',
  body: JSON.stringify({
    ai: {
      enabled: true,
      provider: 'openai',
      // ...
    }
  })
});
```

**Depois:**
```javascript
// ✅ Novo - salva por tenant
const tenantKey = getCurrentTenantKey();
await fetch(`/tenants/${tenantKey}/ai-config`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    enabled: true,
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
    max_tokens: 2000
  })
});
```

### 3. Salvar Credenciais de IA (API Keys)

**Antes:**
```javascript
// ❌ Antigo - API key no config.json (INSEGURO!)
await fetch('/config', {
  method: 'PUT',
  body: JSON.stringify({
    ai: {
      openai: {
        apiKey: 'sk-...' // ⚠️ RISCO DE VAZAMENTO
      }
    }
  })
});
```

**Depois:**
```javascript
// ✅ Novo - endpoint separado, criptografado
const tenantKey = getCurrentTenantKey();
await fetch(`/tenants/${tenantKey}/ai-credentials`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    provider: 'openai',
    apiKey: 'sk-...' // Será criptografado no backend
  })
});
```

**IMPORTANTE:**
- API keys nunca são retornadas via API
- Não armazene API keys no localStorage ou sessionStorage
- Sempre use o endpoint `/ai-credentials` para salvar credenciais

### 4. Exemplo Completo: Componente React

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';

function AIConfigPage() {
  const { token, tenantKey } = useAuth();
  const [aiConfig, setAiConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Carrega configuração de IA
  useEffect(() => {
    async function loadAIConfig() {
      try {
        const response = await fetch(`/tenants/${tenantKey}/ai-config`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const config = await response.json();
          setAiConfig(config);
        }
      } catch (err) {
        console.error('Erro ao carregar configuração de IA:', err);
      } finally {
        setLoading(false);
      }
    }

    if (tenantKey && token) {
      loadAIConfig();
    }
  }, [tenantKey, token]);

  // Salva configuração de IA
  async function saveAIConfig(config) {
    setSaving(true);
    try {
      const response = await fetch(`/tenants/${tenantKey}/ai-config`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        const saved = await response.json();
        setAiConfig(saved);
        alert('Configuração salva com sucesso!');
      } else {
        const error = await response.json();
        alert(`Erro: ${error.message}`);
      }
    } catch (err) {
      console.error('Erro ao salvar configuração:', err);
      alert('Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  }

  // Salva credenciais (API key)
  async function saveCredentials(provider, apiKey) {
    if (!apiKey || apiKey.trim().length === 0) {
      alert('API key não pode estar vazia');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/tenants/${tenantKey}/ai-credentials`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ provider, apiKey })
      });

      if (response.ok) {
        alert('Credenciais salvas com sucesso!');
      } else {
        const error = await response.json();
        alert(`Erro: ${error.message}`);
      }
    } catch (err) {
      console.error('Erro ao salvar credenciais:', err);
      alert('Erro ao salvar credenciais');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div>Carregando...</div>;
  }

  return (
    <div>
      <h2>Configuração de IA</h2>
      
      {/* Configurações gerais */}
      <form onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        saveAIConfig({
          enabled: formData.get('enabled') === 'on',
          provider: formData.get('provider'),
          model: formData.get('model'),
          temperature: parseFloat(formData.get('temperature')),
          max_tokens: parseInt(formData.get('max_tokens'))
        });
      }}>
        <label>
          Habilitado:
          <input 
            type="checkbox" 
            name="enabled" 
            defaultChecked={aiConfig?.enabled}
          />
        </label>
        
        <label>
          Provider:
          <select name="provider" defaultValue={aiConfig?.provider || 'openai'}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        
        <label>
          Modelo:
          <input 
            type="text" 
            name="model" 
            defaultValue={aiConfig?.model || 'gpt-4'}
          />
        </label>
        
        <label>
          Temperatura:
          <input 
            type="number" 
            name="temperature" 
            step="0.1" 
            min="0" 
            max="2"
            defaultValue={aiConfig?.temperature || 0.7}
          />
        </label>
        
        <label>
          Max Tokens:
          <input 
            type="number" 
            name="max_tokens" 
            defaultValue={aiConfig?.max_tokens || 2000}
          />
        </label>
        
        <button type="submit" disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar Configuração'}
        </button>
      </form>

      {/* Credenciais (separado) */}
      <div style={{ marginTop: '2rem' }}>
        <h3>Credenciais</h3>
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          saveCredentials(
            formData.get('provider'),
            formData.get('apiKey')
          );
        }}>
          <label>
            Provider:
            <select name="provider" defaultValue="openai">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          
          <label>
            API Key:
            <input 
              type="password" 
              name="apiKey" 
              placeholder="sk-..."
              required
            />
          </label>
          
          <button type="submit" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Credenciais'}
          </button>
        </form>
        
        <p style={{ fontSize: '0.9rem', color: '#666' }}>
          ⚠️ API keys são criptografadas e nunca são exibidas após salvas.
        </p>
      </div>
    </div>
  );
}

export default AIConfigPage;
```

### 5. Verificações de Segurança

```javascript
// ✅ SEMPRE verificar autenticação
if (!token) {
  throw new Error('Não autenticado');
}

// ✅ SEMPRE incluir tenantKey nas requisições
if (!tenantKey) {
  throw new Error('Tenant não identificado');
}

// ✅ NUNCA armazenar API keys no frontend
// ❌ localStorage.setItem('apiKey', key);
// ❌ sessionStorage.setItem('apiKey', key);
// ✅ Sempre enviar para o backend que criptografa
```

### 6. Tratamento de Erros

```javascript
async function handleAIConfigError(response) {
  if (response.status === 401) {
    // Não autenticado
    redirectToLogin();
  } else if (response.status === 403) {
    // Sem permissão
    showError('Você não tem permissão para alterar esta configuração');
  } else if (response.status === 404) {
    // Tenant não encontrado
    showError('Tenant não encontrado');
  } else {
    // Outro erro
    const error = await response.json();
    showError(error.message || 'Erro desconhecido');
  }
}
```

## Checklist de Migração

- [ ] Substituir chamadas a `/config` por `/tenants/:tenantKey/ai-config`
- [ ] Separar salvamento de configuração e credenciais
- [ ] Adicionar autenticação em todas as requisições
- [ ] Remover armazenamento de API keys no frontend
- [ ] Adicionar tratamento de erros (401, 403, 404)
- [ ] Testar isolamento multi-tenant
- [ ] Validar que API keys nunca são exibidas após salvas

## Notas

1. **Tenant "system"**: Não deve exibir configuração de IA por padrão, apenas status do servidor
2. **RBAC**: Apenas `owner` e `admin` podem alterar configurações de IA
3. **Criptografia**: API keys são criptografadas automaticamente no backend
4. **Fallback**: Se PostgreSQL não estiver disponível, endpoints retornam erro apropriado
