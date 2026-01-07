# 🌱 Seed da Plataforma via RPA

Sistema para popular a plataforma usando RPA (Robotic Process Automation).

## 📋 Visão Geral

Este sistema permite criar dados na plataforma através da interface web, gravando e reproduzindo ações automaticamente.

## 🚀 Como Usar

### 1. Executar Seed Automático

```bash
node tests/rpa/seedPlatformRPA.js
```

Este script:
- Abre o navegador
- Faz login na plataforma
- Cria fluxos, agentes, etc. através da interface
- Gera relatório de execução

### 2. Gravar Novas Ações

```bash
node tests/rpa/seedPlatformGravar.js
```

Este script mostra exemplos de como gravar ações para popular a plataforma.

## 📁 Estrutura

```
/tests/rpa/
  /seeds/
    seed-platform-login.json          # Gravação de login
    seed-platform-create-flow.json    # Gravação de criação de fluxo
  seedPlatformRPA.js                  # Executor principal
  seedPlatformGravar.js               # Helper para gravar ações
```

## 📝 Gravações Disponíveis

### seed-platform-login
- Faz login na plataforma
- Valida sucesso do login
- Usa credenciais de `rpaConfig.js`

### seed-platform-create-flow
- Navega para página de fluxos
- Cria novo fluxo
- Preenche nome do fluxo
- Valida criação

## 🔧 Configuração

Edite `rpaConfig.js` para configurar:

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

## 📊 Dados Criados

O seed cria:

- **Fluxos**: Fluxo de Boas-Vindas, Fluxo de Suporte
- **Agentes**: admin, supervisor (via interface)
- **Outros**: Conforme gravações disponíveis

## 🎯 Criar Novas Gravações

1. Use `ActionRecorder` para gravar ações:

```javascript
const { ActionRecorder } = require('./actionRecorder');

const recorder = new ActionRecorder();
recorder.start({ name: 'minha-gravacao' });

// Registrar ações
recorder.recordNavigate('http://localhost:5173/flows');
recorder.recordClick('button:has-text("Novo Fluxo")');
// ... mais ações

recorder.stop();
recorder.save('minha-gravacao');
```

2. Adicione a gravação em `seedPlatformRPA.js`

3. Execute o seed

## 📈 Relatórios

Relatórios são salvos em:
```
/tests/rpa/reports/seed-platform-{timestamp}.json
```

Contém:
- Resultado de cada ação
- Erros encontrados
- Dados criados
- Timestamps

## ⚠️ Avisos

- O seed cria dados reais na plataforma
- Certifique-se de estar em ambiente de desenvolvimento/teste
- Verifique credenciais antes de executar
- O navegador será aberto (headless: false)

## 🔗 Integração

Este sistema pode ser integrado com:
- Sistema de seeds existente (`scripts/seed.js`)
- Testes automatizados
- CI/CD pipelines
- Ambientes de desenvolvimento

---

**Status**: ✅ Funcional e pronto para uso

