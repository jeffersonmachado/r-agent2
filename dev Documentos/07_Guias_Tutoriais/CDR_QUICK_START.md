# CDR - Guia Rápido

## 🚀 Início Rápido

### 1. Ver Capacidades Disponíveis

```bash
# Lista todas as capacidades ativas
node scripts/test-capabilities.js

# Ver detalhes de uma capacidade específica
node scripts/test-capabilities.js --check ai_processing

# Verificar se uma ação é permitida
node scripts/test-capabilities.js --action processar_ia
```

### 2. Testar Validação de Respostas

```bash
# Executa testes de validação CDR
node scripts/test-cdr-validation.js
```

### 3. Ver Arquivo de Capacidades

```bash
# Visualizar o arquivo completo
cat capabilities.json

# Ou editar
nano capabilities.json
# ou
code capabilities.json
```

---

## 📝 Comandos Úteis

| Comando | Descrição |
|---------|-----------|
| `node scripts/test-capabilities.js` | Lista todas as capacidades |
| `node scripts/test-capabilities.js --check <id>` | Verifica capacidade específica |
| `node scripts/test-capabilities.js --action <action>` | Verifica se ação é permitida |
| `node scripts/test-cdr-validation.js` | Testa validação de respostas |
| `cat capabilities.json` | Ver arquivo de capacidades |

---

## 🔧 Alterar Capacidades

### Adicionar Nova Capacidade

1. Edite `capabilities.json`:
```json
{
  "capabilities": {
    "minha_capacidade": {
      "id": "minha_capacidade",
      "name": "Minha Nova Capacidade",
      "description": "O que ela faz",
      "status": "active",
      "implementation": {
        "service": "caminho/para/implementacao.js"
      }
    }
  }
}
```

2. Teste:
```bash
node scripts/test-capabilities.js --check minha_capacidade
```

### Desativar Capacidade

Mude `"status": "active"` para `"status": "inactive"` em `capabilities.json`.

---

## 🧪 Testar no Código

### Exemplo Básico

```javascript
const { validateResponse, hasCapability } = require('./engine/utils/capabilityValidator');

// Verificar capacidade
if (hasCapability('ai_processing')) {
  console.log('✅ AI Processing disponível');
}

// Validar resposta
const resposta = "Já estou resolvendo isso.";
const resultado = validateResponse(resposta);

if (!resultado.valid) {
  console.log('❌ Resposta inválida:', resultado.errors);
}
```

---

## 📊 Onde Está Implementado

| Componente | Localização |
|------------|------------|
| Arquivo de capacidades | `/capabilities.json` |
| Validador | `/engine/utils/capabilityValidator.js` |
| Integração AI | `/engine/nodes/aiNode.js` |
| Documentação | `/docs/CDR_CAPABILITY_DRIVEN_RESPONSES.md` |
| Guia de uso | `/docs/COMO_USAR_CDR.md` |

---

## ⚠️ Frases Proibidas

O sistema bloqueia automaticamente respostas que contenham:

- "Já estou resolvendo"
- "Em breve"
- "Encaminhei para o setor"
- "Estamos analisando"
- "Vou pedir para alguém"
- "Isso será feito"
- "Vou verificar"
- "Vou solicitar"

---

## 📚 Documentação Completa

- **Guia Completo:** `docs/COMO_USAR_CDR.md`
- **Documentação Técnica:** `docs/CDR_CAPABILITY_DRIVEN_RESPONSES.md`
- **Arquivo de Capacidades:** `capabilities.json`

---

## 🆘 Problemas Comuns

### Cache não atualizado

```javascript
const { clearCache } = require('./engine/utils/capabilityValidator');
clearCache();
```

### Capacidade não encontrada

1. Verifique se está em `capabilities.json`
2. Verifique se `status` é `"active"`
3. Limpe o cache

### Validação não funciona

1. Verifique se `capabilities.json` existe
2. Verifique se o caminho está correto
3. Veja logs do servidor para erros

