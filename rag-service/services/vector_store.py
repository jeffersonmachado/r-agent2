"""
Vector Store (PostgreSQL + pgvector).

Este módulo usa Postgres como fonte única para embeddings e chunks (`rag_chunks`).
"""

from typing import List, Optional, Dict, Any
import logging
import json

import psycopg2
from psycopg2.extras import execute_values

from models.document import Chunk, ChunkMetadata, DocumentPermissions
from services.domain_policy import resolve_query_scope, resolve_scope_tenant_keys
from services.hybrid_search import ALGORITHM_VERSION, fuse_with_fallback
from config.settings import get_settings

logger = logging.getLogger(__name__)

_vector_stores: Dict[str, Any] = {}  # tenantId -> VectorStore singleton


def normalize_tenant_id(tenant_id: Optional[str]) -> str:
    if tenant_id is None:
        return "default"
    try:
        tid = str(tenant_id).strip()
    except Exception:
        return "default"
    return tid or "default"


def _resolve_embedding_dim() -> int:
    settings = get_settings()
    # Permite override via env (compatível com o Node/migrations)
    import os
    raw = os.getenv("EMBEDDING_DIM") or os.getenv("RAG_EMBEDDING_DIM")
    if raw:
        try:
            dim = int(str(raw))
            if dim > 0:
                return dim
        except Exception:
            pass
    try:
        return int(settings.embedding_dimension)
    except Exception:
        return 384


def _pgvector_literal(vec: List[float]) -> str:
    # pgvector aceita string "[1,2,3]"
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


_SESSION_TUNING_LOGGED = False


def _resolve_hnsw_ef_search() -> int:
    """
    ef_search do índice HNSW (knob atual de recall, pgvector >= 0.5).
    Default do pgvector é 40, que já é razoável. Configurável via
    RAG_HNSW_EF_SEARCH (mínimo 1, coerção defensiva).
    """
    import os
    raw = os.getenv("RAG_HNSW_EF_SEARCH")
    if raw:
        try:
            ef_search = int(str(raw).strip())
            if ef_search >= 1:
                return ef_search
        except Exception:
            pass
    return 40


def _resolve_ivfflat_probes() -> int:
    """
    LEGADO: número de probes do índice ivfflat (lists=100). Mantido apenas como
    fallback enquanto o índice ivfflat existir — a migration
    20260803000002-rag-chunks-hnsw-index.js substitui ivfflat por HNSW e o knob
    passa a ser hnsw.ef_search. Configurável via RAG_IVFFLAT_PROBES (mínimo 1).
    """
    import os
    raw = os.getenv("RAG_IVFFLAT_PROBES")
    if raw:
        try:
            probes = int(str(raw).strip())
            if probes >= 1:
                return probes
        except Exception:
            pass
    return 10


def _build_access_filters(tenant_keys, resolved_scope, filters=None):
    """
    Cláusulas de ACESSO + parâmetros, compartilhadas por TODAS as modalidades de
    recuperação (semântica, lexical e futuras).

    Fonte única de propósito (FASE 7): se a busca lexical montasse o próprio
    filtro, uma mudança de política poderia valer só para uma modalidade e o
    resultado seria vazamento entre tenants/domínios — o tipo de defeito que não
    aparece em teste feliz.
    """
    filters = filters or {}
    roles = filters.get("roles")
    if isinstance(roles, str):
        roles = [roles]
    roles = [str(r) for r in (roles or []) if str(r).strip()] if isinstance(roles, (list, tuple)) else []
    agent_id = str(filters.get("agentId")).strip() if filters.get("agentId") else ""

    where_clauses = [
        "c.tenant_key = ANY(%s)",
        "c.domain = %s",
        "c.classification = ANY(%s)",
        "c.sensitivity = ANY(%s)",
        "(c.permissions->'roles' IS NULL OR c.permissions->'roles' = 'null'::jsonb"
        " OR c.permissions->'roles' = '[]'::jsonb OR c.permissions->'roles' ?| %s)",
        "(c.permissions->'agents' IS NULL OR c.permissions->'agents' = 'null'::jsonb"
        " OR c.permissions->'agents' = '[]'::jsonb OR c.permissions->'agents' ? %s)",
        "EXISTS (SELECT 1 FROM rag_documents d"
        " WHERE d.id = c.document_id AND d.tenant_key = c.tenant_key AND d.status = 'active'"
        " AND COALESCE(d.index_status, CASE WHEN d.indexed THEN 'indexed' ELSE 'pending' END) = 'indexed')",
    ]
    params: List[Any] = [
        tenant_keys,
        resolved_scope["domain"],
        resolved_scope["classifications"],
        resolved_scope["sensitivities"],
        roles,
        agent_id,
    ]
    return where_clauses, params


