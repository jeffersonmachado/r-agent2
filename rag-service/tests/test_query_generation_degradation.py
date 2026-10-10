"""
Regressões da GERAÇÃO no `/rag/query` (defeito medido em 2026-10-08).

Contexto do defeito: quando o provider de LLM falha (ex.: HTTP 429 sem crédito),
o serviço devolvia `"Com base nas informações disponíveis: <chunk cru>..."` —
texto NÃO sintetizado — e nenhum campo indicava isso. O consumidor (Ask AI)
apresentava o trecho como resposta fundamentada (`confidence: fully_grounded`),
com aparência de resposta pronta para uma pergunta que ele não respondia.

Estes testes fixam o contrato novo:
 1. falha de geração → `metadata.generated = False` + `degradationReason`;
 2. o texto degradado se declara como trecho recuperado (nunca "resposta");
 3. sucesso → `generated = True` e os overrides de provider do tenant
    (chave/base_url/modelo) chegam ao `generate_response`.
"""

import os

import pytest
from fastapi.testclient import TestClient

from main import app
from api.routes import query as query_routes
from services import llm_service

client = TestClient(app)
if os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = os.environ["RAG_INTERNAL_TOKEN"]

TENANT = "query-test-tenant"
HEADERS_PROVIDER = {
    # Credencial fictícia: o teste nunca chama provider real.
    "X-RAG-LLM-API-Key": "sk-teste-nao-e-credencial-real",
    "X-RAG-LLM-Base-URL": "https://api.deepseek.com/v1",
    "X-RAG-LLM-Model": "deepseek-flash",
}


class _Chunk:
    """Chunk mínimo aceito pelo pipeline (id/content/score/documentId/metadata)."""

    def __init__(self, index, content, score):
        self.id = f"chunk-{index}"
        self.documentId = "doc-degradacao"
        self.content = content
        self.score = score
        self.metadata = None


class _StoreComCorpus:
    """Double de vector store com 2 chunks acima do piso de relevância."""

    def get_stats(self):
        return {"documentCount": 1, "chunkCount": 2, "indexSize": 0}

    def add_chunks(self, chunks, _embeddings):
        return len(chunks)

    def search(self, _embedding, **_kwargs):
        return [
            _Chunk(0, "Passo 1: cadastrar o aluno. Passo 2: registrar o pagamento.", 0.66),
            _Chunk(1, "Check-in diário registra presença e frequência.", 0.58),
        ]


@pytest.fixture
def store_com_corpus(monkeypatch):
    store = _StoreComCorpus()
    monkeypatch.setattr(query_routes, "generate_embedding", lambda _text: [0.0] * 384)
    monkeypatch.setattr(query_routes, "get_vector_store", lambda _tenant_id: store)
    return store


def _pergunta(pergunta="Como faço uma matrícula?"):
    return {
        "query": pergunta,
        "tenantId": TENANT,
        "options": {"topK": 5, "minScore": 0.5},
    }


def test_falha_do_llm_nao_vira_resposta_fundamentada(store_com_corpus, monkeypatch):
    """429/erro de provider: resposta degradada DECLARADA, nunca trecho cru."""

    def _falha(*_args, **_kwargs):
        raise RuntimeError("Error code: 429 - credit_balance_exhausted")

    monkeypatch.setattr(query_routes, "generate_response", _falha)

    response = client.post("/rag/query", json=_pergunta(), headers=HEADERS_PROVIDER)
    assert response.status_code == 200

    data = response.json()
    metadata = data["metadata"]

    assert metadata["generated"] is False
    assert metadata["degradationReason"] == "llm_unavailable"

    texto = data["response"]
    # O texto antigo era apresentado como resposta pronta — não pode voltar.
    assert "Com base nas informações disponíveis" not in texto
    assert "Não foi possível gerar a resposta agora" in texto
    # O trecho recuperado continua disponível (evidência), mas rotulado.
    assert "Passo 1: cadastrar o aluno" in texto

    # As fontes recuperadas continuam sendo reportadas.
    assert data["sources"], "chunks recuperados devem continuar visíveis como fontes"


def test_geracao_bem_sucedida_marca_generated_true(store_com_corpus, monkeypatch):
    monkeypatch.setattr(
        query_routes,
        "generate_response",
        lambda *_args, **_kwargs: "Resposta sintetizada sobre matrícula, com passos detalhados.",
    )

    response = client.post("/rag/query", json=_pergunta(), headers=HEADERS_PROVIDER)
    assert response.status_code == 200

    metadata = response.json()["metadata"]
    assert metadata["generated"] is True
    assert metadata["degradationReason"] is None


def test_overrides_de_provider_do_tenant_chegam_ao_llm(store_com_corpus, monkeypatch):
    """O provider roteado pelo tenant precisa chegar ao SDK (chave/base_url/modelo)."""
    capturado = {}

    def _captura(_prompt, **kwargs):
        capturado.update(kwargs)
        return "Resposta sintetizada sobre matrícula, com passos detalhados."

    monkeypatch.setattr(query_routes, "generate_response", _captura)

    response = client.post("/rag/query", json=_pergunta(), headers=HEADERS_PROVIDER)
    assert response.status_code == 200

    assert capturado["api_key_override"] == HEADERS_PROVIDER["X-RAG-LLM-API-Key"]
    assert capturado["base_url_override"] == HEADERS_PROVIDER["X-RAG-LLM-Base-URL"]
    assert capturado["model_override"] == HEADERS_PROVIDER["X-RAG-LLM-Model"]


def test_sem_overrides_o_comportamento_anterior_e_preservado(store_com_corpus, monkeypatch):
    capturado = {}

    def _captura(_prompt, **kwargs):
        capturado.update(kwargs)
        return "Resposta sintetizada sobre matrícula, com passos detalhados."

    monkeypatch.setattr(query_routes, "generate_response", _captura)

    response = client.post("/rag/query", json=_pergunta())
    assert response.status_code == 200
    assert capturado["base_url_override"] is None
    assert capturado["model_override"] is None


def test_llm_service_usa_base_url_e_modelo_do_provider(monkeypatch):
    """O cliente do SDK é criado com o endpoint do provider, não só com a chave."""
    from types import SimpleNamespace

    chamadas = {}

    class _FakeOpenAI:
        def __init__(self, **kwargs):
            chamadas["init"] = kwargs
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self._create)
            )

        def _create(self, **kwargs):
            chamadas["create"] = kwargs
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
            )

    monkeypatch.setattr(llm_service, "OpenAI", _FakeOpenAI)
    llm_service.reset_openai_client()
    try:
        texto = llm_service.generate_response(
            "pergunta",
            api_key_override="sk-teste-nao-e-credencial-real",
            base_url_override="https://api.deepseek.com/v1",
            model_override="deepseek-chat",
        )
    finally:
        # O cliente é singleton de módulo: não vaza o fake para outros testes.
        llm_service.reset_openai_client()

    assert texto == "ok"
    assert chamadas["init"]["api_key"] == "sk-teste-nao-e-credencial-real"
    assert chamadas["init"]["base_url"] == "https://api.deepseek.com/v1"
    assert chamadas["create"]["model"] == "deepseek-chat"
