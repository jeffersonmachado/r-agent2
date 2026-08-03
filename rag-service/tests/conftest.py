"""
Configuração global para testes pytest.
"""

import pytest
import os
import shutil
from pathlib import Path

# Isola dados do aprendizado adaptativo para evitar interferência entre execuções.
os.environ.setdefault("ADAPTIVE_LEARNING_DATA_PATH", "./data/test_adaptive_learning")


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Configura ambiente de teste."""
    # Define diretório de dados de teste
    test_data_dir = Path("./data/test_vector_store")
    adaptive_data_dir = Path(os.environ["ADAPTIVE_LEARNING_DATA_PATH"])

    # Garante baseline limpo antes da suíte.
    if adaptive_data_dir.exists():
        shutil.rmtree(adaptive_data_dir, ignore_errors=True)
    test_data_dir.mkdir(parents=True, exist_ok=True)
    adaptive_data_dir.mkdir(parents=True, exist_ok=True)
    
    # Define variáveis de ambiente para testes
    os.environ["VECTOR_STORE_PATH"] = str(test_data_dir)
    os.environ["DEBUG"] = "true"
    
    yield
    
    # Cleanup após todos os testes
    if test_data_dir.exists():
        shutil.rmtree(test_data_dir, ignore_errors=True)
    if adaptive_data_dir.exists():
        shutil.rmtree(adaptive_data_dir, ignore_errors=True)


def _postgres_disponivel() -> bool:
    """Verifica se há Postgres acessível (mesmo critério dos testes de integração)."""
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
    """
    Sem Postgres, stuba a camada de acesso ao DB da deduplicação
    ("nenhum duplicado conhecido") para que os testes de endpoint não
    dependam de banco. Falha de DB real propaga erro (persistence_required);
    este stub existe apenas porque o ambiente de teste unitário não tem DB.
    Com Postgres disponível, a deduplicação real é exercitada.
    """
    if _postgres_disponivel():
        return

    from services import deduplication_service as dedup

    monkeypatch.setattr(dedup, '_fetch_chunk_by_content_hash', lambda *args, **kwargs: None)
    monkeypatch.setattr(dedup, '_fetch_chunk_by_semantic_hash', lambda *args, **kwargs: None)
    monkeypatch.setattr(dedup, '_fetch_most_similar_chunk', lambda *args, **kwargs: None)
    monkeypatch.setattr(dedup, '_update_deactivate_previous_versions', lambda *args, **kwargs: 0)
    monkeypatch.setattr(dedup, '_fetch_max_source_version', lambda *args, **kwargs: None)
