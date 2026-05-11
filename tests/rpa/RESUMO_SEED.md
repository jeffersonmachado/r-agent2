# 🌱 Seed da Plataforma via RPA - Resumo

## ✅ Sistema Criado

Sistema completo para popular a plataforma usando RPA (Robotic Process Automation).

## 📁 Arquivos Criados

### Gravações RPA
- ✅ `seed-platform-login.json` - Gravação de login na plataforma
- ✅ `seed-platform-create-flow.json` - Gravação de criação de fluxo
- ✅ `seed-platform-exemplo.json` - Exemplo de gravação

### Scripts
- ✅ `seedPlatformRPA.js` - Executor principal do seed via RPA
- ✅ `seedPlatformGravar.js` - Helper para gravar novas ações

### Documentação
- ✅ `README_SEED.md` - Documentação completa

## 🚀 Como Usar

### 1. Executar Seed Automático

```bash
npm run rpa:seed
# ou
node tests/rpa/seedPlatformRPA.js
```

**O que faz:**
- Abre navegador
- Faz login na plataforma
- Cria fluxos através da interface
- Gera relatório de execução

### 2. Gravar Novas Ações

```bash
npm run rpa:seed:gravar
# ou
node tests/rpa/seedPlatformGravar.js
```

**O que faz:**
- Mostra exemplos de gravação
- Cria gravação de exemplo
- Ensina como gravar ações

## 📝 Gravações Disponíveis

### seed-platform-login
**Ações:**
1. Navega para `/login`
2. Preenche email (`{{admin.email}}`)
3. Preenche senha (`{{admin.password}}`)
4. Clica em submit
5. Valida login bem-sucedido

**Dados:**
- Email: `admin@example.com`
- Senha: `admin123` (configurável)

### seed-platform-create-flow
**Ações:**
1. Navega para `/flows`
2. Clica em "Novo Fluxo"
3. Preenche nome do fluxo (`{{flow.name}}`)
4. Clica em "Criar"
5. Valida editor aberto

**Dados:**
- Nome do fluxo: configurável

## 🔧 Configuração

Edite `tests/rpa/rpaConfig.js`:

```javascript
credentials: {
  admin: {
    email: 'admin@example.com',
    password: 'admin123',
  },
},
urls: {
  frontend: 'http://localhost:5173',
},
```

## 📊 Fluxo de Execução

```
1. Inicializa navegador
   ↓
2. Executa gravação de login
   ↓
3. Para cada item em SEED_DATA:
   - Executa gravação de criação
   - Valida sucesso
   - Registra resultado
   ↓
4. Gera relatório
   ↓
5. Fecha navegador
```

## 🎯 Dados Criados

O seed cria automaticamente:

- **Fluxos:**
  - Fluxo de Boas-Vindas
  - Fluxo de Suporte

- **Agentes:** (via interface, se gravações disponíveis)
  - admin
  - supervisor

## 📈 Relatórios

Relatórios salvos em:
```
/tests/rpa/reports/seed-platform-{timestamp}.json
```

Contém:
- ✅ Resultado de cada ação
- ❌ Erros encontrados
- 📊 Estatísticas
- 📝 Dados criados

## 💡 Exemplo de Uso

```javascript
const { seedPlatform } = require('./tests/rpa/seedPlatformRPA');

// Executa seed
const results = await seedPlatform();

console.log('Login:', results.login.success);
console.log('Fluxos criados:', results.flows.filter(f => f.success).length);
```

## 🔄 Integração com Seeds Existentes

Este sistema complementa:
- Fluxo DB-only atual do projeto
- `tests/seeds/` - Arquivos de referencia para cenarios de teste

**Vantagens do RPA:**
- ✅ Testa interface real
- ✅ Valida fluxo completo do usuário
- ✅ Detecta problemas de UI
- ✅ Pode ser usado para testes E2E

## ⚠️ Avisos

- Cria dados reais na plataforma
- Use apenas em desenvolvimento/teste
- Verifique credenciais antes de executar
- Navegador será aberto (não headless)

## 📚 Próximos Passos

1. ✅ Sistema criado
2. ⏳ Testar com plataforma real
3. ⏳ Adicionar mais gravações (agentes, filas, etc.)
4. ⏳ Integrar com CI/CD

---

**Status**: ✅ Sistema criado e pronto para uso

