<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
# Pacote inicial da Agenda Autônoma para o r-agent2

Este pacote traz uma base de código para integrar a **Agenda Autônoma** ao core do r-agent2.

## O que está incluído
- migration do core de Agenda Autônoma
- 4 models Sequelize no padrão do projeto
- serviços centrais de:
  - policy
  - waiting list
  - detecção de gaps
  - ranking de candidatos
  - campanhas
- jobs manuais para detectar gaps e rodar campanhas
- prompt de integração detalhado

## O que ainda precisa ser feito
- registrar os models em `api/db/models/index.js`
- expor endpoints no `api/server.js`
- conectar envio real de WhatsApp
- criar tela mínima no frontend
- adicionar testes

## Observação importante
O código foi preparado para **reaproveitar CRM e agenda já existentes**. Ele não substitui `schedulingService.js`; ele orquestra por cima dele.
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
# r-vpn-manager-backend

Backend server for managing SoftEther VPN hubs and users.

## Installation

<<<<<<< ours
1. Install the dependencies:
=======
1. Go to the repository root (`r-vpn-manager-backend`) and install dependencies:
>>>>>>> theirs
   ```bash
   npm install
   ```

<<<<<<< ours
=======
### Why `npm install` is needed

This project depends on packages listed in `package.json` (for example, `express`, `dotenv`, and `jsonwebtoken`).
Running `npm install` downloads these packages into the local `node_modules/` folder, which is required before running `npm start` or `npm run dev`.

### Where `npm install` should be run

Run it in the project root directory, where `package.json` is located.

Example:
```bash
cd /workspace/r-vpn-manager-backend
npm install
```

>>>>>>> theirs
## Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and fill in the variables:
   - `SE_HOST` - SoftEther server host (e.g. `127.0.0.1`)
   - `SE_PORT` - SoftEther server port (e.g. `5555`)
   - `SE_SECURE` - set to `true` to use HTTPS or `false` for HTTP
   - `SE_ADMIN_HUB` - name of the hub to manage
   - `SE_ADMIN_USER` - SoftEther administrator user
   - `SE_ADMIN_PASS` - SoftEther administrator password
   - `JWT_SECRET` - secret key used to sign JWT tokens
   - `JWT_EXPIRATION` - token expiration time (e.g. `1h`)
   - `PORT` - port for this backend (defaults to `3000`)

## Running the server

Start the API server with:
```bash
npm start
```

During development you can use nodemon to reload on changes:
```bash
npm run dev
```

The server will listen on the port defined in the `PORT` environment variable.
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
