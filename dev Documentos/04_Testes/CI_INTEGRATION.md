# 🔄 Integração CI/CD - Seed RPA

## 📋 Visão Geral

O sistema de seed RPA está integrado com CI/CD para execução automática.

## 🚀 GitHub Actions

### Workflow: `rpa-seed.yml`

Localização: `.github/workflows/rpa-seed.yml`

**Triggers:**
- Manual (`workflow_dispatch`)
- Agendado (diariamente às 2h)
- Push em `main` quando há mudanças em gravações

**Executa:**
1. Checkout do código
2. Setup Node.js
3. Instala dependências
4. Instala Playwright
5. Executa seed via RPA
6. Upload de relatórios e screenshots

### Configurar Secrets

No GitHub, configure os seguintes secrets:

```
TEST_BASE_URL=http://localhost:3000
TEST_FRONTEND_URL=http://localhost:5173
TEST_ADMIN_EMAIL=admin@example.com
TEST_ADMIN_PASSWORD=senha_secreta
```

### Executar Manualmente

1. Vá para **Actions** no GitHub
2. Selecione **Seed Plataforma via RPA**
3. Clique em **Run workflow**
4. Escolha o ambiente
5. Execute

## 📊 Relatórios

Relatórios são salvos como artifacts:
- **rpa-seed-reports**: Relatórios JSON (30 dias)
- **rpa-seed-screenshots**: Screenshots de erros (7 dias)

## 🔧 Configuração Local

Para testar localmente:

```bash
# Executar seed completo
npm run rpa:seed:completo

# Executar seed básico
npm run rpa:seed
```

## ⚙️ Variáveis de Ambiente

```bash
export TEST_BASE_URL=http://localhost:3000
export TEST_FRONTEND_URL=http://localhost:5173
export TEST_ADMIN_EMAIL=admin@example.com
export TEST_ADMIN_PASSWORD=admin123
```

## 📝 Logs

Logs são exibidos no console e salvos em:
- `tests/rpa/reports/seed-platform-{timestamp}.json`

## 🔍 Troubleshooting

### Erro: "Executable doesn't exist"
```bash
npx playwright install chromium
```

### Erro: "Cannot connect to server"
- Verifique se o servidor está rodando
- Verifique URLs em `rpaConfig.js`

### Erro: "Login failed"
- Verifique credenciais em secrets
- Verifique se usuário admin existe

---

**Status**: ✅ Integrado e funcional

