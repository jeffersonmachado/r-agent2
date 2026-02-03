"""
Configurações do serviço RAG.

Lê configurações de api/data/config.json com fallback para variáveis de ambiente.
"""

from pydantic_settings import BaseSettings
from typing import Optional
import os
import json
from pathlib import Path


def find_project_root(start_path: Optional[Path] = None) -> Optional[Path]:
    """
    Encontra o diretório raiz do projeto procurando por arquivos marcadores.
    
    Procura por: package.json, docker-compose.yml, docker-compose.prod.yml
    """
    if start_path is None:
        start_path = Path(__file__).resolve()
    else:
        start_path = Path(start_path).resolve()
    
    current = start_path
    # Se start_path é um arquivo, começa do diretório pai
    if current.is_file():
        current = current.parent
    
    # Procura pelo diretório raiz (máximo 10 níveis acima)
    markers = ['package.json', 'docker-compose.yml', 'docker-compose.prod.yml']
    for _ in range(10):
        for marker in markers:
            if (current / marker).exists():
                return current
        if current.parent == current:  # Chegou na raiz do sistema
            break
        current = current.parent
    
    return None


def load_config_json() -> Optional[dict]:
    """
    Carrega configurações do config.json do Node.js.
    
    Tenta encontrar o arquivo em:
    1. Diretório raiz do projeto detectado automaticamente
    2. Caminhos relativos ao arquivo atual (desenvolvimento)
    3. Variável de ambiente PROJECT_ROOT
    """
    # Tenta encontrar o diretório raiz do projeto
    project_root = find_project_root()
    if project_root is None:
        # Fallback para variável de ambiente
        project_root = os.getenv("PROJECT_ROOT")
        if project_root:
            project_root = Path(project_root)
    
    base_paths = []
    
    # Adiciona caminho baseado no diretório raiz detectado
    if project_root:
        base_paths.append(project_root / "api" / "data" / "config.json")
    
    # Adiciona caminhos relativos (para desenvolvimento)
    base_paths.extend([
        Path(__file__).parent.parent.parent / "api" / "data" / "config.json",
        Path(__file__).parent.parent.parent.parent / "api" / "data" / "config.json",
        Path(__file__).parent.parent / "api" / "data" / "config.json",
    ])
    
    for config_path in base_paths:
        if config_path.exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    rag_config = config.get('rag', {}).get('service', {})
                    if rag_config:
                        return rag_config
            except (json.JSONDecodeError, IOError) as e:
                print(f"[Settings] Erro ao ler config.json de {config_path}: {e}")
                continue
    
    return None


def load_full_config_json() -> Optional[dict]:
    """
    Carrega o config.json completo (não apenas a seção RAG).
    """
    # Tenta encontrar o diretório raiz do projeto
    project_root = find_project_root()
    if project_root is None:
        # Fallback para variável de ambiente
        project_root = os.getenv("PROJECT_ROOT")
        if project_root:
            project_root = Path(project_root)
    
    base_paths = []
    
    # Adiciona caminho baseado no diretório raiz detectado
    if project_root:
        base_paths.append(project_root / "api" / "data" / "config.json")
    
    # Adiciona caminhos relativos (para desenvolvimento)
    base_paths.extend([
        Path(__file__).parent.parent.parent / "api" / "data" / "config.json",
        Path(__file__).parent.parent.parent.parent / "api" / "data" / "config.json",
        Path(__file__).parent.parent / "api" / "data" / "config.json",
    ])
    
    for config_path in base_paths:
        if config_path.exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"[Settings] Erro ao ler config.json completo de {config_path}: {e}")
                continue
    
    return None


# Carrega configuração do config.json uma vez no início
_CONFIG_JSON = load_config_json()


