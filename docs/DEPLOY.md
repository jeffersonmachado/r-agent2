# Deploy em Produção

## Regra fundamental
Produção roda somente via Docker.

PM2 não é suportado.

Motivo:
- Vite dev server quebra PWA
- Service Worker exige build estático

## Requisitos
Servidor precisa ter:
Docker  
Docker Compose  
SSH  

## Método oficial de deploy
Deploy é feito via script:

scripts/docker-deploy-wrapper.sh

Esse script executa:
rsync → ssh → docker compose build → docker compose up

## Comando de deploy
Exemplo:

./scripts/docker-deploy-wrapper.sh \
  --host servidor \
  --user root \
  --dir /opt/results/ria/r-agent2

## Fluxo de deploy
1. sincroniza código via rsync
2. conecta via SSH
3. executa docker compose
4. rebuild das imagens
5. sobe containers

## Build do frontend
O frontend é buildado dentro do Docker.

frontend/Dockerfile

Passos:
npm ci  
npm run build  

Resultado:
frontend/dist

## Containers
Produção usa:
docker-compose.prod.yml

Containers:
frontend (nginx)  
api (node)  
database  

## Variáveis importantes
VITE_BASE_PATH  
VITE_API_BASE_URL  

## Validação após deploy
curl https://dominio/r-agent2/manifest.webmanifest  
curl https://dominio/r-agent2/sw.js  

Ambos devem retornar 200.