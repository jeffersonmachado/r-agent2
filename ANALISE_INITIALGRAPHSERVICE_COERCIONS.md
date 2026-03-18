# Análise de Coercions Não-Protegidas - initialGraphService.js

**Data**: 17 de março de 2026  
**Arquivo**: `api/services/initialGraphService.js`  
**Total de coercions críticas encontradas**: 15  

---

## TOP 15 COERCIONS MAIS CRÍTICAS

### 1️⃣ LINHA 219 - `forbidden.join('\n')`
- **Tipo**: Array.join() em entrada de usuário
- **Padrão Exato**:
```javascript
forbidden.join('\n'),  // dentro do array da prompt string
```
- **Variável Sendo Coercida**: `forbidden` (array de exclusões do usuário)
- **Nível de Risco**: **HIGH**
- **Porquê é Arriscado**: 
  - `forbidden` é definido como `executionContext?.exclusions` (entrada direta do usuário)
  - Array não é validado quanto aos tipos de SUA ELEMENTOS antes do .join()
  - `.join()` chama `toString()` implicitamente em cada elemento
  - Um objeto malicioso com `toString()` customizado pode injetar dados na prompt

---

### 2️⃣ LINHA 278 - `forbidden.join('\n')`
- **Tipo**: Array.join() em entrada de usuário (regenerateExamples)
- **Padrão Exato**:
```javascript
'<termos_proibidos>',
forbidden.join('\n'),
'</termos_proibidos>',
```
- **Variável Sendo Coercida**: `forbidden` (array de exclusões)
- **Nível de Risco**: **HIGH**
- **Porquê é Arriscado**:
  - Mesma vulnerabilidade que linha 219
  - Dentro de função `regenerateExamples()` 
  - Elementos do array sem coerção individual antes do join
  - Permite XSS/injection via toString() malicioso

---

### 3️⃣ LINHA 310 - `forbidden.join('\n')`
- **Tipo**: Array.join() em entrada de usuário (regenerateAnswer)
- **Padrão Exato**:
```javascript
'<termos_proibidos>',
forbidden.join('\n'),
'</termos_proibidos>',
```
- **Variável Sendo Coercida**: `forbidden` (array de exclusões)
- **Nível de Risco**: **HIGH**
- **Porquê é Arriscado**:
  - Terceira ocorrência do mesmo padrão vulnerável
  - Dentro de função `regenerateAnswer()`
  - Array com objetos não-validados é passado diretamente para AI

---

### 4️⃣ LINHA 240 - `${e?.message || safeString(e)}`
- **Tipo**: Template string interpolation de error.message
- **Padrão Exato**:
```javascript
throw new Error(`IA retornou JSON inválido ao gerar intents/respostas: ${e?.message || safeString(e)}`);
```
- **Variável Sendo Coercida**: `e?.message` (propriedade de objeto error)
- **Nível de Risco**: **HIGH**
- **Porquê é Arriscado**:
  - `e?.message` é interpolado DIRETAMENTE sem `String()` coerção
  - Se `e` for objeto customizado com `toString()` malicioso na propriedade message
  - A condição `e?.message || safeString(e)` só protege se message for falsy
  - Se message for string customizada, ela é incluída sem proteção
  - Mensagens de erro podem conter dados do atacante

---

### 5️⃣ LINHA 75 - `String(nextKey++)`
- **Tipo**: String() sem try-catch
- **Padrão Exato**:
```javascript
const alloc = () => String(nextKey++);
```
- **Variável Sendo Coercida**: `nextKey` (contador numérico interno)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Coerção com `String()` sem wrapper try-catch
  - Embora nextKey seja interno, viola padrão de segurança uniformemente aplicado
  - Se for expandido para aceitar entrada externa futuramente, já estaria vulnerável
  - Comparar com função `safeString()` definida no início que TEM try-catch

---

### 6️⃣ LINHA 371 - `error: err?.message || safeString(err)` 
- **Tipo**: Error message property access sem coerção
- **Padrão Exato**:
```javascript
logger.warn('[InitialGraph] Falha ao regenerar examples (best-effort)', {
  tenantIdForAI,
  executionId,
  error: err?.message || safeString(err),
  question: safeString(it.question).slice(0, 160),
});
```
- **Variável Sendo Coercida**: `err?.message` (propriedade de error em catch block)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - `err?.message` não passa por `String()` coerção explícita
  - Tem fallback `safeString(err)` MAS apenas se message for falsy
  - Se err.message existir como string customizada, é incluída sem proteção
  - Logger pode expor dados maliciosamente fornecidos

---

### 7️⃣ LINHA 400 - `error: err?.message || safeString(err)`
- **Tipo**: Error message property access sem coerção (catch block 2)
- **Padrão Exato**:
```javascript
logger.warn('[InitialGraph] Falha ao regenerar answer (best-effort)', {
  tenantIdForAI,
  executionId,
  error: err?.message || safeString(err),
  question: safeString(it.question).slice(0, 160),
});
```
- **Variável Sendo Coercida**: `err?.message` (propriedade de error)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Padrão idêntico ao da linha 371
  - Segunda ocorrência de acesso .message sem coerção
  - Log pode expor dados de entrada do usuário via objeto erro customizado

---

