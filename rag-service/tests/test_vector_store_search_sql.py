"""
Testes do filtro de roles/agentId no SQL de `VectorStore.search` e do tuning
de sessão (`_get_conn` com hnsw.ef_search + fallback legado ivfflat.probes).

A camada de conexão (`_get_conn`/`psycopg2.connect`) é mockada, no padrão de
`test_deduplication_db.py`: o cursor fake registra as queries e devolve
resultados programados.
"""

import pytest

from services import vector_store
from services.vector_store import VectorStore


class _FakeCursor:
    """Cursor fake: registra queries e devolve linhas programadas (fetchall)."""

    def __init__(self, rows=None, fail_on_execute=False):
        self._rows = list(rows or [])
        self._fail = fail_on_execute
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if self._fail:
            raise RuntimeError('unrecognized configuration parameter')
        self.queries.append((' '.join(str(sql).split()), params))

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None


class _FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor
        self.rollback_calls = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor

    def rollback(self):
        self.rollback_calls += 1


def _make_store():
    return VectorStore('tenant-a')


def _embedding(store):
    return [0.0] * store.dimension


def _patch_conn(monkeypatch, rows=None):
    """Faz `_get_conn` retornar uma conexão fake e devolve o cursor para asserções."""
    cursor = _FakeCursor(rows)
    monkeypatch.setattr(vector_store, '_get_conn', lambda: _FakeConn(cursor))
    return cursor


# ---------------------------------------------------------------------------
# search: filtro de roles/agentId no SQL
# ---------------------------------------------------------------------------

def test_search_sem_identidade_aplica_acl_fail_closed_e_sensitivity(monkeypatch):
    cursor = _patch_conn(monkeypatch)
    store = _make_store()

    store.search(_embedding(store), top_k=5)

    assert len(cursor.queries) == 1
    sql, params = cursor.queries[0]
    assert "sensitivity = ANY(%s)" in sql
    assert "d.status = 'active'" in sql
    assert "COALESCE(d.index_status" in sql
    assert "= 'indexed'" in sql
    assert "permissions->'roles'" in sql
    assert "permissions->'agents'" in sql
    assert params == (
        params[0], 'tenant-a', 'OPERATIONAL', ['PRODUCTION'],
        ['PUBLIC', 'INTERNAL'], [], '', params[0], 5,
    )


def test_search_filtro_roles_no_sql(monkeypatch):
    cursor = _patch_conn(monkeypatch)
    store = _make_store()

    store.search(_embedding(store), top_k=5, filters={'roles': ['admin', 'agent']})

    sql, params = cursor.queries[0]
    # Sem restrição (roles ausente/vazio) continua visível; com restrição, exige interseção
    assert "permissions->'roles' IS NULL" in sql
    assert "permissions->'roles' = '[]'::jsonb" in sql
    assert "permissions->'roles' ?| %s" in sql
    # Params: qv, tenant, domain, classifications, sensitivities, roles,
    # agentId, qv, fetch_k
    assert params[5] == ['admin', 'agent']
    assert params[1] == 'tenant-a'
    # Com filtro no SQL não há descarte em Python: fetch_k = k
    assert params[-1] == 5


def test_search_filtro_agent_id_no_sql(monkeypatch):
    cursor = _patch_conn(monkeypatch)
    store = _make_store()

    store.search(_embedding(store), top_k=3, filters={'agentId': 'agent-001'})

    sql, params = cursor.queries[0]
    assert "permissions->'agents' IS NULL" in sql
    assert "permissions->'agents' = '[]'::jsonb" in sql
    assert "permissions->'agents' ? %s" in sql
    assert "permissions->'roles'" in sql
    assert params[6] == 'agent-001'
    assert params[-1] == 3


def test_search_roles_e_agent_id_combinados(monkeypatch):
    cursor = _patch_conn(monkeypatch)
    store = _make_store()

    store.search(_embedding(store), top_k=7, filters={'roles': ['admin'], 'agentId': 'agent-9'})

    sql, params = cursor.queries[0]
    assert "permissions->'roles' ?| %s" in sql
    assert "permissions->'agents' ? %s" in sql
    assert params[5] == ['admin']
    assert params[6] == 'agent-9'
    assert params[-1] == 7


def test_search_roles_string_coagida_para_lista(monkeypatch):
    cursor = _patch_conn(monkeypatch)
    store = _make_store()

    store.search(_embedding(store), top_k=5, filters={'roles': 'admin'})

    sql, params = cursor.queries[0]
    assert "permissions->'roles' ?| %s" in sql
    assert params[5] == ['admin']


def test_search_filtros_vazios_nao_liberam_documentos_restritos(monkeypatch):
    cursor = _patch_conn(monkeypatch)
    store = _make_store()

    store.search(_embedding(store), top_k=5, filters={'roles': [], 'agentId': ''})

    sql, params = cursor.queries[0]
    assert "permissions->'roles'" in sql
    assert "permissions->'agents'" in sql
    assert params[5] == []
    assert params[6] == ''
    assert params[-1] == 5


# ---------------------------------------------------------------------------
# _get_conn: tuning de sessão (hnsw.ef_search + fallback legado ivfflat.probes)
# ---------------------------------------------------------------------------

def test_get_conn_configura_hnsw_ef_search_e_fallback_ivfflat(monkeypatch):
    cursor = _FakeCursor()
    conn = _FakeConn(cursor)
    monkeypatch.setattr(vector_store.psycopg2, 'connect', lambda dsn: conn)
    monkeypatch.setattr(vector_store, 'get_settings', lambda: type('S', (), {'postgres_dsn': 'dsn'})())

    result = vector_store._get_conn()

    assert result is conn
    sets = [q for q in cursor.queries if q[0].startswith('SET ')]
    assert ('SET hnsw.ef_search = 40', None) in sets
    assert ('SET ivfflat.probes = 10', None) in sets


def test_get_conn_respeita_env_hnsw_ef_search(monkeypatch):
    cursor = _FakeCursor()
    monkeypatch.setattr(vector_store.psycopg2, 'connect', lambda dsn: _FakeConn(cursor))
    monkeypatch.setattr(vector_store, 'get_settings', lambda: type('S', (), {'postgres_dsn': 'dsn'})())
    monkeypatch.setenv('RAG_HNSW_EF_SEARCH', '80')

    vector_store._get_conn()

    assert ('SET hnsw.ef_search = 80', None) in [q for q in cursor.queries if q[0].startswith('SET ')]


def test_resolve_hnsw_ef_search_coercao_defensiva(monkeypatch):
    monkeypatch.setenv('RAG_HNSW_EF_SEARCH', '0')
    assert vector_store._resolve_hnsw_ef_search() == 40
    monkeypatch.setenv('RAG_HNSW_EF_SEARCH', 'abc')
    assert vector_store._resolve_hnsw_ef_search() == 40
    monkeypatch.setenv('RAG_HNSW_EF_SEARCH', '1')
    assert vector_store._resolve_hnsw_ef_search() == 1


def test_get_conn_tolera_set_nao_suportado(monkeypatch):
    """SET de parâmetro inexistente (pgvector antigo) não derruba a operação."""
    cursor = _FakeCursor(fail_on_execute=True)
    conn = _FakeConn(cursor)
    monkeypatch.setattr(vector_store.psycopg2, 'connect', lambda dsn: conn)
    monkeypatch.setattr(vector_store, 'get_settings', lambda: type('S', (), {'postgres_dsn': 'dsn'})())

    result = vector_store._get_conn()

    assert result is conn
    # rollback limpa a transação abortada após cada SET falho
    assert conn.rollback_calls == 2
