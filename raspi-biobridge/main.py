import base64
import hmac
import json
import os
import secrets
import subprocess
import time
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="raspi-biobridge", version="0.1.0")

# Kiosk UI roda no navegador (outra origin/porta). Permite chamadas para localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _b64url_encode(data: bytes) -> str:
    return (
        base64.b64encode(data)
        .decode("ascii")
        .rstrip("=")
        .replace("+", "-")
        .replace("/", "_")
    )


def _hmac_sha256_hex(secret: str, payload_b64url: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload_b64url.encode("utf-8"), "sha256").hexdigest()


def sign_biometric_ref(secret: str, payload: dict) -> str:
    payload_b64url = _b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    sig_hex = _hmac_sha256_hex(secret, payload_b64url)
    return f"v1.{payload_b64url}.{sig_hex}"


def sanitize_customer_id(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    # mantém só caracteres seguros (evita injeção em mapping de user)
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.:@"
    return "".join([c for c in v if c in allowed])[:128]


def fprintd_verify(linux_user: str, timeout_sec: int = 25) -> bool:
    # roda o CLI do fprintd; precisa estar instalado no raspberry
    cmd = ["fprintd-verify", linux_user]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
        return res.returncode == 0
    except FileNotFoundError:
        raise RuntimeError("fprintd-verify não encontrado. Instale fprintd (libfprint).")
    except subprocess.TimeoutExpired:
        return False


class ScanReq(BaseModel):
    tokenId: str
    locationId: Optional[str] = None
    mode: Literal["dedupe-only", "identify-1n"] = "dedupe-only"


class VerifyReq(BaseModel):
    tokenId: str
    locationId: Optional[str] = None
    mode: Literal["verify-1to1"] = "verify-1to1"
    customerIdInput: str = Field(..., min_length=1, max_length=128)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scan")
def scan(req: ScanReq):
    secret = os.environ.get("BIOBRIDGE_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="BIOBRIDGE_SECRET não configurado")

    bind_token = os.environ.get("BIOBRIDGE_BIND_TOKEN_ID")
    if bind_token and bind_token != req.tokenId:
        raise HTTPException(status_code=403, detail="tokenId não permitido neste dispositivo")

    bind_location = os.environ.get("BIOBRIDGE_BIND_LOCATION_ID")
    if bind_location and (req.locationId or None) != bind_location:
        raise HTTPException(status_code=403, detail="locationId não permitido neste dispositivo")

    # Observação: sem armazenamento de templates/match local, este /scan é útil apenas em modo mock
    # ou quando a pilha de biometria consegue retornar um identificador estável.
    subject_id = f"anon:{secrets.token_hex(16)}"

    payload = {
        "v": 1,
        "ts": int(time.time() * 1000),
        "nonce": secrets.token_hex(12),
        "tokenId": req.tokenId,
        "locationId": req.locationId,
        "mode": req.mode,
        "subjectId": subject_id,
    }
    return {"ok": True, "biometricRef": sign_biometric_ref(secret, payload), "payload": payload}


@app.post("/verify")
def verify(req: VerifyReq):
    secret = os.environ.get("BIOBRIDGE_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="BIOBRIDGE_SECRET não configurado")

    bind_token = os.environ.get("BIOBRIDGE_BIND_TOKEN_ID")
    if bind_token and bind_token != req.tokenId:
        raise HTTPException(status_code=403, detail="tokenId não permitido neste dispositivo")

    bind_location = os.environ.get("BIOBRIDGE_BIND_LOCATION_ID")
    if bind_location and (req.locationId or None) != bind_location:
        raise HTTPException(status_code=403, detail="locationId não permitido neste dispositivo")

    customer_id = sanitize_customer_id(req.customerIdInput)
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerIdInput inválido")

    mode = os.environ.get("BIOBRIDGE_MODE", "mock").strip().lower()
    if mode == "fprintd":
        tpl = os.environ.get("BIOBRIDGE_VERIFY_USER_TEMPLATE", "cust_{id}")
        linux_user = tpl.replace("{id}", customer_id)
        ok = fprintd_verify(linux_user)
        if not ok:
            raise HTTPException(status_code=401, detail="Falha na verificação biométrica")
    else:
        # mock: sempre autoriza (útil para dev)
        pass

    payload = {
        "v": 1,
        "ts": int(time.time() * 1000),
        "nonce": secrets.token_hex(12),
        "tokenId": req.tokenId,
        "locationId": req.locationId,
        "mode": "verify-1to1",
        "subjectId": f"cust:{customer_id}",
    }
    return {"ok": True, "biometricRef": sign_biometric_ref(secret, payload), "payload": payload}


@app.post("/identify")
def identify():
    # Identificação 1:N depende de suporte do leitor/stack (muitos fluxos com fprintd não expõem).
    raise HTTPException(status_code=501, detail="identify-1n não implementado neste bridge")

