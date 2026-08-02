"""
Serviço de chunking de documentos.
"""

import re
import logging
from typing import List
from models.document import Document, Chunk, ChunkMetadata, DocumentPermissions
from config.settings import get_settings
from services.deduplication_service import generate_chunk_id

logger = logging.getLogger(__name__)


def chunk_document_fixed_size(document: Document, chunk_size: int, overlap: int) -> List[Chunk]:
    """
    Chunking por tamanho fixo.
    
    Args:
        document: Documento a ser chunked
        chunk_size: Tamanho do chunk em caracteres
        overlap: Overlap entre chunks em caracteres
    
    Returns:
        Lista de chunks
    """
    chunks = []
    content = document.content
    start = 0
    chunk_index = 0
    
    while start < len(content):
        end = min(start + chunk_size, len(content))
        chunk_content = content[start:end]
        
        # Tenta quebrar em ponto de sentença próximo ao final
        if end < len(content):
            # Procura por ponto final, exclamação ou interrogação próximo ao final
            last_sentence = chunk_content.rfind('.')
            last_exclamation = chunk_content.rfind('!')
            last_question = chunk_content.rfind('?')
            last_break = max(last_sentence, last_exclamation, last_question)
            
            # Se encontrou um ponto de quebra próximo (últimos 20% do chunk)
            if last_break > chunk_size * 0.8:
                chunk_content = content[start:start + last_break + 1]
                end = start + last_break + 1
        
        # Gera chunk_id determinístico
        chunk_deterministic_id = generate_chunk_id(document.id, '', chunk_index)
        
        chunk = Chunk(
            id=chunk_deterministic_id,  # Usa ID determinístico
            documentId=document.id,
            tenantId=document.tenantId,
            content=chunk_content.strip(),
            metadata=ChunkMetadata(
                chunkIndex=chunk_index,
                startChar=start,
                endChar=end,
                tokenCount=len(chunk_content.split())  # Aproximação
            ),
            permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
        )
        chunks.append(chunk)
        
        start = end - overlap
        chunk_index += 1
    
    return chunks


def chunk_document_sentence(document: Document) -> List[Chunk]:
    """
    Chunking por sentenças.
    
    Args:
        document: Documento a ser chunked
    
    Returns:
        Lista de chunks
    """
    settings = get_settings()
    chunk_size = settings.chunk_size
    overlap = settings.chunk_overlap
    
    # Divide em sentenças
    sentences = re.split(r'(?<=[.!?])\s+', document.content)
    
    chunks = []
    current_chunk = []
    current_length = 0
    chunk_index = 0
    start_char = 0
    
    for sentence in sentences:
        sentence_length = len(sentence)
        
        # Se adicionar esta sentença ultrapassar o tamanho, cria novo chunk
        if current_length + sentence_length > chunk_size and current_chunk:
            # Cria chunk com sentenças acumuladas
            chunk_content = ' '.join(current_chunk)
            end_char = start_char + len(chunk_content)
            
            # Gera chunk_id determinístico
            section_title = ''  # Pode ser melhorado para detectar seções
            chunk_deterministic_id = generate_chunk_id(document.id, section_title, chunk_index)
            
            chunk = Chunk(
                id=chunk_deterministic_id,  # Usa ID determinístico
                documentId=document.id,
                tenantId=document.tenantId,
                content=chunk_content,
                metadata=ChunkMetadata(
                    chunkIndex=chunk_index,
                    startChar=start_char,
                    endChar=end_char,
                    tokenCount=len(chunk_content.split())
                ),
                permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
            )
            chunks.append(chunk)
            
            # Mantém overlap (últimas sentenças)
            overlap_sentences = []
            overlap_length = 0
            for s in reversed(current_chunk):
                if overlap_length + len(s) <= overlap:
                    overlap_sentences.insert(0, s)
                    overlap_length += len(s)
                else:
                    break
            
            current_chunk = overlap_sentences + [sentence]
            current_length = overlap_length + sentence_length
            start_char = end_char - overlap_length
            chunk_index += 1
        else:
            current_chunk.append(sentence)
            current_length += sentence_length
    
    # Adiciona último chunk se houver conteúdo
    if current_chunk:
        chunk_content = ' '.join(current_chunk)
        end_char = start_char + len(chunk_content)
        
        chunk = Chunk(
            id=f"{document.id}-chunk-{chunk_index}",
            documentId=document.id,
            tenantId=document.tenantId,
            content=chunk_content,
            metadata=ChunkMetadata(
                chunkIndex=chunk_index,
                startChar=start_char,
                endChar=end_char,
                tokenCount=len(chunk_content.split())
            ),
            permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
        )
        chunks.append(chunk)
    
    return chunks


