# 📁 Diretório de Seeds RPA

## Estrutura Unificada

O sistema RPA usa **um único diretório** para todos os seeds:

### `/tests/rpa/seeds/` - Todos os Seeds

**Propósito**: Todos os seeds RPA, sejam manuais ou automáticos.

**Tipos de Seeds**:
- ✅ **Seeds Manuais** (`source: "manual"`): Gravados via interface ou CLI
- ✅ **Seeds Automáticos** (`source: "automatic"`): Gerados automaticamente de fluxos

**Quando usar**:
- ✅ Gravações manuais via interface `/rpa-seeds` ou `gravar-seed-rpa.js`
- ✅ Seeds para população de dados (ex: `seed-platform-login.json`)
- ✅ Gravações geradas automaticamente de fluxos (via `flowToRpaConverter`)
- ✅ Testes RPA gerados pelo pipeline de geração
- ✅ Seeds criados programaticamente via `ActionRecorder.save()`

**Exemplos**:
- `seed-platform-login.json` - Login manual gravado (`source: "manual"`)
- `seed-platform-create-flow.json` - Criação de fluxo gravada (`source: "manual"`)
- `rpa-flow-xxx-1234567890.json` - Gerado de um fluxo (`source: "automatic"`)
- Seeds temporários gerados por `generationOrchestrator` (`source: "automatic"`)

**Características**:
- ✅ **Unificado**: Todos os seeds em um só lugar
- ✅ **Flag de origem**: Cada seed tem `source: "manual"` ou `"automatic"`
- ✅ **Fácil gerenciamento**: Uma única localização para todos os seeds
- ✅ **Interface visual**: Badge mostra origem (Manual/Auto)

## 🔄 Como Funciona

### `ActionRecorder.save()`
```javascript
// Salva sempre em /seeds/
const seedsDir = path.join(__dirname, 'seeds');
```

### `ActionRecorder.load()`
```javascript
// Carrega sempre de /seeds/
const seedsFile = path.join(__dirname, 'seeds', `${filename}.json`);
```

### `ActionRecorder.list()`
```javascript
// Lista apenas de /seeds/
return fs.readdirSync(seedsDir)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace('.json', ''));
```

## 📊 Resumo

| Diretório | Uso | Flag Source | Exemplos |
|-----------|-----|-------------|----------|
| `/seeds/` | Todos os seeds | `"manual"` ou `"automatic"` | `seed-*.json`, `rpa-*.json` |

## 🎯 Identificação de Origem

Cada seed inclui a flag `source`:

```json
{
  "id": "meu-seed",
  "name": "Meu Seed",
  "source": "manual",  // ou "automatic"
  "steps": [...]
}
```

- **`"manual"`**: Seed gravado manualmente (interface ou CLI)
- **`"automatic"`**: Seed gerado automaticamente (fluxos, pipelines)

A interface `/rpa-seeds` mostra badges visuais:
- 🔵 **"✋ Manual"** para seeds manuais
- 🟣 **"🤖 Auto"** para seeds automáticos

