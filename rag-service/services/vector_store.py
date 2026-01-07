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
    
    # Se o caminho é relativo, torna absoluto relativo ao diretório do serviço RAG
    if not base_path.is_absolute():
        # Tenta encontrar o diretório do serviço RAG
        service_dir = Path(__file__).parent.parent
        base_path = (service_dir / base_path).resolve()
    
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
    
    # Se o caminho é relativo, torna absoluto relativo ao diretório do serviço RAG
    if not base_path.is_absolute():
        # Tenta encontrar o diretório do serviço RAG
        service_dir = Path(__file__).parent.parent
        base_path = (service_dir / base_path).resolve()
    
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
        
        logger.info(f"[VectorStore] Inicializando vector store", {
            'tenantId': tenant_id,
            'indexPath': str(self.index_path),
            'metadataPath': str(self.metadata_path),
            'indexExists': self.index_path.exists(),
            'metadataExists': self.metadata_path.exists(),
            'faissAvailable': FAISS_AVAILABLE
        })
        
        if FAISS_AVAILABLE:
            if self.index_path.exists():
                logger.info(f"[VectorStore] Carregando índice FAISS existente", {
                    'tenantId': tenant_id,
                    'indexPath': str(self.index_path)
                })
                self.index = faiss.read_index(str(self.index_path))
                logger.info(f"[VectorStore] Índice FAISS carregado", {
                    'tenantId': tenant_id,
                    'indexSize': self.index.ntotal,
                    'dimension': self.index.d
                })
            else:
                # Cria índice vazio
                logger.info(f"[VectorStore] Criando novo índice FAISS vazio", {
                    'tenantId': tenant_id,
                    'dimension': self.dimension
                })
                self.index = faiss.IndexFlatL2(self.dimension)
        else:
            # Fallback: armazenamento em memória simples
            logger.info(f"[VectorStore] FAISS não disponível, usando fallback", {
                'tenantId': tenant_id
            })
            self.index = None
            self.vectors = []
        
        # Carrega metadados
        self.chunks: Dict[str, Chunk] = {}
        if self.metadata_path.exists():
            logger.info(f"[VectorStore] Arquivo de metadados existe, carregando", {
                'tenantId': tenant_id,
                'metadataPath': str(self.metadata_path)
            })
            self._load_metadata()
        else:
            logger.info(f"[VectorStore] Arquivo de metadados não existe, usando memória", {
                'tenantId': tenant_id
            })
            if tenant_id not in _chunks_metadata:
                _chunks_metadata[tenant_id] = {}
            self.chunks = _chunks_metadata[tenant_id]
        
        logger.info(f"[VectorStore] Vector store inicializado", {
            'tenantId': tenant_id,
            'chunksInMemory': len(self.chunks),
            'indexSize': self.index.ntotal if FAISS_AVAILABLE and self.index else (len(self.vectors) if not FAISS_AVAILABLE else 0)
        })
    
    def _load_metadata(self):
        """Carrega metadados do arquivo."""
        try:
            logger.info(f"[VectorStore] Carregando metadados do arquivo", {
                'tenantId': self.tenant_id,
                'metadataPath': str(self.metadata_path),
                'fileExists': self.metadata_path.exists()
            })
            
            with open(self.metadata_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            logger.info(f"[VectorStore] Metadados carregados do arquivo", {
                'tenantId': self.tenant_id,
                'chunksInFile': len(data),
                'metadataPath': str(self.metadata_path)
            })
            
            # Se FAISS não está disponível, precisa carregar vetores também
            if not FAISS_AVAILABLE:
                self.vectors = []
            
            chunks_loaded = 0
            document_ids = set()
            
            for chunk_id, chunk_data in data.items():
                try:
                    # Reconstrói Chunk a partir do JSON
                    from models.document import Chunk, ChunkMetadata, DocumentPermissions
                    embedding = chunk_data.get('embedding')
                    chunk = Chunk(
                        id=chunk_data['id'],
                        documentId=chunk_data['documentId'],
                        tenantId=chunk_data['tenantId'],
                        content=chunk_data['content'],
                        embedding=embedding,
                        metadata=ChunkMetadata(**chunk_data['metadata']),
                        permissions=DocumentPermissions(**chunk_data['permissions'])
                    )
                    self.chunks[chunk_id] = chunk
                    document_ids.add(chunk.documentId)
                    chunks_loaded += 1
                    
                    # Se FAISS não está disponível, adiciona embedding aos vetores
                    if not FAISS_AVAILABLE and embedding:
                        self.vectors.append(embedding)
                except Exception as e:
                    logger.warning(f"[VectorStore] Erro ao carregar chunk {chunk_id}", {
                        'tenantId': self.tenant_id,
                        'chunkId': chunk_id,
                        'error': str(e)
                    })
                    continue
            
            logger.info(f"[VectorStore] Metadados carregados com sucesso", {
                'tenantId': self.tenant_id,
                'chunksLoaded': chunks_loaded,
                'chunksInFile': len(data),
                'documentCount': len(document_ids),
                'chunksInMemory': len(self.chunks)
            })
        except Exception as e:
            logger.error(f"[VectorStore] Erro ao carregar metadados", {
                'tenantId': self.tenant_id,
                'metadataPath': str(self.metadata_path),
                'error': str(e),
                'errorType': type(e).__name__
            })
            self.chunks = {}
            if not FAISS_AVAILABLE:
                self.vectors = []
    
    def _save_metadata(self):
        """Salva metadados no arquivo."""
        try:
            logger.debug(f"[VectorStore] Preparando metadados para salvar", {
                'tenantId': self.tenant_id,
                'chunksCount': len(self.chunks),
                'metadataPath': str(self.metadata_path)
            })
            
            data = {}
            document_ids = set()
            for chunk_id, chunk in self.chunks.items():
                document_ids.add(chunk.documentId)
                data[chunk_id] = {
                    'id': chunk.id,
                    'documentId': chunk.documentId,
                    'tenantId': chunk.tenantId,
                    'content': chunk.content,
                    'embedding': chunk.embedding,
                    'metadata': chunk.metadata.dict(),
                    'permissions': chunk.permissions.dict()
                }
            
            logger.info(f"[VectorStore] Salvando {len(data)} chunks de {len(document_ids)} documentos", {
                'tenantId': self.tenant_id,
                'chunksCount': len(data),
                'documentIds': list(document_ids),
                'metadataPath': str(self.metadata_path)
            })
            
            # Garante que o diretório existe
            self.metadata_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(self.metadata_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            # Verifica se o arquivo foi salvo
            if self.metadata_path.exists():
                file_size = self.metadata_path.stat().st_size
                logger.info(f"[VectorStore] Metadados salvos com sucesso", {
                    'tenantId': self.tenant_id,
                    'metadataPath': str(self.metadata_path),
                    'fileSize': file_size,
                    'chunksCount': len(data),
                    'documentCount': len(document_ids)
                })
            else:
                logger.error(f"[VectorStore] Arquivo de metadados não foi criado", {
                    'tenantId': self.tenant_id,
                    'metadataPath': str(self.metadata_path)
                })
        except Exception as e:
            logger.error(f"[VectorStore] Erro ao salvar metadados", {
                'tenantId': self.tenant_id,
                'error': str(e),
                'errorType': type(e).__name__,
                'metadataPath': str(self.metadata_path),
                'chunksCount': len(self.chunks)
            })
            raise
    
    def add_chunks(self, chunks: List[Chunk], embeddings: List[List[float]]):
        """
        Adiciona chunks ao índice.
        
        Args:
            chunks: Lista de chunks
            embeddings: Lista de embeddings correspondentes
        """
        logger.info(f"[VectorStore] add_chunks chamado", {
            'tenantId': self.tenant_id,
            'chunksCount': len(chunks) if chunks else 0,
            'embeddingsCount': len(embeddings) if embeddings else 0,
            'chunksBefore': len(self.chunks),
            'indexSizeBefore': self.index.ntotal if FAISS_AVAILABLE and self.index else len(self.vectors)
        })
        
        if not chunks or not embeddings:
            logger.warning(f"[VectorStore] Chunks ou embeddings vazios", {
                'tenantId': self.tenant_id,
                'chunks': chunks is not None,
                'embeddings': embeddings is not None
            })
            return
        
        if len(chunks) != len(embeddings):
            error_msg = f"Número de chunks ({len(chunks)}) e embeddings ({len(embeddings)}) deve ser igual"
            logger.error(f"[VectorStore] {error_msg}", {
                'tenantId': self.tenant_id,
                'chunksCount': len(chunks),
                'embeddingsCount': len(embeddings)
            })
            raise ValueError(error_msg)
        
        # Converte embeddings para numpy array
        embeddings_array = np.array(embeddings, dtype=np.float32)
        logger.info(f"[VectorStore] Embeddings convertidos para numpy array", {
            'tenantId': self.tenant_id,
            'embeddingsShape': embeddings_array.shape,
            'embeddingsDtype': embeddings_array.dtype
        })
        
        if FAISS_AVAILABLE:
            # Adiciona ao índice FAISS
            index_size_before = self.index.ntotal
            logger.info(f"[VectorStore] Adicionando ao índice FAISS", {
                'tenantId': self.tenant_id,
                'indexSizeBefore': index_size_before,
                'embeddingsToAdd': len(embeddings_array)
            })
            self.index.add(embeddings_array)
            index_size_after = self.index.ntotal
            logger.info(f"[VectorStore] Adicionado ao índice FAISS", {
                'tenantId': self.tenant_id,
                'indexSizeBefore': index_size_before,
                'indexSizeAfter': index_size_after,
                'added': index_size_after - index_size_before
            })
        else:
            # Fallback: armazenamento em memória
            vectors_before = len(self.vectors)
            logger.info(f"[VectorStore] Adicionando ao armazenamento em memória (FAISS não disponível)", {
                'tenantId': self.tenant_id,
                'vectorsBefore': vectors_before
            })
            self.vectors.extend(embeddings)
            vectors_after = len(self.vectors)
            logger.info(f"[VectorStore] Adicionado ao armazenamento em memória", {
                'tenantId': self.tenant_id,
                'vectorsBefore': vectors_before,
                'vectorsAfter': vectors_after,
                'added': vectors_after - vectors_before
            })
        
        # Adiciona metadados
        chunks_before = len(self.chunks)
        logger.info(f"[VectorStore] Adicionando chunks aos metadados", {
            'tenantId': self.tenant_id,
            'chunksBefore': chunks_before,
            'chunksToAdd': len(chunks),
            'chunkIds': [chunk.id for chunk in chunks],
            'documentIds': list(set(chunk.documentId for chunk in chunks))
        })
        
        for chunk, embedding in zip(chunks, embeddings):
            chunk.embedding = embedding
            self.chunks[chunk.id] = chunk
        
        chunks_after = len(self.chunks)
        logger.info(f"[VectorStore] Chunks adicionados aos metadados", {
            'tenantId': self.tenant_id,
            'chunksBefore': chunks_before,
            'chunksAfter': chunks_after,
            'chunksAdded': chunks_after - chunks_before
        })
        
        # Salva
        logger.info(f"[VectorStore] Salvando vector store", {
            'tenantId': self.tenant_id,
            'indexPath': str(self.index_path),
            'metadataPath': str(self.metadata_path),
            'totalChunks': len(self.chunks)
        })
        self._save()
        
        # Verifica após salvar
        stats_after_save = self.get_stats()
        logger.info(f"[VectorStore] Vector store salvo e verificado", {
            'tenantId': self.tenant_id,
            'documentCount': stats_after_save.get('documentCount', 0),
            'chunkCount': stats_after_save.get('chunkCount', 0),
            'indexSize': stats_after_save.get('indexSize', 0)
        })
    
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
        logger.info(f"[VectorStore] _save chamado", {
            'tenantId': self.tenant_id,
            'indexPath': str(self.index_path),
            'metadataPath': str(self.metadata_path),
            'chunksCount': len(self.chunks),
            'faissAvailable': FAISS_AVAILABLE,
            'indexNtotal': self.index.ntotal if FAISS_AVAILABLE and self.index else 0
        })
        
        try:
            if FAISS_AVAILABLE and self.index:
                index_size = self.index.ntotal
                logger.info(f"[VectorStore] Salvando índice FAISS", {
                    'tenantId': self.tenant_id,
                    'indexPath': str(self.index_path),
                    'indexSize': index_size
                })
                if index_size > 0:
                    faiss.write_index(self.index, str(self.index_path))
                    logger.info(f"[VectorStore] Índice FAISS salvo com sucesso", {
                        'tenantId': self.tenant_id,
                        'indexPath': str(self.index_path),
                        'indexSize': index_size
                    })
                else:
                    logger.warn(f"[VectorStore] Índice FAISS vazio, não salvando", {
                        'tenantId': self.tenant_id,
                        'indexSize': index_size
                    })
            else:
                logger.info(f"[VectorStore] FAISS não disponível, usando fallback", {
                    'tenantId': self.tenant_id,
                    'vectorsCount': len(self.vectors)
                })
            
            logger.info(f"[VectorStore] Salvando metadados", {
                'tenantId': self.tenant_id,
                'metadataPath': str(self.metadata_path),
                'chunksCount': len(self.chunks)
            })
            self._save_metadata()
            logger.info(f"[VectorStore] Metadados salvos com sucesso", {
                'tenantId': self.tenant_id,
                'metadataPath': str(self.metadata_path),
                'chunksCount': len(self.chunks)
            })
        except Exception as e:
            logger.error(f"[VectorStore] Erro ao salvar vector store", {
                'tenantId': self.tenant_id,
                'error': str(e),
                'errorType': type(e).__name__,
                'indexPath': str(self.index_path),
                'metadataPath': str(self.metadata_path)
            })
            raise
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Retorna estatísticas do índice.
        
        Returns:
            Dicionário com estatísticas
        """
        document_ids = set(chunk.documentId for chunk in self.chunks.values())
        
        stats = {
            "documentCount": len(document_ids),
            "chunkCount": len(self.chunks),
            "indexSize": self.index.ntotal if FAISS_AVAILABLE and self.index else len(self.vectors)
        }
        
        logger.info(f"[VectorStore] get_stats chamado", {
            'tenantId': self.tenant_id,
            'documentCount': stats['documentCount'],
            'chunkCount': stats['chunkCount'],
            'indexSize': stats['indexSize'],
            'chunksInMemory': len(self.chunks),
            'indexExists': self.index_path.exists() if hasattr(self, 'index_path') else False,
            'metadataExists': self.metadata_path.exists() if hasattr(self, 'metadata_path') else False
        })
        
        return stats

