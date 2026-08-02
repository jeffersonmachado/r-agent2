"""
Testes obrigatórios de segregação dos domínios do RAG (OPERATIONAL vs SYSTEM).

Cobre (pedido 2026-08-01, seção 16):
- ingestão sem domain/classification é rejeitada (nunca indexada);
- domínio/classificação inválidos ou incoerentes são rejeitados;
- documento com secret é bloqueado ANTES da indexação (422 secret_detected);
- retrieval sempre filtrado por escopo no SQL (OPERATIONAL não vê SYSTEM);
- sem escopo informado, aplica o mais restritivo (OPERATIONAL/PRODUCTION);
- escopo inválido/forjado nunca amplia (sanitização);
- domínio OPERATIONAL nunca inclui classification DEVELOPMENT;
- não existe fallback entre domínios;
- chamada direta sem token interno é rejeitada (quando token configurado).
"""

import os
import pytest
from fastapi.testclient import TestClient

from main import app
from services.domain_policy import (
    DEFAULT_SCOPE,
    DomainPolicyError,
    detect_secrets,
    normalize_domain_metadata,
    resolve_query_scope,
)

client = TestClient(app)

# Token interno obrigatório quando configurado (auth serviço-a-serviço)
import os as _os
if _os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = _os.environ["RAG_INTERNAL_TOKEN"]

INTERNAL_TOKEN = os.getenv("RAG_INTERNAL_TOKEN", "")
AUTH_HEADERS = {"X-RAG-Internal-Token": INTERNAL_TOKEN} if INTERNAL_TOKEN else {}


# ---------------------------------------------------------------------------
# domain_policy (unitário puro)
# ---------------------------------------------------------------------------

class TestNormalizeDomainMetadata:
    def test_documento_sem_domain_e_rejeitado(self):
        with pytest.raises(DomainPolicyError) as exc:
            normalize_domain_metadata({"classification": "PRODUCTION"})
        assert exc.value.code == "missing_domain"

    def test_documento_sem_classification_e_rejeitado(self):
        with pytest.raises(DomainPolicyError) as exc:
            normalize_domain_metadata({"domain": "OPERATIONAL"})
        assert exc.value.code == "missing_classification"

    def test_domain_invalido_e_rejeitado(self):
        with pytest.raises(DomainPolicyError) as exc:
            normalize_domain_metadata({"domain": "PUBLICO", "classification": "PRODUCTION"})
        assert exc.value.code == "invalid_domain"

    def test_operational_nao_aceita_development(self):
        with pytest.raises(DomainPolicyError) as exc:
            normalize_domain_metadata({"domain": "OPERATIONAL", "classification": "DEVELOPMENT"})
        assert exc.value.code == "incoherent_domain_classification"

    def test_system_nao_aceita_production(self):
        with pytest.raises(DomainPolicyError) as exc:
            normalize_domain_metadata({"domain": "SYSTEM", "classification": "PRODUCTION"})
        assert exc.value.code == "incoherent_domain_classification"

    def test_payload_valido_normaliza_case(self):
        meta = normalize_domain_metadata({"domain": "system", "classification": "support"})
        assert meta == {"domain": "SYSTEM", "classification": "SUPPORT", "sensitivity": "INTERNAL"}


class TestDetectSecrets:
    @pytest.mark.parametrize("content", [
        "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----",
        "aws key: AKIAIOSFODNN7EXAMPLE",
        "token sk-abcdefghijklmnopqrsk123456",
        "xoxb-123456789012-abcdefghijkl",
        "ghp_abcdefghijklmnopqrsk1234567890ab",
        "password: SuperSecret123",
        "api_key = 'abcdef1234567890abcd'",
        "Authorization: Bearer abcdef1234567890",
        "EAAabcdefghijklmnopqrsk1234567890abcd",
    ])
    def test_secrets_detectados(self, content):
        assert detect_secrets(content) != []

    @pytest.mark.parametrize("content", [
        "Para resetar sua senha, acesse o menu Configurações.",
        "Nosso horário de atendimento é das 9h às 18h.",
        "O token de fidelidade do cliente vale 10 pontos.",
        "",
    ])
    def test_conteudo_limpo_nao_e_flagrado(self, content):
        assert detect_secrets(content) == []