### 8️⃣ LINHA 494 - `error: err?.message || safeString(err)`
- **Tipo**: Error message property access sem coerção (context resolution)
- **Padrão Exato**:
```javascript
logger.warn('[InitialGraph] Falha ao resolver contexto para intents/respostas (best-effort)', {
  tenantIdForAI,
  error: err?.message || safeString(err),
});
```
- **Variável Sendo Coercida**: `err?.message` (propriedade de error)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Terceira ocorrência do mesmo padrão vulnerável
  - Acesso a .message sem coerção explícita
  - Logger no contexto de resolução de contexto externo

---

### 9️⃣ LINHA 82 - `id: Number(startKey)`
- **Tipo**: Number() coerção sem try-catch
- **Padrão Exato**:
```javascript
nodes[startKey] = {
  id: Number(startKey),
  data: {
    type: 'start',
```
- **Variável Sendo Coercida**: `startKey` (string interna de alloc())
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Coerção numérica sem proteção try-catch
  - Se expandido para entrada externa, seria vulnerável
  - startKey = alloc() = String(nextKey++), que pode falhar se entrada hostil

---

### 🔟 LINHA 102 - `id: Number(fallbackKey)`
- **Tipo**: Number() coerção sem try-catch
- **Padrão Exato**:
```javascript
nodes[fallbackKey] = {
  id: Number(fallbackKey),
  data: {
    type: 'fallback',
```
- **Variável Sendo Coercida**: `fallbackKey` (string interna)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Coerção sem wrapper try-catch
  - Padrão idêntico ao 82

---

### 1️⃣1️⃣ LINHA 127 - `id: Number(categoryKey)`
- **Tipo**: Number() coerção sem try-catch
- **Padrão Exato**:
```javascript
nodes[categoryKey] = {
  id: Number(categoryKey),
  data: {
    type: 'category',
```
- **Variável Sendo Coercida**: `categoryKey` (string interna de alloc())
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Coerção numérica sem try-catch
  - Terceira ocorrência de Number() sem proteção

---

### 1️⃣2️⃣ LINHA 153 - `id: Number(intentKey)`
- **Tipo**: Number() coerção sem try-catch
- **Padrão Exato**:
```javascript
nodes[intentKey] = {
  id: Number(intentKey),
  data: {
    type: 'intent',
```
- **Variável Sendo Coercida**: `intentKey` (string interna)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Quarta ocorrência de Number() sem proteção try-catch
  - Padrão repetitivo indica falta de padronização de coercões

---

### 1️⃣3️⃣ LINHA 100 - `${categoryLabels.join(', ')}`
- **Tipo**: Array.join() resultando em template string
- **Padrão Exato**:
```javascript
const fallbackMessage = `Posso ajudar com: ${categoryLabels.join(', ')}. O que você deseja?`;
```
- **Variável Sendo Coercida**: `categoryLabels` (array de strings processadas)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - categoryLabels vem de entrada do usuário (categories)
  - Embora tenha safeString(), a cadeia de transformação é:
    1. Entrada do usuário (categoria labels)
    2. safeString() + trim() 
    3. .join() novamente
  - String resultado não é re-validada

---

### 1️⃣4️⃣ LINHA 204 - `JSON.stringify(safeFaq, null, 2)`
- **Tipo**: JSON serialization sem validação de toJSON methods
- **Padrão Exato**:
```javascript
'Entrada (FAQ por categoria):',
JSON.stringify(safeFaq, null, 2),
```
- **Variável Sendo Coercida**: `safeFaq` (array de objetos FAQ)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - JSON.stringify() respeita métodos toJSON() customizados
  - safeFaq tem elementos processados com safeString(), MAS no objeto ainda pode haver objetos nested
  - Se input contiver objeto com toJSON() malicioso, pode executar lógica
  - Resultado é incluído em prompt para AI

---

### 1️⃣5️⃣ LINHA 193 - `ctx.join('\n\n---\n\n')`
- **Tipo**: Array.join() após transformações
- **Padrão Exato**:
```javascript
const ctx = (Array.isArray(contextSources) ? contextSources : [])
  .map((c) => safeString(c?.text || c?.excerpt || '').trim())
  .filter(Boolean)
  .slice(0, 12)
  .join('\n\n---\n\n')
  .slice(0, 14000);
```
- **Variável Sendo Coercida**: `ctx` (array de contexto após processamento)
- **Nível de Risco**: **MEDIUM**
- **Porquê é Arriscado**:
  - Embora cada elemento passe por safeString(), o resultado final não é verificado
  - Se algum elemento anterior na cadeia falhar silenciosamente, join() pode incluir objetos não-coercidos
  - Resultado (14k caracteres) é concatenado em prompt sem re-validação

---

## RESUMO EXECUTIVO

| Críticas | Descrição |
|----------|-----------|
| **HIGH (4)** | `forbidden.join()` (3x) e `e?.message` - entrada de usuário sem coerção em join/template |
| **MEDIUM (11)** | Error.message sem coerção com fallback + Number/join sem try-catch |
| **Total Risco** | 15 coercions precisam de hardening |

### Padrões Principais de Risco:
1. **Array.join() em entrada não-coercida** → objetos com toString() malicioso
2. **Error.message sem coerção** → permite injeção quando tem fallback fraco  
3. **Number()/String() sem try-catch** → sem proteção contra exceptions
4. **JSON.stringify() de entrada** → respeita toJSON() customizado

### Próximas Ações:
- Aplicar `String()` wrapper com try-catch para coercões numéricas
- Usar `safeString()` ANTES de .join() em arrays de entrada
- Coercer cada elemento de `forbidden` individualmente
- Adicionar wrapper seguro para acesso a error.message

