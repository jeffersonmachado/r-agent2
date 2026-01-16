# Teste RPA de Login

Este teste automatiza o fluxo completo de login usando Playwright, incluindo verificação de provider de IA e seleção de tenant.

## 🎯 O que o teste verifica

1. ✅ Navegação para página de login
2. ✅ Preenchimento de credenciais
3. ✅ Submissão do formulário
4. ✅ Detecção de modal de seleção de tenant (super-admin)
5. ✅ Seleção de tenant
6. ✅ Verificação de provider de IA
7. ✅ Redirecionamento correto
8. ✅ Exibição de campo de configuração (quando necessário)

## 🚀 Como Executar

```bash
# Executar teste de login RPA
node tests/rpa/login.test.js

# Com frontend customizado
FRONTEND_URL=http://localhost:8080 node tests/rpa/login.test.js

# Modo headless (sem abrir navegador)
HEADLESS=true node tests/rpa/login.test.js

# Modo visual (abre navegador)
HEADLESS=false node tests/rpa/login.test.js
```

## ⚙️ Configuração

Variáveis de ambiente:

- `FRONTEND_URL` - URL do frontend (padrão: http://localhost:5173)
- `API_URL` - URL da API (padrão: http://localhost:3000)
- `TEST_USERNAME` - Username para login (padrão: systemadmin)
- `TEST_PASSWORD` - Password para login (padrão: Admin123!)
- `TEST_TENANT_ID` - ID do tenant para selecionar (padrão: tenant-demo)
- `HEADLESS` - Executar em modo headless (padrão: true)

## 📊 Resultados

O teste gera:

- Screenshots em `tests/rpa/screenshots/`
- Logs detalhados de cada passo
- Resumo final com status de cada teste

## 🔍 Detalhes dos Testes

### testLoginFlow
Testa o fluxo básico de login:
- Acesso à página
- Preenchimento de formulário
- Submissão
- Detecção de modal (se super-admin)
- Seleção de tenant
- Verificação de redirecionamento

### testLoginWithProviderCheck
Testa o fluxo completo incluindo verificação de provider:
- Login
- Seleção de tenant
- Verificação de provider de IA
- Redirecionamento para /config se inválido
- Verificação de campo de configuração

## ⚠️ Requisitos

- Frontend deve estar rodando em `http://localhost:5173` (ou URL configurada)
- API deve estar rodando em `http://localhost:3000` (ou URL configurada)
- Playwright deve estar instalado: `npx playwright install chromium`
- Credenciais de teste devem estar configuradas

## 🐛 Troubleshooting

### Teste não encontra elementos

- Verifique se o frontend está rodando
- Aumente os timeouts se necessário
- Execute em modo visual (`HEADLESS=false`) para ver o que está acontecendo

### Login não redireciona

- Verifique se as credenciais estão corretas
- Verifique logs do console do navegador
- Verifique se há erros na API

### Modal não aparece

- Verifique se o usuário é realmente super-admin
- Verifique se há tenants disponíveis
- Aumente o timeout de espera

## 📝 Notas

- O teste tenta múltiplos seletores para maior robustez
- Screenshots são capturados automaticamente
- O teste é tolerante a pequenas variações na interface
