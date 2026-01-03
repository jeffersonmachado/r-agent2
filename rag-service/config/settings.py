"""
Configurações do serviço RAG.
"""

from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    """Configurações da aplicação."""
    
    # Servidor
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    
    # Embeddings
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384
    
    # Chunking
    chunk_size: int = 500
    chunk_overlap: int = 50
    chunk_strategy: str = "sentence"  # fixed_size | sentence | paragraph | semantic
    
    # Vector Store
    vector_store_type: str = "faiss"  # faiss | chroma | pinecone
    vector_store_path: str = "./data/vector_store"
    
    # LLM
    llm_provider: str = "openai"  # openai | anthropic
    llm_model: str = "gpt-3.5-turbo"
    llm_api_key: Optional[str] = None
    llm_max_tokens: int = 1000
    llm_temperature: float = 0.7
    
    @property
    def openai_api_key(self) -> Optional[str]:
        """Retorna OpenAI API key de llm_api_key ou OPENAI_API_KEY env."""
        return self.llm_api_key or os.getenv("OPENAI_API_KEY")
    
    # RAG
    default_top_k: int = 5
    default_min_score: float = 0.6
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Retorna instância singleton das configurações."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