class TestResolveQueryScope:
    def test_sem_scope_aplica_mais_restritivo(self):
        assert resolve_query_scope(None) == DEFAULT_SCOPE

    def test_scope_invalido_nao_amplia(self):
        scope = resolve_query_scope({"domain": "TUDO", "classifications": ["DEVELOPMENT", "HACK"]})
        assert scope["domain"] == "OPERATIONAL"
        assert "DEVELOPMENT" not in scope["classifications"]

    def test_operational_nunca_inclui_development(self):
        scope = resolve_query_scope({"domain": "OPERATIONAL", "classifications": ["PRODUCTION", "DEVELOPMENT"]})
        assert scope == {"domain": "OPERATIONAL", "classifications": ["PRODUCTION"]}

    def test_system_com_classifications_validas(self):
        scope = resolve_query_scope({"domain": "SYSTEM", "classifications": ["SUPPORT", "DEVELOPMENT"]})
        assert scope == {"domain": "SYSTEM", "classifications": ["SUPPORT", "DEVELOPMENT"]}


# ---------------------------------------------------------------------------
# Ingestão (contrato HTTP)
# ---------------------------------------------------------------------------

class TestIngestaoEstrita:
    def test_documento_sem_dominio_e_rejeitado_400(self):
        response = client.post("/rag/index", headers=AUTH_HEADERS, json={
            "document": {"id": "seg-doc-sem-dominio", "tenantId": "seg-tenant", "content": "conteúdo válido qualquer"}
        })
        assert response.status_code == 400
        assert response.json()["detail"]["error"] == "missing_domain"

    def test_documento_sem_classification_e_rejeitado_400(self):
        response = client.post("/rag/index", headers=AUTH_HEADERS, json={
            "document": {"id": "seg-doc-sem-class", "tenantId": "seg-tenant", "domain": "OPERATIONAL", "content": "conteúdo válido qualquer"}
        })
        assert response.status_code == 400
        assert response.json()["detail"]["error"] == "missing_classification"

    def test_documento_com_secret_e_bloqueado_422(self):
        response = client.post("/rag/index", headers=AUTH_HEADERS, json={
            "document": {
                "id": "seg-doc-secret",
                "tenantId": "seg-tenant",
                "domain": "SYSTEM",
                "classification": "DEVELOPMENT",
                "content": "Configuração do ambiente: password: SuperSecret123 anotado no runbook",
            }
        })
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["error"] == "secret_detected"
        assert "SuperSecret123" not in str(detail)  # secret nunca é ecoado

    def test_documento_operacional_valido_aceito(self):
        response = client.post("/rag/index", headers=AUTH_HEADERS, json={
            "document": {
                "id": "seg-doc-operacional",
                "tenantId": "seg-tenant-op",
                "domain": "OPERATIONAL",
                "classification": "PRODUCTION",
                "content": "Nosso horário de atendimento é das 9h às 18h de segunda a sexta.",
            }
        })
        assert response.status_code == 200
        assert response.json()["success"] is True


# ---------------------------------------------------------------------------
# Recuperação com escopo (integração com Postgres; pula se indisponível)
# ---------------------------------------------------------------------------