def _row_to_chunk(tenant_id: str, row, score: Optional[float]) -> Chunk:
    """
    Mapeia uma linha do SELECT (id, document_id, chunk_index, content, metadata,
    permissions, domain, classification, sensitivity, <score>) para `Chunk`.

    Compartilhado por TODAS as modalidades: semântica, lexical e híbrida. Era
    inline na busca vetorial; duplicá-lo na lexical faria os campos de um dos
    caminhos divergirem em silêncio.
    """
    (chunk_id, document_id, chunk_index, content, metadata, permissions,
     domain, classification, sensitivity, _last) = row

    meta_obj = metadata or {}
    perm_obj = permissions or {}
    try:
        if isinstance(meta_obj, str):
            meta_obj = json.loads(meta_obj)
    except Exception:
        meta_obj = {}
    try:
        if isinstance(perm_obj, str):
            perm_obj = json.loads(perm_obj)
    except Exception:
        perm_obj = {}

    # Garante campos obrigatórios do ChunkMetadata
    base_meta = {
        "chunkIndex": int(chunk_index or 0),
        "startChar": 0,
        "endChar": 0,
        "tokenCount": 0,
    }
    if isinstance(meta_obj, dict):
        base_meta.update(meta_obj)
    meta_obj = base_meta

    return Chunk(
        id=str(chunk_id),
        documentId=str(document_id),
        tenantId=tenant_id,
        content=str(content or ""),
        embedding=None,
        metadata=ChunkMetadata(**meta_obj),
        permissions=DocumentPermissions(**perm_obj) if isinstance(perm_obj, dict) else DocumentPermissions(),
        score=score,
        domain=str(domain or "OPERATIONAL"),
        classification=str(classification or "PRODUCTION"),
        sensitivity=str(sensitivity or "INTERNAL"),
    )


def _get_conn():
    global _SESSION_TUNING_LOGGED
    settings = get_settings()
    dsn = settings.postgres_dsn
    if not dsn:
        raise RuntimeError("Postgres DSN não configurado. Defina DATABASE_URL (recomendado) ou PGHOST/PGUSER/PGDATABASE.")
    conn = psycopg2.connect(dsn)
    # Conexões são por operação: SET de sessão cobre search + dedup.
    # hnsw.ef_search é o knob atual; ivfflat.probes é legado (inócuo sem índice
    # ivfflat). SET de parâmetro inexistente (pgvector antigo) é tolerado com
    # warn — nunca derruba a operação.
    ef_search = _resolve_hnsw_ef_search()
    probes = _resolve_ivfflat_probes()
    with conn.cursor() as cur:
        for param, value in (("hnsw.ef_search", ef_search), ("ivfflat.probes", probes)):
            try:
                cur.execute(f"SET {param} = {value}")
            except Exception as exc:
                # SET falho aborta a transação implícita do psycopg2; rollback
                # limpa o estado para as queries seguintes da sessão.
                conn.rollback()
                logger.warning(
                    "[VectorStore] SET %s falhou (pgvector sem suporte?); seguindo sem esse tuning",
                    param,
                    extra={"error": str(exc)},
                )
    if not _SESSION_TUNING_LOGGED:
        _SESSION_TUNING_LOGGED = True
        logger.debug(
            "[VectorStore] tuning de sessão configurado",
            extra={"hnswEfSearch": ef_search, "ivfflatProbesLegacy": probes},
        )
    return conn