def chunk_document_paragraph(document: Document) -> List[Chunk]:
    """
    Chunking por parágrafos.
    
    Args:
        document: Documento a ser chunked
    
    Returns:
        Lista de chunks
    """
    settings = get_settings()
    chunk_size = settings.chunk_size
    
    # Divide em parágrafos
    paragraphs = document.content.split('\n\n')
    
    chunks = []
    current_chunk = []
    current_length = 0
    chunk_index = 0
    start_char = 0
    
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        
        paragraph_length = len(paragraph)
        
        # Se parágrafo sozinho ultrapassa o tamanho, chunk por tamanho fixo
        if paragraph_length > chunk_size:
            # Se já tem conteúdo acumulado, salva primeiro
            if current_chunk:
                chunk_content = '\n\n'.join(current_chunk)
                end_char = start_char + len(chunk_content)
                
                chunk = Chunk(
                    id=f"{document.id}-chunk-{chunk_index}",
                    documentId=document.id,
                    tenantId=document.tenantId,
                    content=chunk_content,
                    metadata=ChunkMetadata(
                        chunkIndex=chunk_index,
                        startChar=start_char,
                        endChar=end_char,
                        tokenCount=len(chunk_content.split())
                    ),
                    permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
                )
                chunks.append(chunk)
                start_char = end_char
                chunk_index += 1
                current_chunk = []
                current_length = 0
            
            # Chunk o parágrafo grande por tamanho fixo
            sub_chunks = chunk_document_fixed_size(
                Document(
                    id=document.id,
                    tenantId=document.tenantId,
                    title=document.title,
                    content=paragraph,
                    metadata=document.metadata,
                    permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
                ),
                chunk_size,
                settings.chunk_overlap
            )
            # Ajusta índices e posições
            for sub_chunk in sub_chunks:
                # Gera chunk_id determinístico para sub-chunk
                chunk_deterministic_id = generate_chunk_id(document.id, '', chunk_index)
                sub_chunk.id = chunk_deterministic_id
                sub_chunk.metadata.chunkIndex = chunk_index
                sub_chunk.metadata.startChar = start_char
                start_char = sub_chunk.metadata.endChar
                chunk_index += 1
                chunks.append(sub_chunk)
            
            current_chunk = []
            current_length = 0
        elif current_length + paragraph_length > chunk_size:
            # Cria chunk com parágrafos acumulados
            chunk_content = '\n\n'.join(current_chunk)
            end_char = start_char + len(chunk_content)
            
            # Gera chunk_id determinístico
            section_title = ''  # Pode ser melhorado para detectar seções
            chunk_deterministic_id = generate_chunk_id(document.id, section_title, chunk_index)
            
            chunk = Chunk(
                id=chunk_deterministic_id,  # Usa ID determinístico
                documentId=document.id,
                tenantId=document.tenantId,
                content=chunk_content,
                metadata=ChunkMetadata(
                    chunkIndex=chunk_index,
                    startChar=start_char,
                    endChar=end_char,
                    tokenCount=len(chunk_content.split())
                ),
                permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
            )
            chunks.append(chunk)
            
            current_chunk = [paragraph]
            current_length = paragraph_length
            start_char = end_char
            chunk_index += 1
        else:
            current_chunk.append(paragraph)
            current_length += paragraph_length + 2  # +2 para \n\n
    
    # Adiciona último chunk se houver conteúdo
    if current_chunk:
        chunk_content = '\n\n'.join(current_chunk)
        end_char = start_char + len(chunk_content)
        
        # Gera chunk_id determinístico
        section_title = ''  # Pode ser melhorado para detectar seções
        chunk_deterministic_id = generate_chunk_id(document.id, section_title, chunk_index)
        
        chunk = Chunk(
            id=chunk_deterministic_id,  # Usa ID determinístico
            documentId=document.id,
            tenantId=document.tenantId,
            content=chunk_content,
            metadata=ChunkMetadata(
                chunkIndex=chunk_index,
                startChar=start_char,
                endChar=end_char,
                tokenCount=len(chunk_content.split())
            ),
            permissions=document.permissions,
            domain=getattr(document, 'domain', 'OPERATIONAL'),
            classification=getattr(document, 'classification', 'PRODUCTION'),
            sensitivity=getattr(document, 'sensitivity', 'INTERNAL')
        )
        chunks.append(chunk)
    
    return chunks


def chunk_document(document: Document) -> List[Chunk]:
    """
    Chunking de documento usando estratégia configurada.
    
    Args:
        document: Documento a ser chunked
    
    Returns:
        Lista de chunks
    """
    settings = get_settings()
    strategy = settings.chunk_strategy
    
    if strategy == "fixed_size":
        return chunk_document_fixed_size(
            document,
            settings.chunk_size,
            settings.chunk_overlap
        )
    elif strategy == "sentence":
        return chunk_document_sentence(document)
    elif strategy == "paragraph":
        return chunk_document_paragraph(document)
    else:
        # Fallback para fixed_size
        return chunk_document_fixed_size(
            document,
            settings.chunk_size,
            settings.chunk_overlap
        )