def _postgres_disponivel() -> bool:
    try:
        from config.settings import get_settings
        import psycopg2
        dsn = get_settings().postgres_dsn
        if not dsn:
            return False
        conn = psycopg2.connect(dsn, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


requires_postgres = pytest.mark.skipif(not _postgres_disponivel(), reason="Postgres indisponível")

SYSTEM_DOC = {
    "id": "seg-doc-system-runbook",
    "tenantId": "seg-tenant-x",
    "domain": "SYSTEM",
    "classification": "DEVELOPMENT",
    "content": "ZEBRALUNE runbook interno: reinicie o orquestrador cognitivo pelo pipeline oficial de deploy.",
}
OPERATIONAL_DOC = {
    "id": "seg-doc-operacional-x",
    "tenantId": "seg-tenant-x",
    "domain": "OPERATIONAL",
    "classification": "PRODUCTION",
    "content": "ZEBRALUNE horário de atendimento da loja: das 9h às 18h, segundas e quartas.",
}


@requires_postgres
class TestRecuperacaoSegregada:
    @pytest.fixture(scope="class", autouse=True)
    def indexar_fixtures(self):
        for doc in (SYSTEM_DOC, OPERATIONAL_DOC):
            response = client.post("/rag/index", headers=AUTH_HEADERS, json={"document": doc})
            assert response.status_code == 200
        yield
        # cleanup: remove chunks dos documentos de teste
        try:
            from config.settings import get_settings
            import psycopg2
            with psycopg2.connect(get_settings().postgres_dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM rag_chunks WHERE document_id = ANY(%s)", ([SYSTEM_DOC["id"], OPERATIONAL_DOC["id"]],))
                    cur.execute("DELETE FROM rag_documents WHERE id = ANY(%s)", ([SYSTEM_DOC["id"], OPERATIONAL_DOC["id"]],))
        except Exception:
            pass

    def _query(self, payload):
        response = client.post("/rag/query", headers=AUTH_HEADERS, json=payload)
        assert response.status_code == 200
        return response.json()

    def test_escopo_operational_nao_recupera_system(self):
        data = self._query({
            "query": "ZEBRALUNE reiniciar orquestrador",
            "tenantId": "seg-tenant-x",
            "options": {"topK": 10, "minScore": 0.0},
            "scope": {"domain": "OPERATIONAL", "classifications": ["PRODUCTION"]},
        })
        doc_ids = [s["documentId"] for s in data["sources"]]
        assert SYSTEM_DOC["id"] not in doc_ids
        assert data["metadata"]["domain"] == "OPERATIONAL"

    def test_escopo_system_recupera_apenas_system(self):
        data = self._query({
            "query": "ZEBRALUNE",
            "tenantId": "seg-tenant-x",
            "options": {"topK": 10, "minScore": 0.0},
            "scope": {"domain": "SYSTEM", "classifications": ["SUPPORT", "DEVELOPMENT"]},
        })
        doc_ids = [s["documentId"] for s in data["sources"]]
        assert SYSTEM_DOC["id"] in doc_ids
        assert OPERATIONAL_DOC["id"] not in doc_ids

    def test_sem_scope_nao_recupera_system(self):
        # Sem escopo: default mais restritivo (OPERATIONAL/PRODUCTION)
        data = self._query({
            "query": "ZEBRALUNE reiniciar orquestrador",
            "tenantId": "seg-tenant-x",
            "options": {"topK": 10, "minScore": 0.0},
        })
        doc_ids = [s["documentId"] for s in data["sources"]]
        assert SYSTEM_DOC["id"] not in doc_ids

    def test_sem_fallback_entre_dominios(self):
        # Pergunta que só existe no domínio SYSTEM: escopo OPERATIONAL deve
        # responder "não encontrou", NUNCA buscar no SYSTEM.
        data = self._query({
            "query": "runbook interno reiniciar orquestrador cognitivo pipeline",
            "tenantId": "seg-tenant-x",
            "options": {"topK": 10, "minScore": 0.9},
            "scope": {"domain": "OPERATIONAL", "classifications": ["PRODUCTION"]},
        })
        doc_ids = [s["documentId"] for s in data["sources"]]
        assert SYSTEM_DOC["id"] not in doc_ids

    def test_tenant_isolado_mesmo_com_mesmo_escopo(self):
        data = self._query({
            "query": "ZEBRALUNE",
            "tenantId": "seg-tenant-y-inexistente",
            "options": {"topK": 10, "minScore": 0.0},
            "scope": {"domain": "SYSTEM", "classifications": ["DEVELOPMENT"]},
        })
        assert data["sources"] == []


# ---------------------------------------------------------------------------
# Token interno (quando configurado)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not INTERNAL_TOKEN, reason="RAG_INTERNAL_TOKEN não configurado neste ambiente")
class TestTokenInterno:
    # Cliente sem headers default: simula chamador direto sem credencial.
    anon_client = TestClient(app)

    def test_chamada_direta_sem_token_e_401(self):
        response = self.anon_client.post("/rag/query", json={"query": "teste", "tenantId": "seg-tenant-x"})
        assert response.status_code == 401

    def test_index_sem_token_e_401(self):
        response = self.anon_client.post("/rag/index", json={"document": {"id": "x", "tenantId": "y", "domain": "OPERATIONAL", "classification": "PRODUCTION", "content": "z"}})
        assert response.status_code == 401

    def test_token_invalido_e_401(self):
        response = self.anon_client.post("/rag/query", headers={"X-RAG-Internal-Token": "token-forjado"}, json={"query": "teste", "tenantId": "seg-tenant-x"})
        assert response.status_code == 401
