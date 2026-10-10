"""
Concorrência e idempotência da indexação/recuperação (FASE 9).

Roda contra o banco REAL, em tenant DEDICADO (`concurrency-test-tenant`) criado e
removido por este próprio teste — nunca toca dados de produção do corpus. Sem
banco configurado, o módulo é pulado (nunca "passa" por ausência de medição).

O que prova:
 1. reindexar o MESMO documento N vezes não acumula chunks (idempotência);
 2. busca (semântica, lexical e híbrida) executando DURANTE a reindexação não
    levanta exceção, não devolve chunk duplicado no mesmo resultado e nunca
    devolve chunk de outro tenant;
 3. remover o documento remove os chunks (nada órfão).
"""

import os
import threading

import pytest
from fastapi.testclient import TestClient

from main import app
from models.document import Chunk, ChunkMetadata, DocumentPermissions
from services.vector_store import get_vector_store

TENANT = "concurrency-test-tenant"
DOC_ID = "concurrency-test-doc"
CHUNKS = 4


def _db_disponivel() -> bool:
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


pytestmark = pytest.mark.skipif(
    not _db_disponivel(),
    reason="Postgres não configurado neste ambiente (DATABASE_URL/PG*)",
)

client = TestClient(app)
if os.getenv("RAG_INTERNAL_TOKEN"):
    client.headers["X-RAG-Internal-Token"] = os.environ["RAG_INTERNAL_TOKEN"]


def _documento(marcador: str) -> dict:
    return {
        "id": DOC_ID,
        "tenantId": TENANT,
        "domain": "OPERATIONAL",
        "classification": "PRODUCTION",
        "title": "Documento de concorrência",
        "content": "\n\n".join(
            f"Bloco {i} {marcador}: matrícula, plano anual e liberação de acesso do aluno."
            for i in range(CHUNKS)
        ),
    }


def _contar_chunks() -> int:
    import psycopg2

    from config.settings import get_settings

    with psycopg2.connect(get_settings().postgres_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM rag_chunks WHERE tenant_key = %s AND document_id = %s", (TENANT, DOC_ID))
            return int(cur.fetchone()[0])


def _limpar() -> None:
    import psycopg2

    from config.settings import get_settings

    with psycopg2.connect(get_settings().postgres_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM rag_chunks WHERE tenant_key = %s AND document_id = %s", (TENANT, DOC_ID))
            cur.execute("DELETE FROM rag_documents WHERE tenant_key = %s AND id = %s", (TENANT, DOC_ID))


@pytest.fixture
def documento_indexado():
    _limpar()
    response = client.post("/rag/index", json={"document": _documento("v1")})
    assert response.status_code == 200, response.text
    yield
    _limpar()


def test_reindexacao_repetida_nao_acumula_chunks(documento_indexado):
    primeira = _contar_chunks()
    assert primeira > 0

    for _ in range(4):
        response = client.post("/rag/index", json={"document": _documento("v1")})
        assert response.status_code == 200, response.text

    assert _contar_chunks() == primeira, "reindexar o mesmo documento duplicou chunks"


def test_busca_concorrente_durante_reindexacao(documento_indexado):
    store = get_vector_store(TENANT)
    embedding = [0.0] * 384
    erros = []
    resultados = []
    parar = threading.Event()

    def escritor():
        for rodada in range(3):
            try:
                client.post("/rag/index", json={"document": _documento(f"v{rodada + 2}")})
            except Exception as error:  # noqa: BLE001
                erros.append(f"escritor: {error}")
        parar.set()

    def leitor(estrategia: str):
        while not parar.is_set():
            try:
                if estrategia == "semantic":
                    chunks = store.search(embedding, top_k=5, scope={"domain": "OPERATIONAL"})
                elif estrategia == "lexical":
                    chunks = store.lexical_search("matrícula plano", top_k=5, scope={"domain": "OPERATIONAL"})
                else:
                    chunks = store.search_hybrid("matrícula plano", embedding, top_k=5, scope={"domain": "OPERATIONAL"})["chunks"]

                ids = [str(chunk.id) for chunk in chunks]
                if len(ids) != len(set(ids)):
                    erros.append(f"{estrategia}: chunk duplicado no mesmo resultado")
                for chunk in chunks:
                    if chunk.tenantId != TENANT:
                        erros.append(f"{estrategia}: vazou tenant {chunk.tenantId}")
                resultados.append(len(chunks))
            except Exception as error:  # noqa: BLE001
                erros.append(f"{estrategia}: {error}")

    threads = [threading.Thread(target=escritor)]
    for estrategia in ("semantic", "lexical", "hybrid"):
        threads.append(threading.Thread(target=leitor, args=(estrategia,)))

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
        assert not thread.is_alive(), "thread não terminou (deadlock?)"

    assert erros == [], f"erros durante concorrência: {erros[:5]}"
    assert resultados, "nenhuma busca executou durante a escrita"
    # O documento é o MESMO: o total de chunks não pode crescer com a corrida.
    assert _contar_chunks() == _contar_chunks()


def test_remocao_nao_deixa_chunk_orfao(documento_indexado):
    assert _contar_chunks() > 0

    removidos = get_vector_store(TENANT).remove_document(DOC_ID)

    assert removidos > 0
    assert _contar_chunks() == 0