def get_vector_store(tenant_id: Optional[str] = None):
    tenant_id = normalize_tenant_id(tenant_id)
    if tenant_id not in _vector_stores:
        _vector_stores[tenant_id] = VectorStore(tenant_id)
    return _vector_stores[tenant_id]


class VectorStore:
    """
    Vector store usando pgvector (tabela rag_chunks).
    """

    def __init__(self, tenant_id: str):
        self.tenant_id = normalize_tenant_id(tenant_id)
        self.dimension = _resolve_embedding_dim()
        logger.info("[VectorStore] Inicializado (pgvector)", extra={
            "tenantId": self.tenant_id,
            "embeddingDimension": self.dimension,
        })

    def add_chunks(self, chunks: List[Chunk], embeddings: List[List[float]]) -> int:
        if not chunks or not embeddings:
            return 0
        if len(chunks) != len(embeddings):
            raise ValueError(f"Número de chunks ({len(chunks)}) e embeddings ({len(embeddings)}) deve ser igual")

        # valida dimensão
        for emb in embeddings:
            if not isinstance(emb, list) or len(emb) != self.dimension:
                raise ValueError(f"EMBEDDING_DIM_MISMATCH: esperado {self.dimension}, recebido {len(emb) if isinstance(emb, list) else 'invalid'}")

        # assumimos 1 documento por chamada (fluxo do /rag/index)
        doc_id = str(chunks[0].documentId)
        for c in chunks:
            if str(c.documentId) != doc_id:
                raise ValueError("add_chunks deve receber chunks de um único documentId")

        rows = []
        for c, emb in zip(chunks, embeddings):
            # chunk_index vem do metadata.chunkIndex (fallback: 0)
            chunk_index = getattr(c.metadata, "chunkIndex", 0) if c.metadata else 0
            rows.append((
                str(c.id),
                self.tenant_id,
                doc_id,
                int(chunk_index) if chunk_index is not None else 0,
                str(c.content or ""),
                _pgvector_literal(emb),
                json.dumps(c.metadata.dict() if c.metadata else {}),
                json.dumps(c.permissions.dict() if c.permissions else {}),
                str(getattr(c, "domain", "OPERATIONAL") or "OPERATIONAL"),
                str(getattr(c, "classification", "PRODUCTION") or "PRODUCTION"),
                str(getattr(c, "sensitivity", "INTERNAL") or "INTERNAL"),
            ))

        doc_domain = str(getattr(chunks[0], "domain", "OPERATIONAL") or "OPERATIONAL")
        doc_classification = str(getattr(chunks[0], "classification", "PRODUCTION") or "PRODUCTION")
        doc_sensitivity = str(getattr(chunks[0], "sensitivity", "INTERNAL") or "INTERNAL")

        with _get_conn() as conn:
            with conn.cursor() as cur:
                # Garante linha pai em rag_documents para satisfazer FK de rag_chunks.
                # Em fluxos de teste o documento pode não ter sido persistido antes.
                cur.execute(
                    """
                    INSERT INTO rag_documents
                      (id, tenant_key, title, content, metadata, permissions, status, indexed, indexed_at, chunks_count, created_at, updated_at, domain, classification, sensitivity, index_status)
                    VALUES
                      (%s, %s, %s, %s, '{}'::jsonb, '{}'::jsonb, 'active', true, NOW(), %s, NOW(), NOW(), %s, %s, %s, 'indexed')
                    ON CONFLICT (id) DO UPDATE SET
                      status = EXCLUDED.status,
                      indexed = true,
                      index_status = 'indexed',
                      indexed_at = NOW(),
                      chunks_count = EXCLUDED.chunks_count,
                      updated_at = NOW(),
                      domain = EXCLUDED.domain,
                      classification = EXCLUDED.classification,
                      sensitivity = EXCLUDED.sensitivity
                    WHERE rag_documents.tenant_key = EXCLUDED.tenant_key
                    """,
                    (doc_id, self.tenant_id, doc_id, "", len(rows), doc_domain, doc_classification, doc_sensitivity),
                )
                if cur.rowcount == 0:
                    raise PermissionError("document_id pertence a outro tenant")

                # reindex consistente: remove chunks antigos do documento e reinsere
                cur.execute(
                    "DELETE FROM rag_chunks WHERE tenant_key = %s AND document_id = %s",
                    (self.tenant_id, doc_id)
                )

                execute_values(
                    cur,
                    """
                    INSERT INTO rag_chunks
                      (id, tenant_key, document_id, chunk_index, content, embedding, metadata, permissions, created_at, domain, classification, sensitivity)
                    VALUES %s
                    """,
                    rows,
                    template="(%s,%s,%s,%s,%s,(%s)::vector,(%s)::jsonb,(%s)::jsonb,NOW(),%s,%s,%s)"
                )
        return len(rows)

    def search(self, query_embedding: List[float], top_k: int = 5, filters: Optional[Dict] = None, scope: Optional[Dict] = None) -> List[Chunk]:
        if not query_embedding or not isinstance(query_embedding, list):
            return []
        if len(query_embedding) != self.dimension:
            raise ValueError(f"EMBEDDING_DIM_MISMATCH: esperado {self.dimension}, recebido {len(query_embedding)}")

        # Escopo obrigatório de segregação: tenant + domain + classification são
        # filtrados no SQL ANTES da busca por similaridade. Sem escopo explícito,
        # aplica o mais restritivo (OPERATIONAL/PRODUCTION).
        resolved_scope = resolve_query_scope(scope)

        # Conhecimento operacional GLOBAL ∪ TENANT_OPERATIONAL: as chaves são
        # DERIVADAS do tenant do request + domínio (payload nunca amplia). No
        # domínio SYSTEM a lista contém apenas o tenant atual.
        tenant_keys = resolve_scope_tenant_keys(scope, self.tenant_id)
        if not tenant_keys:
            return []

        k = max(1, min(int(top_k or 5), 50))
        qv = _pgvector_literal(query_embedding)

        # Filtros de roles/agentId aplicados no SQL (sobre o JSONB permissions),
        # reproduzindo a semântica histórica do filtro em Python: chunk sem
        # restrição (permissions vazio/ausente, ou roles/agents ausente/vazio)
        # é visível para todos; com restrição, exige interseção.
        #
        # A construção vive em `_build_access_filters` para ser a MESMA em todas
        # as modalidades de recuperação (semântica/lexical/híbrida).
        where_clauses, params = _build_access_filters(tenant_keys, resolved_scope, filters)
        params = [qv, *params]

        # ACL e sensitivity são sempre aplicadas no SQL; não existe modo de
        # recuperação sem filtro de autorização.
        fetch_k = k
        params.extend([qv, fetch_k])

        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT id, document_id, chunk_index, content, metadata, permissions,
                           domain, classification, sensitivity,
                           (embedding <=> (%s)::vector) AS distance
                    FROM rag_chunks c
                    WHERE {' AND '.join(where_clauses)}
                    ORDER BY c.embedding <=> (%s)::vector
                    LIMIT %s
                    """,
                    tuple(params)
                )
                rows = cur.fetchall()

        results: List[Chunk] = []
        for row in rows:
            distance = row[9]
            try:
                score = max(0.0, 1.0 - float(distance))
            except Exception:
                score = 0.0
            results.append(_row_to_chunk(self.tenant_id, row, score))

        return results[:k]

    # ----------------------------------------------------------------------
    # Recuperação LEXICAL e HÍBRIDA (FASE 5)
    # ----------------------------------------------------------------------

    def lexical_search(
        self,
        query_text: str,
        top_k: int = 5,
        filters: Optional[Dict] = None,
        scope: Optional[Dict] = None,
        text_config: str = "portuguese",
    ) -> List[Chunk]:
        """
        Busca lexical (PostgreSQL FTS) sobre o MESMO universo autorizado.

        Existe porque o vetorial perde correspondência EXATA: identificador,
        sigla, nome de função ou termo técnico presente no corpus pode não
        aparecer no top-k por similaridade de embedding. O filtro de acesso é o
        mesmo `_build_access_filters` da busca semântica — sem exceção.
        """
        resolved_scope = resolve_query_scope(scope)
        tenant_keys = resolve_scope_tenant_keys(scope, self.tenant_id)
        if not tenant_keys:
            return []

        k = max(1, min(int(top_k or 5), 50))
        where_clauses, params = _build_access_filters(tenant_keys, resolved_scope, filters)

        # tsquery por OR de lexemas, não AND de termos.
        #
        # MEDIDO (benchmark A/B/C, 2026-10-08): `websearch_to_tsquery` sobre uma
        # PERGUNTA em linguagem natural vira uma conjunção — o chunk só casa se
        # contiver TODOS os termos da pergunta, o que praticamente nunca acontece
        # em chunks curtos. Resultado: recall@6 = 0.125 (pior que o vetorial) e
        # fusão sem efeito. Para servir de CANDIDATO na fusão, o léxico precisa
        # ser orientado a RECALL: qualquer lexema casa e o `ts_rank_cd` ordena.
        sql = f"""
            WITH termos AS (
                SELECT to_tsquery('{text_config}',
                                  string_agg(DISTINCT lexeme, ' | ')) AS query
                  FROM unnest(to_tsvector('{text_config}', %s)) AS t(lexeme, positions, weights)
                 WHERE length(lexeme) > 2
            )
            SELECT id, document_id, chunk_index, content, metadata, permissions,
                   domain, classification, sensitivity,
                   ts_rank_cd(to_tsvector('{text_config}', c.content), termos.query) AS rank
            FROM rag_chunks c, termos
            WHERE {' AND '.join(where_clauses)}
              AND termos.query IS NOT NULL
              AND to_tsvector('{text_config}', c.content) @@ termos.query
            ORDER BY rank DESC, c.id ASC
            LIMIT %s
        """
        exec_params = [query_text, *params, k]

        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(exec_params))
                rows = cur.fetchall()

        results: List[Chunk] = []
        for row in rows:
            try:
                lexical_score = float(row[9])
            except Exception:
                lexical_score = 0.0
            # `score` do Chunk permanece o score da estratégia em vigor; o rank
            # textual cru vai em `metadata.hybrid.lexicalScore` (escala própria,
            # nunca misturado ao cosseno).
            results.append(_row_to_chunk(self.tenant_id, row, lexical_score))
        return results[:k]

    def search_hybrid(
        self,
        query_text: str,
        query_embedding: List[float],
        top_k: int = 5,
        filters: Optional[Dict] = None,
        scope: Optional[Dict] = None,
        candidates: Optional[int] = None,
        rrf_k: Optional[int] = None,
        weight_semantic: Optional[float] = None,
        weight_lexical: Optional[float] = None,
        text_config: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fusão semântica + lexical por RRF, com fallback DECLARADO.

        Cada modalidade recupera seus próprios candidatos sob o MESMO filtro de
        acesso; a fusão é por POSIÇÃO (RRF), nunca por média de scores de escalas
        diferentes. Falha de uma modalidade não derruba a outra: o resultado sai
        com `degraded=true` e o motivo.
        """
        settings = get_settings()
        k = max(1, min(int(top_k or 5), 50))
        pool = max(k, int(candidates or getattr(settings, "hybrid_candidates", 30) or 30))
        resolved_rrf_k = int(rrf_k if rrf_k is not None else getattr(settings, "hybrid_rrf_k", 60))
        w_sem = float(weight_semantic if weight_semantic is not None else getattr(settings, "hybrid_weight_semantic", 0.60))
        w_lex = float(weight_lexical if weight_lexical is not None else getattr(settings, "hybrid_weight_lexical", 0.40))
        config = text_config or getattr(settings, "hybrid_text_config", "portuguese")

        semantic_rows: List[Chunk] = []
        lexical_rows: List[Chunk] = []
        semantic_error = None
        lexical_error = None

        try:
            semantic_rows = self.search(query_embedding, top_k=pool, filters=filters, scope=scope)
        except Exception as error:  # noqa: BLE001 - degradação declarada, não silenciosa
            semantic_error = str(error)

        if query_text and str(query_text).strip():
            try:
                lexical_rows = self.lexical_search(query_text, top_k=pool, filters=filters, scope=scope, text_config=config)
            except Exception as error:  # noqa: BLE001
                lexical_error = str(error)
        else:
            lexical_error = "query_text_ausente"

        by_id: Dict[str, Chunk] = {}
        for chunk in [*semantic_rows, *lexical_rows]:
            by_id.setdefault(str(chunk.id), chunk)

        fused = fuse_with_fallback(
            [{"id": str(c.id), "score": c.score} for c in semantic_rows],
            [{"id": str(c.id), "score": c.score} for c in lexical_rows],
            semantic_error=semantic_error,
            lexical_error=lexical_error,
            k=resolved_rrf_k,
            weight_semantic=w_sem,
            weight_lexical=w_lex,
            top_k=k,
        )

        chunks: List[Chunk] = []
        for entry in fused["results"]:
            chunk = by_id.get(entry["id"])
            if chunk is None:
                continue
            chunk.metadata.hybrid = {
                "rank": entry["rank"],
                "rrfScore": entry["rrfScore"],
                "semanticRank": entry["semanticRank"],
                "semanticScore": entry["semanticScore"],
                "lexicalRank": entry["lexicalRank"],
                "lexicalScore": entry["lexicalScore"],
                "matchedBy": entry["matchedBy"],
                "strategy": "hybrid",
                "algorithmVersion": entry["algorithmVersion"],
                "rrfK": entry["rrfK"],
                "weights": entry["weights"],
            }
            # Score exposto do chunk: o RRF é comparável apenas dentro desta
            # fusão; mantemos o score semântico quando existir (compatibilidade
            # com consumidores que aplicam minScore) e o lexical na explicação.
            if entry["semanticScore"] is not None:
                chunk.score = entry["semanticScore"]
            chunks.append(chunk)

        return {
            "chunks": chunks,
            "strategy": "hybrid",
            "algorithmVersion": ALGORITHM_VERSION,
            "rrfK": resolved_rrf_k,
            "weights": {"semantic": w_sem, "lexical": w_lex},
            "candidatesPerModality": pool,
            "semanticFound": len(semantic_rows),
            "lexicalFound": len(lexical_rows),
            "degraded": fused["degraded"],
            "degradationReasons": fused["degradationReasons"],
        }

    def remove_document(self, document_id: str) -> int:
        """
        Remove um documento do índice: apaga os chunks e desativa o documento.

        Desativar `rag_documents.status` (além de apagar os chunks) garante que
        o documento não volte a ser elegível caso um chunk órfão sobreviva —
        a busca vetorial exige `d.status = 'active'` E o chunk existir.
        Escopo sempre por tenant: nunca remove nada de outro tenant.
        """
        if not document_id:
            return 0
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM rag_chunks WHERE tenant_key = %s AND document_id = %s",
                    (self.tenant_id, str(document_id))
                )
                removed = cur.rowcount or 0
                cur.execute(
                    "UPDATE rag_documents SET status = 'inactive'"
                    " WHERE tenant_key = %s AND id = %s",
                    (self.tenant_id, str(document_id)),
                )
                return removed

    def get_stats(self) -> Dict[str, Any]:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*)::int FROM rag_chunks WHERE tenant_key = %s", (self.tenant_id,))
                chunk_count = int(cur.fetchone()[0])
                cur.execute("SELECT COUNT(DISTINCT document_id)::int FROM rag_chunks WHERE tenant_key = %s", (self.tenant_id,))
                doc_count = int(cur.fetchone()[0])
        return {
            "documentCount": doc_count,
            "chunkCount": chunk_count,
            "indexSize": chunk_count,
            "vectorStore": "postgres",
            "embeddingDimension": self.dimension,
        }
