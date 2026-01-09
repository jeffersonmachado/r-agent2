# Padrão de Normalização de Dados

## Regra Fundamental

**Dados brutos DEVEM ser normalizados antes do Roteador.**

O Roteador só pode consumir estados categóricos. Qualquer dado bruto (número, data, objeto, etc.) deve ser convertido em categoria antes de chegar ao Roteador.

## Padrão: Normalizar → Classificar → Decidir

1. **Normalizar**: Converter dados brutos em categorias
2. **Classificar**: Usar nó `set_variable` ou `ai_task` para criar variáveis categóricas
3. **Decidir**: Usar Roteador com igualdade simples (===)

## Tipos de Dados e Normalização

### STRING
**Normalizar para:** categoria / intenção / palavra-chave

**Exemplo:**
```json
// ❌ ERRADO: Comparar string bruta no Roteador
{
  "op": "equals",
  "var": "user_message",
  "value": "email"
}

// ✅ CORRETO: Normalizar antes
// 1. No nó set_variable:
{
  "tipo_texto": "email"  // ou "telefone", "nome", etc.
}
// 2. No Roteador:
{
  "op": "equals",
  "var": "tipo_texto",
  "value": "email"
}
```

### NUMBER
**Normalizar para:** faixa categórica

**Exemplo:**
```json
// ❌ ERRADO: Comparar número bruto no Roteador
{
  "op": "equals",
  "var": "idade",
  "value": 25
}

// ✅ CORRETO: Normalizar antes
// 1. No nó set_variable (ou backend):
{
  "faixa_idade": "jovem"  // ou "adulto", "idoso"
}
// 2. No Roteador:
{
  "op": "equals",
  "var": "faixa_idade",
  "value": "jovem"
}
```

### BOOLEAN
**Pode ser usado diretamente** (já é categórico)

**Exemplo:**
```json
// ✅ CORRETO: Boolean direto
{
  "op": "equals",
  "var": "isAdmin",
  "value": true
}
```

### DATE / TIME
**Normalizar para:** período ou usar `schedule_router`

**Exemplo:**
```json
// ❌ ERRADO: Comparar data bruta no Roteador
{
  "op": "equals",
  "var": "data_compra",
  "value": "2024-01-15"
}

// ✅ CORRETO: Normalizar antes
// 1. No nó set_variable (ou backend):
{
  "periodo": "hoje"  // ou "passado", "futuro"
}
// 2. No Roteador:
{
  "op": "equals",
  "var": "periodo",
  "value": "hoje"
}

// OU usar schedule_router para horários
```

### ARRAY / LISTA
**Normalizar para:** estado

**Exemplo:**
```json
// ❌ ERRADO: Comparar array bruto no Roteador
{
  "op": "equals",
  "var": "itens_carrinho",
  "value": []
}

// ✅ CORRETO: Normalizar antes
// 1. No nó set_variable (ou backend):
{
  "lista_status": "vazia"  // ou "possui_itens"
}
// 2. No Roteador:
{
  "op": "equals",
  "var": "lista_status",
  "value": "vazia"
}
```

### OBJECT
**Normalizar para:** propriedades achatadas (flatten)

**Exemplo:**
```json
// ❌ ERRADO: Acesso profundo no Roteador
{
  "op": "equals",
  "var": "user.role",
  "value": "admin"
}

// ✅ CORRETO: Achatado antes
// 1. No nó set_variable (ou backend):
{
  "user_role": "admin"
}
// 2. No Roteador:
{
  "op": "equals",
  "var": "user_role",
  "value": "admin"
}
```

### NULL / UNDEFINED
**Normalizar para:** flag explícita

**Exemplo:**
```json
// ❌ ERRADO: Comparar null diretamente
{
  "op": "equals",
  "var": "telefone",
  "value": null
}

// ✅ CORRETO: Flag explícita
// 1. No nó set_variable (ou backend):
{
  "telefone_existe": false
}
// 2. No Roteador:
{
  "op": "equals",
  "var": "telefone_existe",
  "value": false
}
```

## Onde Fazer a Normalização

**Ordem de prioridade:**

1. **Backend / API** (preferencial)
   - Normalizar dados na origem
   - Mais eficiente e seguro

2. **Pré-processamento antes do fluxo**
   - Normalizar no início do fluxo
   - Usar nó `set_variable` no início

3. **Tarefa de IA** (somente classificação)
   - Usar `ai_task` com `intent_classification`
   - Classificar texto em categorias

4. **Definir Variável** (apenas atribuição simples)
   - Usar nó `set_variable` para normalização categórica
   - NÃO calcular, apenas atribuir categorias

**Nunca no Roteador.**

## Validações

O editor valida e avisa quando:
- Números são comparados diretamente no Roteador
- Datas são comparadas diretamente no Roteador
- Acesso profundo a objetos (obj.prop) é detectado
- Operadores proibidos (> < >= <=) são usados

## Exemplos Completos

### Exemplo 1: Normalizar Idade
```json
// Fluxo:
// 1. user_input → captura idade
// 2. set_variable → normaliza para faixa
{
  "faixa_idade": idade < 18 ? "menor" : idade < 65 ? "adulto" : "idoso"
}
// 3. router → decide por faixa
{
  "op": "equals",
  "var": "faixa_idade",
  "value": "menor"
}
```

### Exemplo 2: Normalizar Data
```json
// Fluxo:
// 1. Backend normaliza data → período
{
  "periodo": data < hoje ? "passado" : data === hoje ? "hoje" : "futuro"
}
// 2. router → decide por período
{
  "op": "equals",
  "var": "periodo",
  "value": "hoje"
}
```

### Exemplo 3: Normalizar Objeto
```json
// Fluxo:
// 1. Backend achatado → propriedades planas
{
  "user_role": user.role,
  "user_name": user.name
}
// 2. router → decide por propriedade achatada
{
  "op": "equals",
  "var": "user_role",
  "value": "admin"
}
```
