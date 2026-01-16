# Teste RPA: Criar Tenant por IA

Este teste automatiza a criação de um tenant usando IA a partir de informações extraídas de um site web.

## 🎯 Objetivo

O teste realiza o seguinte fluxo:

1. **Login no sistema** - Autentica como super-admin
2. **Navegação para o site alvo** - Acessa o site especificado (padrão: https://studiooly.com.br/)
3. **Extração de informações** - Coleta dados do site (título, descrição, conteúdo, contatos)
4. **Geração de descrição** - Cria uma descrição estruturada para a IA
5. **Geração por IA** - Chama a API `/tenants/generate-by-ai` para gerar dados do tenant
6. **Criação do tenant** - Cria o tenant no sistema com os dados gerados
7. **Verificação** - Confirma que o tenant foi criado e aparece na lista

## 🚀 Como Executar

### Pré-requisitos

1. Servidor backend rodando em `http://localhost:3000` (ou configure `API_URL`)
2. Frontend rodando em `http://localhost:5173` (ou configure `FRONTEND_URL`)
3. Credenciais de super-admin configuradas (padrão: `systemadmin` / `Admin123!`)
4. **Provider de IA configurado para o tenant "system"**:
   - Acesse: `http://localhost:5173/config?tab=ai`
   - Configure um provider de IA (OpenAI, Anthropic, etc.)
   - Adicione a API key do provider
   - Salve a configuração

### Execução Básica

```bash
cd /opt/results/ria/r-agent2
node tests/rpa/createTenantByAI.test.js
```

### Configuração via Variáveis de Ambiente

```bash
# URL do frontend
export FRONTEND_URL=http://localhost:5173

# URL da API
export API_URL=http://localhost:3000

# Credenciais
export TEST_USERNAME=systemadmin
export TEST_PASSWORD=Admin123!

# Site alvo (padrão: https://studiooly.com.br/)
export TARGET_URL=https://studiooly.com.br/

# Modo headless (true/false)
export HEADLESS=false

# Executar
node tests/rpa/createTenantByAI.test.js
```

### Executar com Site Diferente

```bash
TARGET_URL=https://exemplo.com.br node tests/rpa/createTenantByAI.test.js
```

## 📋 Informações Extraídas do Site

O teste extrai automaticamente:

- **Título da página** (`<title>`)
- **Meta descrição** (`<meta name="description">`)
- **Conteúdo principal** (texto de `main`, `article`, ou `body`)
- **Títulos e subtítulos** (`<h1>`, `<h2>`)
- **Informações de contato** (telefones e emails encontrados no texto)
- **URL do site**

## 🤖 Geração por IA

A descrição gerada é enviada para o endpoint `/tenants/generate-by-ai`, que usa IA para criar:

- **Nome do tenant**
- **Site oficial**
- **Ramo de atividade** (descrição detalhada do segmento)
- **Objetivo** (como o tenant pretende usar a plataforma)

## 📊 Resultados

O teste gera:

1. **Replay completo** - Gravação de todas as ações e telas
   - Localização: `replays/replay-{timestamp}.json`
   - Pode ser visualizado na página `/rpa-replays`

2. **Screenshots** - Capturas em pontos chave
   - Localização: `tests/rpa/screenshots/`
   - Inclui: login, site carregado, página de tenants, estado final

3. **Logs no console** - Informações detalhadas de cada etapa

## ✅ Exemplo de Saída

```
🤖 Teste RPA: Criar Tenant por IA do Site

Frontend: http://localhost:5173
API: http://localhost:3000
Site alvo: https://studiooly.com.br/
Usuário: systemadmin

1. Fazendo login no sistema...
   ✅ Login realizado

2. Navegando para o site: https://studiooly.com.br/...
   ✅ Site carregado

3. Extraindo informações do site...
   📄 Título: Studio Oly – O Studio Oly foi criado...
   📝 Texto extraído: O Studio Oly oferece Crossfit...
   📧 Contatos: 1 emails, 1 telefones

4. Gerando descrição para IA...
   📋 Descrição gerada (523 caracteres)

5. Navegando para página de tenants...
   ✅ Página de tenants carregada

6. Gerando tenant por IA via API...
   ✅ Tenant gerado por IA: Studio Oly
   🌐 Site: https://studiooly.com.br/
   🏢 Ramo: Academia e Fitness - Studio especializado...

7. Criando tenant no sistema...
   ✅ Tenant criado com sucesso!
   🆔 ID: tenant-studio-oly-123456
   📛 Nome: Studio Oly

8. Verificando tenant na lista...
   ✅ Tenant encontrado na lista!

9. Capturando screenshot final...
   ✅ Screenshot salvo: tests/rpa/screenshots/create-tenant-ai-1234567890.png

✅ Teste RPA de criação de tenant por IA concluído com sucesso!

📹 Replay salvo: replays/replay-create-tenant-ai-1234567890.json
   📊 Ações registradas: 15
   📸 Telas registradas: 8
```

## 🔧 Troubleshooting

### Erro: "Token de autenticação não encontrado"

- Verifique se o login foi bem-sucedido
- Confirme que as credenciais estão corretas
- Verifique se o token está sendo salvo no localStorage/sessionStorage

### Erro: "Apenas super-admins podem gerar tenants por IA"

- Certifique-se de estar logado como super-admin
- Verifique o role do usuário no sistema

### Erro: "Nenhum provider de IA configurado para tenant: system"

- **Este é o erro mais comum!**
- Você precisa configurar um provider de IA antes de executar o teste
- Passos:
  1. Acesse: `http://localhost:5173/config?tab=ai`
  2. Selecione um provider (OpenAI, Anthropic, etc.)
  3. Adicione a API key do provider
  4. Salve a configuração
  5. Execute o teste novamente

### Erro: "Site não carregou"

- Verifique a conectividade com o site
- Alguns sites podem bloquear bots - tente com `HEADLESS=false` para ver o que acontece
- Aumente o timeout se o site for lento

### Erro: "A IA não retornou um JSON válido"

- A descrição pode estar muito curta ou vaga
- Tente com um site que tenha mais conteúdo
- Verifique se o serviço de IA está configurado corretamente

## 📝 Notas

- O teste cria um tenant com plano `trial` e status `active`
- O tenant é criado imediatamente após a geração por IA
- O replay pode ser visualizado na interface web em `/rpa-replays`
- Screenshots são salvos automaticamente em caso de erro

## 🔗 Arquivos Relacionados

- `tests/rpa/createTenantByAI.test.js` - Teste principal
- `api/server.js` - Endpoint `/tenants/generate-by-ai`
- `api/services/tenantService.js` - Lógica de criação de tenants
- `frontend/src/pages/TenantsPage.jsx` - Interface de gerenciamento de tenants
