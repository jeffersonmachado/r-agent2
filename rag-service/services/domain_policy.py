"""
Política de segregação de domínios do RAG (OPERATIONAL vs SYSTEM).

Regras obrigatórias (RAG Domain Segregation, 2026-08-01):
- Todo documento/chunk possui domain, classification e sensitivity.
- Conteúdo sem domain/classification é REJEITADO na ingestão (nunca indexado).
- A recuperação vetorial é SEMPRE filtrada por tenant + domain + classification
  no SQL, ANTES da busca por similaridade. Não existe retrieval sem escopo.
- Documentos com secrets/credenciais são bloqueados antes da indexação.
- Na dúvida, o escopo mais restritivo é aplicado (OPERATIONAL/PRODUCTION).
"""

import re
from typing import Any, Dict, List, Optional, Tuple

DOMAINS = ("OPERATIONAL", "SYSTEM")
CLASSIFICATIONS = ("PRODUCTION", "SUPPORT", "DEVELOPMENT")
SENSITIVITIES = ("PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED")

DEFAULT_DOMAIN = "OPERATIONAL"
DEFAULT_CLASSIFICATION = "PRODUCTION"
DEFAULT_SENSITIVITY = "INTERNAL"

# Escopo mais restritivo: usado quando nenhum escopo é informado.
DEFAULT_SCOPE: Dict[str, Any] = {
    "domain": DEFAULT_DOMAIN,
    "classifications": [DEFAULT_CLASSIFICATION],
    "sensitivities": ["PUBLIC", "INTERNAL"],
}

SENSITIVITY_CLEARANCE: Dict[str, List[str]] = {
    "PRODUCTION": ["PUBLIC", "INTERNAL"],
    "SUPPORT": ["PUBLIC", "INTERNAL", "CONFIDENTIAL"],
    "DEVELOPMENT": ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
}

