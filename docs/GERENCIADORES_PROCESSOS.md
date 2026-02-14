# 🚀 Gerenciadores de Processos

Este projeto suporta **PM2** (produção) e **Nodemon** (desenvolvimento) para gerenciar o servidor.

> Nota (segurança / supply chain): o **PM2 não é instalado como dependência do projeto** para manter o `npm audit` zerado.\n+> Para usar os scripts `npm run pm2:*`, você precisa ter o `pm2` **instalado globalmente**.

## 📋 Instalação

```bash
# Instala dependências
npm install

# Instala PM2 globalmente (necessário para `npm run pm2:*`)
npm install -g pm2

# Ou use o script de setup
chmod +x scripts/setup-process-managers.sh
./scripts/setup-process-managers.sh
```

## 🔧 Desenvolvimento (Nodemon)

**Recomendado para:** Desenvolvimento local

```bash
# Inicia API com auto-reload
npm run dev:api

# Inicia frontend
npm run dev:frontend

# Ou ambos juntos
npm run dev
```

**Vantagens:**
- ✅ Auto-reload automático ao salvar arquivos
- ✅ Ideal para desenvolvimento
- ✅ Não precisa de configuração adicional

## 🚀 Produção (PM2)

**Recomendado para:** Servidores de produção

```bash
# Inicia todos os processos
npm run pm2:start

# Ou apenas API
npm run pm2:start:api

# Ver status
npm run pm2:status

# Ver logs
npm run pm2:logs

# Monitoramento em tempo real
npm run pm2:monit

# Reiniciar
npm run pm2:restart

# Parar
npm run pm2:stop

# Remover do PM2
npm run pm2:delete
```

**Vantagens:**
- ✅ Auto-restart em caso de crash
- ✅ Gerenciamento de múltiplos processos
- ✅ Logs centralizados
- ✅ Monitoramento de recursos
- ✅ Inicialização automática no boot do sistema

## 🔄 Reiniciar Servidor via UI

A interface de configuração (`/config`) detecta automaticamente qual gerenciador está sendo usado:

- **PM2**: Reinicia automaticamente e recarrega a página
- **Nodemon**: Reinicia automaticamente e recarrega a página
- **Sem gerenciador**: Mostra aviso para iniciar manualmente

## 📊 Comparação

| Recurso | Nodemon | PM2 |
|---------|---------|-----|
| Auto-reload | ✅ | ❌ (mas auto-restart) |
| Produção | ❌ | ✅ |
| Desenvolvimento | ✅ | ⚠️ |
| Múltiplos processos | ❌ | ✅ |
| Logs centralizados | ❌ | ✅ |
| Monitoramento | ❌ | ✅ |
| Inicialização no boot | ❌ | ✅ |

## 🎯 Recomendações

- **Desenvolvimento**: Use `nodemon` (`npm run dev:api`)
- **Produção**: Use `PM2` (`npm run pm2:start`)
- **Testes locais**: Use `npm start` (sem gerenciador)

## 🔍 Verificar qual está sendo usado

O servidor detecta automaticamente via:
- Variáveis de ambiente (`PM2_HOME`, `nodemon`)
- Argumentos de linha de comando
- Processo pai

A interface mostra qual gerenciador foi detectado ao tentar reiniciar.

## 🔧 Configuração Avançada

### PM2 - Inicialização no Boot

Para fazer o PM2 iniciar automaticamente no boot do sistema:

```bash
# Gera script de inicialização
pm2 startup

# Salva a configuração atual
pm2 save
```

### PM2 - Logs

Os logs são salvos em:
- `./logs/pm2-api-error.log` - Erros da API
- `./logs/pm2-api-out.log` - Output da API
- `./logs/pm2-frontend-error.log` - Erros do Frontend
- `./logs/pm2-frontend-out.log` - Output do Frontend

### Nodemon - Personalização

Edite `nodemon.json` para ajustar:
- Arquivos monitorados (`watch`)
- Extensões observadas (`ext`)
- Delay antes de reiniciar (`delay`)

