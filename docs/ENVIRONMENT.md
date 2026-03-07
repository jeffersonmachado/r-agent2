# Variáveis de Ambiente

## Frontend

### VITE_BASE_PATH
Define o caminho base da aplicação.

Exemplo:
/r-agent2/

### VITE_API_BASE_URL
URL base da API.

Exemplo:
/r-agent2/api

## Web Push
Para notificações push:

VAPID_PUBLIC_KEY  
VAPID_PRIVATE_KEY  

Gerar usando:
npx web-push generate-vapid-keys

## Node
NODE_ENV=production

## Docker
Essas variáveis podem ser definidas em:

.env  
.env.prod  
docker-compose.prod.yml