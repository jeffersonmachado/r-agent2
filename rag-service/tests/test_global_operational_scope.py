"""
Escopo de tenant da recuperação: GLOBAL_OPERATIONAL ∪ TENANT_OPERATIONAL.

Contexto: o conhecimento operacional global do RAP (roteiros canônicos, manuais
de produto, documentação de uso) é indexado sob a chave de tenant canônica
`system`. A busca vetorial filtrava `tenant_key = <tenant atual>` de forma
estrita, então nenhum tenant real enxergava o conhecimento global — e o
inverso (um tenant enxergar o conhecimento privado de outro) não pode existir
em nenhuma hipótese.

Regras verificadas aqui:
  - OPERATIONAL → chaves = [tenant atual, chave global];
  - SYSTEM      → chaves = [tenant atual] (nunca global);
  - `scope.tenant_keys` enviado pelo chamador NUNCA amplia o escopo;
  - sempre há pelo menos a chave do tenant do request (sem wildcard);
  - a chave global é configurável por env (RAG_GLOBAL_OPERATIONAL_TENANT).
"""

import os

import pytest

from services.domain_policy import (
    DEFAULT_GLOBAL_OPERATIONAL_TENANT,
    get_global_operational_tenant,
    is_global_operational_tenant,
    resolve_scope_tenant_keys,
)


def test_operational_inclui_conhecimento_global():
    keys = resolve_scope_tenant_keys({"domain": "OPERATIONAL"}, "academia-a")
    assert keys == ["academia-a", DEFAULT_GLOBAL_OPERATIONAL_TENANT]


def test_system_nunca_inclui_conhecimento_global():
    keys = resolve_scope_tenant_keys({"domain": "SYSTEM", "classifications": ["DEVELOPMENT"]}, "academia-a")
    assert keys == ["academia-a"]


def test_sem_escopo_aplica_operational_restritivo_e_inclui_global():
    keys = resolve_scope_tenant_keys(None, "academia-a")
    assert keys == ["academia-a", DEFAULT_GLOBAL_OPERATIONAL_TENANT]


def test_tenant_keys_do_payload_nao_amplia_escopo():
    """Payload hostil: pedir o tenant de outro cliente não tem efeito nenhum."""
    malicious = {
        "domain": "OPERATIONAL",
        "classifications": ["PRODUCTION"],
        "tenantKeys": ["academia-b", "outro-cliente"],
        "tenant_keys": ["academia-b", "outro-cliente"],
    }
    keys = resolve_scope_tenant_keys(malicious, "academia-a")
    assert keys == ["academia-a", DEFAULT_GLOBAL_OPERATIONAL_TENANT]
    assert "academia-b" not in keys
    assert "outro-cliente" not in keys


def test_sem_tenant_nao_ha_escopo():
    assert resolve_scope_tenant_keys({"domain": "OPERATIONAL"}, "") == []
    assert resolve_scope_tenant_keys({"domain": "OPERATIONAL"}, None) == []


def test_tenant_igual_ao_global_nao_duplica():
    keys = resolve_scope_tenant_keys({"domain": "OPERATIONAL"}, DEFAULT_GLOBAL_OPERATIONAL_TENANT)
    assert keys == [DEFAULT_GLOBAL_OPERATIONAL_TENANT]


def test_chave_global_configuravel_por_env(monkeypatch):
    monkeypatch.setenv("RAG_GLOBAL_OPERATIONAL_TENANT", "rap-global")
    assert get_global_operational_tenant() == "rap-global"
    assert is_global_operational_tenant("rap-global") is True
    assert is_global_operational_tenant(DEFAULT_GLOBAL_OPERATIONAL_TENANT) is False
    assert resolve_scope_tenant_keys({"domain": "OPERATIONAL"}, "academia-a") == ["academia-a", "rap-global"]
    # SYSTEM continua restrito ao tenant atual mesmo com a chave global trocada.
    assert resolve_scope_tenant_keys({"domain": "SYSTEM"}, "academia-a") == ["academia-a"]


def test_tenant_keys_ignora_scope_invalido():
    keys = resolve_scope_tenant_keys({"domain": "NAO_EXISTE"}, "academia-a")
    # Domínio inválido cai no restritivo (OPERATIONAL) — inclusive para tenant.
    assert keys == ["academia-a", DEFAULT_GLOBAL_OPERATIONAL_TENANT]


def test_env_vazio_cai_no_default(monkeypatch):
    monkeypatch.setenv("RAG_GLOBAL_OPERATIONAL_TENANT", "   ")
    assert get_global_operational_tenant() == DEFAULT_GLOBAL_OPERATIONAL_TENANT