# Padrões de secrets/credenciais que NUNCA podem ser indexados.
# Cada entrada: (categoria, regex). O valor casado nunca é logado nem retornado.
SECRET_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("openai_api_key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("anthropic_api_key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("github_token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("password_assignment", re.compile(r"(?i)\b(?:password|passwd|senha)\s*[:=]\s*\S{6,}")),
    ("token_assignment", re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?[A-Za-z0-9_/+\-.]{12,}")),
    ("bearer_token", re.compile(r"(?i)\bauthorization\s*:\s*bearer\s+\S{10,}")),
    ("whatsapp_token", re.compile(r"\bEAA[A-Za-z0-9]{30,}\b")),
]


class DomainPolicyError(ValueError):
    """Erro de política de domínio com código estável para o contrato HTTP."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def normalize_domain_metadata(doc_data: Dict[str, Any]) -> Dict[str, str]:
    """
    Extrai e valida domain/classification/sensitivity do payload de ingestão.

    Rejeita (DomainPolicyError) qualquer documento sem domínio e classificação
    explícitos e válidos — conteúdo não classificado nunca é indexado.
    """
    raw_domain = doc_data.get("domain")
    raw_classification = doc_data.get("classification")
    raw_sensitivity = doc_data.get("sensitivity", DEFAULT_SENSITIVITY)

    if not raw_domain:
        raise DomainPolicyError(
            "missing_domain",
            "Documento sem 'domain' é rejeitado: declare OPERATIONAL ou SYSTEM",
        )
    if not raw_classification:
        raise DomainPolicyError(
            "missing_classification",
            "Documento sem 'classification' é rejeitado: declare PRODUCTION, SUPPORT ou DEVELOPMENT",
        )

    domain = str(raw_domain).strip().upper()
    classification = str(raw_classification).strip().upper()
    sensitivity = str(raw_sensitivity).strip().upper()

    if domain not in DOMAINS:
        raise DomainPolicyError(
            "invalid_domain",
            f"domain inválido: {raw_domain!r}. Valores aceitos: {', '.join(DOMAINS)}",
        )
    if classification not in CLASSIFICATIONS:
        raise DomainPolicyError(
            "invalid_classification",
            f"classification inválida: {raw_classification!r}. Valores aceitos: {', '.join(CLASSIFICATIONS)}",
        )
    if sensitivity not in SENSITIVITIES:
        raise DomainPolicyError(
            "invalid_sensitivity",
            f"sensitivity inválida: {raw_sensitivity!r}. Valores aceitos: {', '.join(SENSITIVITIES)}",
        )

    # Coerência domain x classification: conteúdo de negócio não pode ser
    # classificado como DEVELOPMENT e conteúdo de sistema não pode ser PRODUCTION.
    if domain == "OPERATIONAL" and classification == "DEVELOPMENT":
        raise DomainPolicyError(
            "incoherent_domain_classification",
            "domain OPERATIONAL não aceita classification DEVELOPMENT",
        )
    if domain == "SYSTEM" and classification == "PRODUCTION":
        raise DomainPolicyError(
            "incoherent_domain_classification",
            "domain SYSTEM não aceita classification PRODUCTION",
        )

    return {"domain": domain, "classification": classification, "sensitivity": sensitivity}


def detect_secrets(text: str) -> List[str]:
    """
    Retorna as categorias de secrets encontradas no texto (nunca os valores).
    Lista vazia = texto limpo.
    """
    if not text:
        return []
    found = []
    for category, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            found.append(category)
    return found


def resolve_query_scope(scope: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Resolve o escopo obrigatório de recuperação. Sem escopo informado, aplica o
    mais restritivo (OPERATIONAL/PRODUCTION). Valores inválidos são descartados
    (nunca ampliam o escopo).
    """
    if not scope or not isinstance(scope, dict):
        return dict(DEFAULT_SCOPE)

    domain = str(scope.get("domain") or "").strip().upper()
    if domain not in DOMAINS:
        domain = DEFAULT_DOMAIN

    raw_classifications = scope.get("classifications")
    classifications: List[str] = []
    if isinstance(raw_classifications, list):
        for item in raw_classifications:
            value = str(item).strip().upper()
            if value in CLASSIFICATIONS and value not in classifications:
                classifications.append(value)
    if not classifications:
        # Fallback coerente com o domínio: o mais restritivo válido para ele.
        classifications = ["SUPPORT"] if domain == "SYSTEM" else [DEFAULT_CLASSIFICATION]

    # Coerência: OPERATIONAL nunca inclui DEVELOPMENT.
    if domain == "OPERATIONAL":
        classifications = [c for c in classifications if c != "DEVELOPMENT"] or [DEFAULT_CLASSIFICATION]

    highest_clearance = "PRODUCTION"
    if "DEVELOPMENT" in classifications:
        highest_clearance = "DEVELOPMENT"
    elif "SUPPORT" in classifications:
        highest_clearance = "SUPPORT"

    return {
        "domain": domain,
        "classifications": classifications,
        "sensitivities": list(SENSITIVITY_CLEARANCE[highest_clearance]),
    }


# ---------------------------------------------------------------------------
# Escopo de TENANT da recuperação (GLOBAL_OPERATIONAL ∪ CURRENT_TENANT_OPERATIONAL)
# ---------------------------------------------------------------------------
#
# O conhecimento operacional GLOBAL do RAP (roteiros canônicos, manuais de
# produto, documentação de uso) é indexado sob uma chave de tenant canônica
# (`system`). Antes desta correção a busca filtrava `tenant_key = <tenant atual>`
# de forma estrita, então nenhum tenant real enxergava o conhecimento global —
# e o inverso (um tenant enxergar conhecimento de outro) jamais pode acontecer.
#
# Regra (não ampliável por payload): as chaves de tenant são DERIVADAS aqui, a
# partir do tenant do request e do domínio. `scope.tenant_keys` enviado pelo
# chamador é IGNORADO — nenhum payload amplia escopo de tenant.
#
#   OPERATIONAL → [tenant atual] ∪ [GLOBAL_OPERATIONAL]
#   SYSTEM      → [tenant atual]   (conhecimento de sistema nunca é global)

GLOBAL_OPERATIONAL_TENANT_ENV = "RAG_GLOBAL_OPERATIONAL_TENANT"
DEFAULT_GLOBAL_OPERATIONAL_TENANT = "system"
MAX_TENANT_KEY_LENGTH = 128


def get_global_operational_tenant() -> str:
    """Chave de tenant do conhecimento operacional global (default: `system`)."""
    import os

    raw = os.getenv(GLOBAL_OPERATIONAL_TENANT_ENV) or DEFAULT_GLOBAL_OPERATIONAL_TENANT
    value = str(raw).strip()
    return value[:MAX_TENANT_KEY_LENGTH] or DEFAULT_GLOBAL_OPERATIONAL_TENANT


def is_global_operational_tenant(tenant_key: str) -> bool:
    """true se a chave é a chave canônica de conhecimento operacional global."""
    return str(tenant_key or "").strip() == get_global_operational_tenant()


def resolve_scope_tenant_keys(scope: Optional[Dict[str, Any]], tenant_id: str) -> List[str]:
    """
    Deriva as chaves de tenant elegíveis para a busca vetorial.

    A chave do tenant do request é sempre a primeira (e obrigatória). A chave
    de conhecimento operacional global é adicionada SOMENTE no domínio
    OPERATIONAL. Nunca há wildcard e nunca há mais de duas chaves.
    """
    resolved = resolve_query_scope(scope)
    primary = str(tenant_id or "").strip()[:MAX_TENANT_KEY_LENGTH]
    if not primary:
        return []

    keys = [primary]
    global_key = get_global_operational_tenant()
    if (
        resolved.get("domain") == "OPERATIONAL"
        and global_key
        and global_key not in keys
    ):
        keys.append(global_key)
    return keys
