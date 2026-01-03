"""
Serviço de armazenamento vetorial usando FAISS.
"""

import os
import json
import pickle
import numpy as np
from typing import List, Optional, Dict, Any
from pathlib import Path
import logging

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

from models.document import Chunk
from config.settings import get_settings

logger = logging.getLogger(__name__)

# Armazenamento em memória
_vector_stores: Dict[str, Any] = {}  # tenantId -> (index, metadata)
_chunks_metadata: Dict[str, Dict[str, Chunk]] = {}  # tenantId -> {chunkId: Chunk}


def get_vector_store_path(tenant_id: str) -> Path:
    """
    Retorna caminho do arquivo de índice para um tenant.
    
    Args:
        tenant_id: ID do tenant
    
    Returns:
        Path do arquivo
    """
    settings = get_settings()
    base_path = Path(settings.vector_store_path)
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path / f"{tenant_id}.index"


def get_metadata_path(tenant_id: str) -> Path:
    """
    Retorna caminho do arquivo de metadados para um tenant.
    
    Args:
        tenant_id: ID do tenant
    
    Returns:
        Path do arquivo
    """
    settings = get_settings()
    base_path = Path(settings.vector_store_path)
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path / f"{tenant_id}.metadata.json"


def get_vector_store(tenant_id: Optional[str] = None):
    """
    Retorna instância do vector store (singleton por tenant).
    
    Args:
        tenant_id: ID do tenant (opcional, usa default se None)
    
    Returns:
        Instância do VectorStore
    """
    if tenant_id is None:
        settings = get_settings()
        tenant_id = "default"
    
    if tenant_id not in _vector_stores:
        _vector_stores[tenant_id] = VectorStore(tenant_id)
    
    return _vector_stores[tenant_id]


