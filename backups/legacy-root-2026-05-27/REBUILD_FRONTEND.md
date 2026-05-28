# Rebuild do Frontend após Ajuste de Rotas

## 📋 Contexto

O arquivo `frontend/nginx.conf` foi modificado para injetar um script JavaScript que corrige automaticamente as rotas quando o frontend é servido sob o prefixo `/r-agent2/`.

## 🔧 Passos para Rebuild

### 1. No servidor Docker (10.10.2.30)

```bash
# Acessar o diretório do projeto
cd /opt/results/ria/r-agent2

# Reconstruir apenas a imagem do frontend
docker-compose -f docker-compose.prod.yml build frontend

# Reiniciar o container do frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

### 2. Verificar se está funcionando

```bash
# Verificar logs do frontend
docker-compose -f docker-compose.prod.yml logs -f frontend

# Verificar se o container está rodando
docker ps | grep r-agent2-frontend
```

### 3. Testar no navegador

1. Acesse: `https://results.com.br/r-agent2/`
2. Verifique se os redirecionamentos para `/login` mantêm o prefixo `/r-agent2/`
3. Abra o console do navegador (F12) e verifique se aparece: `[r-agent2] Base path configurado: /r-agent2`

## ✅ O que foi alterado

O arquivo `frontend/nginx.conf` agora injeta um script que:
- Detecta automaticamente se está rodando sob `/r-agent2/`
- Intercepta `window.history.pushState` para incluir o prefixo nas rotas
- Ajusta `window.location.pathname` para remover o prefixo quando lido pelo React
- Corrige redirecionamentos via `window.location.href`

## 🔍 Troubleshooting

### O script não está sendo injetado

- Verifique se o módulo `ngx_http_sub_module` está habilitado no nginx
- Verifique os logs do nginx: `docker logs r-agent2-frontend-prod`

### Redirecionamentos ainda não funcionam

- Limpe o cache do navegador (Ctrl+Shift+R ou Cmd+Shift+R)
- Verifique no console do navegador se o script foi carregado
- Verifique se a URL atual começa com `/r-agent2/`

### Erro ao fazer rebuild

- Verifique se o Docker está rodando: `docker ps`
- Verifique espaço em disco: `df -h`
- Veja os logs do build: `docker-compose -f docker-compose.prod.yml build frontend 2>&1 | tee build.log`

