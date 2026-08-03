"""
Testes da deduplicação persistida no Postgres (rag_chunks).

A camada de conexão (`_get_conn`) é mockada; o conftest stuba os helpers de
acesso ao DB quando não há Postgres disponível, então este módulo restaura as
implementações reais (capturadas no import) para exercitar as queries.
"""

import json

import pytest

from services import deduplication_service as dedup


# Implementações reais capturadas no import (antes de qualquer stub do conftest)
_REAL_DB_HELPERS = {
    name: getattr(dedup, name)
    for name in (
        '_fetch_chunk_by_content_hash',
        '_fetch_chunk_by_semantic_hash',
        '_fetch_most_similar_chunk',
        '_update_deactivate_previous_versions',
        '_fetch_max_source_version',
    )
}


@pytest.fixture(autouse=True)
def restaura_helpers_db_reais(monkeypatch):
    """Restaura os helpers reais de DB (o conftest os stuba sem Postgres)."""
    for name, fn in _REAL_DB_HELPERS.items():
        monkeypatch.setattr(dedup, name, fn)


class _FakeCursor:
    """Cursor fake: registra queries e devolve resultados programados (fetchone)."""

    def __init__(self, results, rowcount=0):
        self._results = list(results)
        self.queries = []
        self.rowcount = rowcount

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.queries.append((' '.join(str(sql).split()), params))

    def fetchone(self):
        return self._results.pop(0) if self._results else None


class _FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor


def _patch_conn(monkeypatch, results, rowcount=0):
    """Faz `_get_conn` retornar uma conexão fake e devolve o cursor para asserções."""
    cursor = _FakeCursor(results, rowcount=rowcount)
    monkeypatch.setattr(dedup, '_get_conn', lambda: _FakeConn(cursor))
    return cursor


# ---------------------------------------------------------------------------
# check_structural_duplicate
# ---------------------------------------------------------------------------

def test_structural_duplicate_detectado(monkeypatch):
    cursor = _patch_conn(monkeypatch, [
        ('chunk-1', 'doc-1', {'source_id': 's1', 'content_hash': 'abc', 'active': True}),
    ])

    result = dedup.check_structural_duplicate('tenant-a', 'abc', 's1')

    assert result['is_duplicate'] is True
    assert result['reason'] == 'content_hash_duplicate'
    assert result['existing_chunk']['chunk_id'] == 'chunk-1'
    assert result['existing_chunk']['document_id'] == 'doc-1'
    assert result['existing_chunk']['source_id'] == 's1'
    sql, params = cursor.queries[0]
    assert "metadata->>'content_hash'" in sql
    assert 'tenant_key = %s' in sql
    assert params == ('tenant-a', 'abc')


def test_structural_duplicate_sem_match(monkeypatch):
    _patch_conn(monkeypatch, [])

    result = dedup.check_structural_duplicate('tenant-a', 'abc')

    assert result == {'is_duplicate': False}


def test_structural_duplicate_metadata_como_string_json(monkeypatch):
    _patch_conn(monkeypatch, [
        ('chunk-1', 'doc-1', json.dumps({'source_id': 's1'})),
    ])

    result = dedup.check_structural_duplicate('tenant-a', 'abc')

    assert result['is_duplicate'] is True
    assert result['existing_chunk']['source_id'] == 's1'


# ---------------------------------------------------------------------------
# check_semantic_duplicate
# ---------------------------------------------------------------------------

def test_semantic_duplicate_hash_exato(monkeypatch):
    cursor = _patch_conn(monkeypatch, [
        ('chunk-9', 'doc-9', {'semantic_hash': 'sh-1', 'active': True}),
    ])

    result = dedup.check_semantic_duplicate('tenant-a', [1.0, 0.0, 0.0], 'sh-1')

    assert result['is_duplicate'] is True
    assert result['reason'] == 'semantic_hash_exact_duplicate'
    assert result['similarity'] == 1.0
    assert result['existing_chunk']['chunk_id'] == 'chunk-9'
    # Hash exato resolve na primeira query (com filtro de active)
    assert len(cursor.queries) == 1
    sql, params = cursor.queries[0]
    assert "metadata->>'semantic_hash'" in sql
    assert "COALESCE((metadata->>'active')::boolean, true)" in sql
    assert params == ('tenant-a', 'sh-1')


def test_semantic_duplicate_similaridade_alta(monkeypatch):
    cursor = _patch_conn(monkeypatch, [
        None,  # sem match exato de semantic_hash
        ('chunk-2', 'doc-2', {'source_id': 's2'}, 0.99),
    ])

    result = dedup.check_semantic_duplicate('tenant-a', [1.0, 0.0, 0.0], 'sh-x')

    assert result['is_duplicate'] is True
    assert result['reason'] == 'semantic_similarity_duplicate'
    assert result['similarity'] == pytest.approx(0.99)
    assert result['existing_chunk']['chunk_id'] == 'chunk-2'
    assert len(cursor.queries) == 2
    sql, params = cursor.queries[1]
    assert 'embedding <=> %s::vector' in sql
    assert "COALESCE((metadata->>'active')::boolean, true)" in sql
    # Vetor serializado como literal pgvector nas duas posições
    assert params[1] == 'tenant-a'
    assert params[0] == params[2]


def test_semantic_duplicate_abaixo_do_threshold(monkeypatch):
    _patch_conn(monkeypatch, [
        None,
        ('chunk-2', 'doc-2', {}, 0.5),
    ])

    result = dedup.check_semantic_duplicate('tenant-a', [1.0, 0.0, 0.0], 'sh-x')

    assert result['is_duplicate'] is False
    assert result['similarity'] == pytest.approx(0.5)