class Settings(BaseSettings):
    """Configurações da aplicação."""
    
    # Servidor
    host: str = _CONFIG_JSON.get('host', '0.0.0.0') if _CONFIG_JSON else "0.0.0.0"
    port: int = _CONFIG_JSON.get('port', 9000) if _CONFIG_JSON else 9000
    debug: bool = _CONFIG_JSON.get('debug', False) if _CONFIG_JSON else False
    
    # Embeddings
    embedding_model: str = (
        _CONFIG_JSON.get('embedding', {}).get('model', 'sentence-transformers/all-MiniLM-L6-v2')
        if _CONFIG_JSON else "sentence-transformers/all-MiniLM-L6-v2"
    )
    embedding_dimension: int = (
        _CONFIG_JSON.get('embedding', {}).get('dimension', 384)
        if _CONFIG_JSON else 384
    )
    
    # Chunking
    chunk_size: int = (
        _CONFIG_JSON.get('chunking', {}).get('size', 500)
        if _CONFIG_JSON else 500
    )
    chunk_overlap: int = (
        _CONFIG_JSON.get('chunking', {}).get('overlap', 50)
        if _CONFIG_JSON else 50
    )
    chunk_strategy: str = (
        _CONFIG_JSON.get('chunking', {}).get('strategy', 'sentence')
        if _CONFIG_JSON else "sentence"
    )
    
    # Vector Store
    vector_store_type: str = (
        _CONFIG_JSON.get('vectorStore', {}).get('type', 'postgres')
        if _CONFIG_JSON else "postgres"
    )
    vector_store_path: str = (
        _CONFIG_JSON.get('vectorStore', {}).get('path', './data/vector_store')
        if _CONFIG_JSON else "./data/vector_store"
    )

    # Database (para pgvector)
    # Prioridade: DATABASE_URL env > PG* env > vazio
    database_url: Optional[str] = None

    @property
    def postgres_dsn(self) -> Optional[str]:
        """
        Retorna DSN do Postgres para o vector store (pgvector).
        Usa DATABASE_URL (recomendado) ou monta via PG*.
        """
        if os.getenv("DATABASE_URL"):
            return os.getenv("DATABASE_URL")
        if self.database_url:
            return self.database_url

        host = os.getenv("PGHOST")
        user = os.getenv("PGUSER")
        password = os.getenv("PGPASSWORD")
        dbname = os.getenv("PGDATABASE")
        port = os.getenv("PGPORT") or "5432"

        if host and user and dbname:
            pw = password or ""
            return f"postgresql://{user}:{pw}@{host}:{port}/{dbname}"
        return None
    
    # LLM
    llm_provider: str = (
        _CONFIG_JSON.get('llm', {}).get('provider', 'openai')
        if _CONFIG_JSON else "openai"
    )
    llm_model: str = (
        _CONFIG_JSON.get('llm', {}).get('model', 'gpt-3.5-turbo')
        if _CONFIG_JSON else "gpt-3.5-turbo"
    )
    llm_api_key: Optional[str] = None
    llm_max_tokens: int = (
        _CONFIG_JSON.get('llm', {}).get('maxTokens', 1000)
        if _CONFIG_JSON else 1000
    )
    llm_temperature: float = (
        _CONFIG_JSON.get('llm', {}).get('temperature', 0.7)
        if _CONFIG_JSON else 0.7
    )
    
    @property
    def openai_api_key(self) -> Optional[str]:
        """Retorna OpenAI API key de llm_api_key ou OPENAI_API_KEY env."""
        return self.llm_api_key or os.getenv("OPENAI_API_KEY")
    
    # RAG
    default_top_k: int = (
        _CONFIG_JSON.get('defaults', {}).get('topK', 6)
        if _CONFIG_JSON else 6
    )
    default_min_score: float = (
        _CONFIG_JSON.get('defaults', {}).get('minScore', 0.45)
        if _CONFIG_JSON else 0.45
    )
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        # Permite override via variáveis de ambiente (com precedência sobre config.json)
        env_prefix = "RAG_"
        case_sensitive = False


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """
    Retorna instância singleton das configurações.
    
    Prioridade:
    1. Variáveis de ambiente (RAG_*)
    2. config.json (api/data/config.json)
    3. Valores padrão
    """
    global _settings
    if _settings is None:
        _settings = Settings()
        # Log da fonte de configuração
        if _CONFIG_JSON:
            print("[Settings] Configurações carregadas de config.json")
        else:
            print("[Settings] Usando valores padrão e variáveis de ambiente")
    return _settings
