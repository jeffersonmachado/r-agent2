"""Configuração global, segura e isolada para os testes pytest do RAG."""

import os
import shutil
from functools import lru_cache
from pathlib import Path

import pytest


# O serviço é fail-closed mesmo em teste. A suíte usa uma credencial explícita
# e sem relação com qualquer segredo de runtime para exercitar o mesmo contrato.
os.environ.setdefault(
    "RAG_INTERNAL_TOKEN",
    "pytest-only-rag-internal-token-32-bytes-minimum",
)

# Isola dados do aprendizado adaptativo para evitar interferência entre execuções.
os.environ.setdefault("ADAPTIVE_LEARNING_DATA_PATH", "./data/test_adaptive_learning")


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Configura diretórios transitórios exclusivos da suíte."""
    test_data_dir = Path("./data/test_vector_store")
    adaptive_data_dir = Path(os.environ["ADAPTIVE_LEARNING_DATA_PATH"])

    if adaptive_data_dir.exists():
        shutil.rmtree(adaptive_data_dir, ignore_errors=True)
    test_data_dir.mkdir(parents=True, exist_ok=True)
    adaptive_data_dir.mkdir(parents=True, exist_ok=True)

    os.environ["VECTOR_STORE_PATH"] = str(test_data_dir)
    os.environ["DEBUG"] = "true"

    yield

    if test_data_dir.exists():
        shutil.rmtree(test_data_dir, ignore_errors=True)
    if adaptive_data_dir.exists():
        shutil.rmtree(adaptive_data_dir, ignore_errors=True)


@lru_cache(maxsize=1)
def _postgres_disponivel() -> bool:
    """Verifica se há Postgres acessível (mesmo critério da integração)."""
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


@pytest.fixture(autouse=True)
def stub_dedup_db_sem_postgres(monkeypatch):
    """Isola a deduplicação DB-backed apenas quando não há Postgres de teste."""
    if _postgres_disponivel():
        return

    from services import deduplication_service as dedup

    monkeypatch.setattr(dedup, "_fetch_chunk_by_content_hash", lambda *args, **kwargs: None)
    monkeypatch.setattr(dedup, "_fetch_chunk_by_semantic_hash", lambda *args, **kwargs: None)
    monkeypatch.setattr(dedup, "_fetch_most_similar_chunk", lambda *args, **kwargs: None)
    monkeypatch.setattr(dedup, "_update_deactivate_previous_versions", lambda *args, **kwargs: 0)
    monkeypatch.setattr(dedup, "_fetch_max_source_version", lambda *args, **kwargs: None)