def test_semantic_duplicate_sem_chunks_no_banco(monkeypatch):
    _patch_conn(monkeypatch, [None, None])

    result = dedup.check_semantic_duplicate('tenant-a', [1.0, 0.0, 0.0], 'sh-x')

    assert result['is_duplicate'] is False
    assert result['similarity'] == 0.0


def test_semantic_duplicate_batch_hash_exato_sem_db(monkeypatch):
    """Duplicata exata contra chunk aceito no batch corrente (ainda não commitado)."""
    cursor = _patch_conn(monkeypatch, [])
    batch = [{
        'embedding': [1.0, 0.0, 0.0],
        'chunk_metadata': {'chunk_id': 'c-batch', 'document_id': 'doc-x', 'semantic_hash': 'sh-1'},
    }]

    result = dedup.check_semantic_duplicate(
        'tenant-a', [1.0, 0.0, 0.0], 'sh-1', batch_accepted=batch
    )

    assert result['is_duplicate'] is True
    assert result['reason'] == 'semantic_hash_exact_duplicate'
    assert result['similarity'] == 1.0
    assert result['existing_chunk']['chunk_id'] == 'c-batch'
    # Resolveu no batch: nenhuma query ao DB
    assert cursor.queries == []


def test_semantic_duplicate_batch_similaridade(monkeypatch):
    """Dedup intra-documento por similaridade contra o batch (DB sem match)."""
    _patch_conn(monkeypatch, [None, None])
    batch = [{
        'embedding': [0.9999, 0.01, 0.0],
        'chunk_metadata': {'chunk_id': 'c-batch', 'document_id': 'doc-x', 'semantic_hash': 'sh-outro'},
    }]

    result = dedup.check_semantic_duplicate(
        'tenant-a', [1.0, 0.0, 0.0], 'sh-novo', batch_accepted=batch
    )

    assert result['is_duplicate'] is True
    assert result['reason'] == 'semantic_similarity_duplicate'
    assert result['similarity'] > 0.97
    assert result['existing_chunk']['chunk_id'] == 'c-batch'


def test_semantic_duplicate_falha_db_propaga(monkeypatch):
    """Falha de DB NUNCA é tratada como 'não duplicado' (persistence_required)."""
    def _conn_quebrada():
        raise RuntimeError('Postgres DSN não configurado')

    monkeypatch.setattr(dedup, '_get_conn', _conn_quebrada)

    with pytest.raises(RuntimeError, match='Postgres DSN'):
        dedup.check_semantic_duplicate('tenant-a', [1.0, 0.0, 0.0], 'sh-x')

    with pytest.raises(RuntimeError, match='Postgres DSN'):
        dedup.check_structural_duplicate('tenant-a', 'abc')


# ---------------------------------------------------------------------------
# register_chunk (no-op de compatibilidade)
# ---------------------------------------------------------------------------

def test_register_chunk_noop_com_metadados_validos():
    metadata = {
        'chunk_id': 'c1',
        'document_id': 'd1',
        'source_id': 's1',
        'content_hash': 'ch',
        'semantic_hash': 'sh',
    }
    # Não persiste nada e não levanta erro
    dedup.register_chunk('tenant-a', metadata, [1.0, 0.0])


def test_register_chunk_valida_metadados_obrigatorios():
    with pytest.raises(ValueError, match='Metadados obrigatórios'):
        dedup.register_chunk('tenant-a', {'chunk_id': 'c1'})


# ---------------------------------------------------------------------------
# Versionamento (deactivate_previous_versions / get_current_source_version)
# ---------------------------------------------------------------------------

def test_deactivate_previous_versions_update_jsonb(monkeypatch):
    cursor = _patch_conn(monkeypatch, [], rowcount=3)

    dedup.deactivate_previous_versions('tenant-a', 's1', 2)

    assert len(cursor.queries) == 1
    sql, params = cursor.queries[0]
    assert "jsonb_set(metadata, '{active}', 'false'::jsonb)" in sql
    assert "metadata->>'source_id'" in sql
    assert "COALESCE((metadata->>'source_version')::int, 1) < %s" in sql
    assert params == ('tenant-a', 's1', 2)


def test_get_current_source_version_retorna_max(monkeypatch):
    _patch_conn(monkeypatch, [(3,)])
    assert dedup.get_current_source_version('tenant-a', 's1') == 3


def test_get_current_source_version_default_1_sem_linhas(monkeypatch):
    _patch_conn(monkeypatch, [])
    assert dedup.get_current_source_version('tenant-a', 's1') == 1


def test_get_current_source_version_default_1_com_null(monkeypatch):
    _patch_conn(monkeypatch, [(None,)])
    assert dedup.get_current_source_version('tenant-a', 's1') == 1


# ---------------------------------------------------------------------------
# get_deduplication_stats
# ---------------------------------------------------------------------------

def test_get_deduplication_stats(monkeypatch):
    cursor = _patch_conn(monkeypatch, [
        (10, 7, 3, 4, 2),  # total, ativos, inativos, content_hashes, sources
        (1,),              # sources com mais de uma versão
    ])

    stats = dedup.get_deduplication_stats('tenant-a')

    assert stats == {
        'total_content_hashes': 4,
        'total_chunks': 10,
        'active_chunks': 7,
        'inactive_chunks': 3,
        'total_sources': 2,
        'sources_with_multiple_versions': 1,
    }
    assert len(cursor.queries) == 2
    assert 'HAVING' in cursor.queries[1][0]
