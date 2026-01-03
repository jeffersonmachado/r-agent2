"""
Configuração global para testes pytest.
"""

import pytest
import os
import shutil
from pathlib import Path


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Configura ambiente de teste."""
    # Define diretório de dados de teste
    test_data_dir = Path("./data/test_vector_store")
    test_data_dir.mkdir(parents=True, exist_ok=True)
    
    # Define variáveis de ambiente para testes
    os.environ["VECTOR_STORE_PATH"] = str(test_data_dir)
    os.environ["DEBUG"] = "true"
    
    yield
    
    # Cleanup após todos os testes
    if test_data_dir.exists():
        shutil.rmtree(test_data_dir, ignore_errors=True)

