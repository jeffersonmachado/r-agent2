# 🔄 CI/CD - Documentação

Este diretório contém os workflows de CI/CD do projeto.

## 📋 Workflows Disponíveis

### 1. `ci.yml` - CI Pipeline oficial legada
**Quando executa:**
- Push em `main` e `develop`
- Pull Requests para `main` e `develop`

**O que faz:**
- Executa o gate amplo de CI
- Cobre validações oficiais, QA Mesh e smoke complementar

**Workflows relacionados mais recentes:**
- `ci-core.yml`
- `code-quality.yml`
- `rpa-ci.yml`
- `stack-test.yml`

### 2. `rpa-seed.yml` - Seed RPA da Plataforma
**Quando executa:**
- Manualmente via `workflow_dispatch` (escolhe ambiente)
- Agendado diariamente às 2h
- Push em `main` quando há mudanças em recordings

**O que faz:**
- 🌱 Executa seed completo da plataforma
- 📊 Gera relatórios e replays
- 📸 Captura screenshots em caso de erros

### 3. `rpa-ci.yml` - Testes RPA E2E
**Quando executa:**
- Push/PR quando há mudanças em `tests/rpa/**`
- Manualmente via `workflow_dispatch`

**O que faz:**
- 🤖 Executa múltiplos seeds em modo CI
- 📹 Gera replays de cada execução
- 📸 Captura screenshots de erros

### 4. `code-quality.yml` - Qualidade de Código
**Quando executa:**
- Push em `main` ou `develop`
- Pull Requests
- Manualmente

**O que faz:**
- 🔍 Verifica sintaxe JavaScript
- ✅ Valida arquivos JSON
- 📊 Analisa tamanho de arquivos
- 🔒 Verifica vulnerabilidades de dependências

### 5. `deploy.yml` - Deploy Automático
**Quando executa:**
- Push em `main`
- Tags `v*` (versões)
- Manualmente via `workflow_dispatch`

**O que faz:**
- ✅ Validação pré-deploy
- 🐳 Build de imagens Docker
- 🚀 Deploy (configurar conforme ambiente)

### 6. `notify.yml` - Notificações
**Quando executa:**
- Automaticamente quando outros workflows completam

**O que faz:**
- 📢 Envia notificações quando workflows falham
- 💬 Integração com Slack (se configurado)
- 📧 Notificações por email (placeholder)

### 7. `full-pipeline.yml` - Pipeline auxiliar integrado
**Quando executa:**
- Push em `main`
- Pull Requests para `main`
- Manualmente via `workflow_dispatch`

**O que faz:**
- Executa validação integrada
- Faz build do frontend
- Mantém um pipeline CI/CD agregado para compatibilidade operacional

## 🔧 Configuração

### Secrets Necessários

Configure os seguintes secrets no GitHub:

```bash
# RPA/Testes
TEST_BASE_URL=http://localhost:3000
TEST_FRONTEND_URL=http://localhost:5173
TEST_ADMIN_EMAIL=admin@example.com
TEST_ADMIN_PASSWORD=senha_secreta

# Deploy (opcional)
DOCKER_USERNAME=seu_usuario
DOCKER_PASSWORD=sua_senha
DEPLOY_URL=https://seu-ambiente.com

# Notificações (opcional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
EMAIL_NOTIFICATIONS_ENABLED=true
```

### Como Configurar Secrets

1. Vá para **Settings** → **Secrets and variables** → **Actions**
2. Clique em **New repository secret**
3. Adicione cada secret listado acima

## 🚀 Uso

### Executar Workflow Manualmente

1. Vá para **Actions** no GitHub
2. Selecione o workflow desejado
3. Clique em **Run workflow**
4. Escolha branch e parâmetros
5. Execute

### Ver Resultados

- **Actions** → Selecione workflow → Ver logs
- **Artifacts** → Download de relatórios, screenshots, replays
- **Summary** → Resumo visual da execução

## 📊 Status Badges

Adicione badges ao README principal:

```markdown
![CI](https://github.com/seu-usuario/seu-repo/workflows/CI%20-%20Testes%20e%20Validação/badge.svg)
![RPA](https://github.com/seu-usuario/seu-repo/workflows/RPA%20-%20Testes%20E2E%20(CI)/badge.svg)
```

## 🔍 Troubleshooting

### Workflow não executa
- Verifique triggers (push, PR, schedule)
- Verifique paths (se houver filtros)
- Verifique permissões do repositório

### Testes falham
- Verifique logs no GitHub Actions
- Baixe artifacts (relatórios, screenshots)
- Execute localmente: `npm test`

### Deploy não funciona
- Configure secrets de deploy
- Implemente script de deploy específico
- Verifique conectividade com servidor

## 📝 Notas

- Workflows são executados em paralelo quando possível
- Timeouts configurados para evitar execuções infinitas
- Artifacts são mantidos por períodos definidos
- Notificações só enviam em caso de falha (configurável)

---

**Última atualização:** 2025-01-02
**Status:** ✅ Workflows implementados e funcionais