class VectorStore:
    """Armazenamento vetorial usando FAISS."""
    
    def __init__(self, tenant_id: str):
        """
        Inicializa vector store para um tenant.
        
        Args:
            tenant_id: ID do tenant
        """
        self.tenant_id = tenant_id
        self.settings = get_settings()
        self.dimension = self.settings.embedding_dimension
        
        # Carrega ou cria índice
        self.index_path = get_vector_store_path(tenant_id)
        self.metadata_path = get_metadata_path(tenant_id)
        
        if FAISS_AVAILABLE:
            if self.index_path.exists():
                self.index = faiss.read_index(str(self.index_path))
            else:
                # Cria índice vazio
                self.index = faiss.IndexFlatL2(self.dimension)
        else:
            # Fallback: armazenamento em memória simples
            self.index = None
            self.vectors = []
        
        # Carrega metadados
        self.chunks: Dict[str, Chunk] = {}
        if self.metadata_path.exists():
            self._load_metadata()
        else:
            if tenant_id not in _chunks_metadata:
                _chunks_metadata[tenant_id] = {}
            self.chunks = _chunks_metadata[tenant_id]
    
    def _load_metadata(self):
        """Carrega metadados do arquivo."""
        try:
            with open(self.metadata_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for chunk_id, chunk_data in data.items():
                    # Reconstrói Chunk a partir do JSON
                    from models.document import Chunk, ChunkMetadata, DocumentPermissions
                    chunk = Chunk(
                        id=chunk_data['id'],
                        documentId=chunk_data['documentId'],
                        tenantId=chunk_data['tenantId'],
                        content=chunk_data['content'],
                        embedding=chunk_data.get('embedding'),
                        metadata=ChunkMetadata(**chunk_data['metadata']),
                        permissions=DocumentPermissions(**chunk_data['permissions'])
                    )
                    self.chunks[chunk_id] = chunk
        except Exception as e:
            logger.warning(f"Erro ao carregar metadados: {e}")
            self.chunks = {}
    
    def _save_metadata(self):
        """Salva metadados no arquivo."""
        try:
            data = {}
            for chunk_id, chunk in self.chunks.items():
                data[chunk_id] = {
                    'id': chunk.id,
                    'documentId': chunk.documentId,
                    'tenantId': chunk.tenantId,
                    'content': chunk.content,
                    'embedding': chunk.embedding,
                    'metadata': chunk.metadata.dict(),
                    'permissions': chunk.permissions.dict()
                }
            
            with open(self.metadata_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao salvar metadados: {e}")
    
    def add_chunks(self, chunks: List[Chunk], embeddings: List[List[float]]):
        """
        Adiciona chunks ao índice.
        
        Args:
            chunks: Lista de chunks
            embeddings: Lista de embeddings correspondentes
        """
        if not chunks or not embeddings:
            return
        
        if len(chunks) != len(embeddings):
            raise ValueError("Número de chunks e embeddings deve ser igual")
        
        # Converte embeddings para numpy array
        embeddings_array = np.array(embeddings, dtype=np.float32)
        
        if FAISS_AVAILABLE:
            # Adiciona ao índice FAISS
            self.index.add(embeddings_array)
        else:
            # Fallback: armazenamento em memória
            self.vectors.extend(embeddings)
        
        # Adiciona metadados
        for chunk, embedding in zip(chunks, embeddings):
            chunk.embedding = embedding
            self.chunks[chunk.id] = chunk
        
        # Salva
        self._save()
    
    def search(self, query_embedding: List[float], top_k: int = 5, filters: Optional[Dict] = None) -> List[Chunk]:
        """
        Busca chunks similares.
        
        Args:
            query_embedding: Embedding da query
            top_k: Número de resultados
            filters: Filtros opcionais (roles, agentId, productId, clientId)
        
        Returns:
            Lista de chunks ordenados por similaridade
        """
        if not self.chunks:
            return []
        
        query_array = np.array([query_embedding], dtype=np.float32)
        
        if FAISS_AVAILABLE:
            if self.index.ntotal == 0:
                return []
            
            # Busca no FAISS
            k = min(top_k * 2, self.index.ntotal)  # Busca mais para depois filtrar
            distances, indices = self.index.search(query_array, k)
            
            # Converte índices para chunks
            chunk_list = list(self.chunks.values())
            results = []
            for i, idx in enumerate(indices[0]):
                if idx < len(chunk_list):
                    chunk = chunk_list[idx]
                    chunk.score = float(1.0 / (1.0 + distances[0][i]))  # Converte distância para score
                    results.append(chunk)
        else:
            # Fallback: busca por similaridade de cosseno
            if not self.vectors:
                return []
            
            query_vec = np.array(query_embedding)
            scores = []
            chunk_list = list(self.chunks.values())
            
            for i, vec in enumerate(self.vectors):
                vec_array = np.array(vec)
                # Similaridade de cosseno
                score = np.dot(query_vec, vec_array) / (np.linalg.norm(query_vec) * np.linalg.norm(vec_array))
                scores.append((i, score))
            
            # Ordena por score
            scores.sort(key=lambda x: x[1], reverse=True)
            results = []
            for i, score in scores[:top_k * 2]:
                chunk = chunk_list[i]
                chunk.score = float(score)
                results.append(chunk)
        
        # Aplica filtros
        if filters:
            results = self._filter_chunks(results, filters)
        
        # Retorna top_k
        return results[:top_k]
    
    def _filter_chunks(self, chunks: List[Chunk], filters: Dict) -> List[Chunk]:
        """
        Filtra chunks por permissões e escopo.
        
        Args:
            chunks: Lista de chunks
            filters: Filtros (roles, agentId, productId, clientId)
        
        Returns:
            Lista de chunks filtrados
        """
        filtered = []
        
        for chunk in chunks:
            # Verifica roles
            if filters.get('roles') and chunk.permissions.roles:
                if not any(role in chunk.permissions.roles for role in filters['roles']):
                    continue
            
            # Verifica agentId específico
            if filters.get('agentId') and chunk.permissions.agents:
                if filters['agentId'] not in chunk.permissions.agents:
                    continue
            
            # Verifica productId
            # Nota: productId está no documento, não no chunk. Seria necessário carregar documento.
            # Por enquanto, pulamos essa verificação aqui (será feita no Node.js)
            
            # Verifica clientId
            # Similar ao productId
            
            filtered.append(chunk)
        
        return filtered
    
    def remove_document(self, document_id: str):
        """
        Remove todos os chunks de um documento.
        
        Args:
            document_id: ID do documento
        """
        # Encontra chunks do documento
        chunks_to_remove = [chunk_id for chunk_id, chunk in self.chunks.items() 
                           if chunk.documentId == document_id]
        
        if not chunks_to_remove:
            return
        
        # Remove do índice (FAISS não suporta remoção direta, precisa reconstruir)
        if FAISS_AVAILABLE:
            # Reconstrui índice sem os chunks removidos
            remaining_chunks = {k: v for k, v in self.chunks.items() if k not in chunks_to_remove}
            if remaining_chunks:
                # Reconstrói índice
                embeddings = [chunk.embedding for chunk in remaining_chunks.values() if chunk.embedding]
                if embeddings:
                    self.index = faiss.IndexFlatL2(self.dimension)
                    self.index.add(np.array(embeddings, dtype=np.float32))
            else:
                self.index = faiss.IndexFlatL2(self.dimension)
        else:
            # Remove do fallback
            indices_to_remove = [i for i, chunk_id in enumerate(list(self.chunks.keys())) 
                                if chunk_id in chunks_to_remove]
            for idx in sorted(indices_to_remove, reverse=True):
                del self.vectors[idx]
        
        # Remove metadados
        for chunk_id in chunks_to_remove:
            del self.chunks[chunk_id]
        
        self._save()
    
    def _save(self):
        """Salva índice e metadados."""
        if FAISS_AVAILABLE and self.index.ntotal > 0:
            faiss.write_index(self.index, str(self.index_path))
        
        self._save_metadata()
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Retorna estatísticas do índice.
        
        Returns:
            Dicionário com estatísticas
        """
        document_ids = set(chunk.documentId for chunk in self.chunks.values())
        
        return {
            "documentCount": len(document_ids),
            "chunkCount": len(self.chunks),
            "indexSize": self.index.ntotal if FAISS_AVAILABLE and self.index else len(self.vectors)
        }

