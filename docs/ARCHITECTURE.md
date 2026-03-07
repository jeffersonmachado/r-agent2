# Arquitetura do R-Agent2

## Visão geral
O sistema é composto por três camadas principais:

Frontend (React + Vite + PWA)  
API (Node.js)  
Infraestrutura (Docker + Nginx)

Browser
   │
   │ HTTPS
   ▼
Nginx (container frontend)
   │
   │ /api
   ▼
API Node.js
   │
   ├─ Engine / IA
   ├─ RAG / Vector DB
   └─ Banco de dados

## Componentes

### Frontend
Tecnologias:
- React
- Vite
- PWA
- Service Worker
- Web Push (preparado)

Responsável por:
- UI
- instalação do app
- offline cache
- notificações

### API
Tecnologias:
- Node.js
- Express
- WebSocket
- REST API

Responsável por:
- autenticação
- integração WhatsApp
- suporte humano
- CRM
- notificações push

### Docker
Ambiente de produção roda exclusivamente via Docker.

Containers:
frontend (nginx)  
api (node)  
database  

PM2 não é utilizado em produção.

## Base Path
O sistema pode rodar em subpath.

Exemplo:
https://dominio.com/r-agent2/

Variável usada:
VITE_BASE_PATH=/r-agent2/