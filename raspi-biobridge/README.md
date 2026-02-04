## raspi-biobridge (BioBridge local)

Serviço **local** para Raspberry (touchscreen) com leitor biométrico via **libfprint/fprintd**, usado pelo Totem/Kiosk.

Ele expõe endpoints HTTP em `localhost` e retorna um `biometricRef` **assinado** (HMAC) que o backend valida antes de criar a senha.

### Endpoints

- `GET /health`
- `POST /scan`
  - Uso típico: modos que não exigem identificador prévio (ex: `dedupe-only`)
- `POST /verify`
  - Uso típico: `verify-1to1` (ex: CPF/telefone + digital)
- `POST /identify`
  - Uso típico: `identify-1n` (não implementado por padrão; depende de suporte do leitor/stack)

### Contrato do biometricRef

Compatível com `api/services/biometricService.js`:

- Formato: `v1.<payloadB64Url>.<sigHex>`
- Assinatura: `HMAC-SHA256(secret, payloadB64Url)`
- Payload mínimo:
  - `v`, `ts`, `nonce`, `tokenId`, `locationId`, `mode`, `subjectId`

### Configuração (env vars)

- **`BIOBRIDGE_SECRET`**: secret usado para assinar `biometricRef` (deve bater com `publicAccessToken.meta.biometricSecret` no backend)
- `BIOBRIDGE_BIND_TOKEN_ID`: opcional (se setado, o bridge só emite refs para esse `tokenId`)
- `BIOBRIDGE_BIND_LOCATION_ID`: opcional
- `BIOBRIDGE_MODE`: `mock` (default) ou `fprintd`
- `BIOBRIDGE_VERIFY_USER_TEMPLATE`: template para mapear `customerIdInput` → linux user (default: `cust_{id}`)

### Rodar localmente (dev)

```bash
cd raspi-biobridge
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
BIOBRIDGE_SECRET="dev_secret" uvicorn main:app --host 127.0.0.1 --port 17923
```

### Systemd (raspberry)

Veja `raspi-biobridge.service`.

