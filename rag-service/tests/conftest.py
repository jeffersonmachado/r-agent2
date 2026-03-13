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
