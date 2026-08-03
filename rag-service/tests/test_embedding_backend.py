"""
Testes do backend configurável de embeddings (torch | onnx).

SentenceTransformer é mockado: a suíte não baixa modelo ONNX nem carrega
pesos reais. O comportamento real é coberto por smoke fora da suíte.
"""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import services.embedding_service as embedding_service


@pytest.fixture(autouse=True)
def reset_singleton():
    """Garante singleton e cache LRU limpos antes/depois de cada teste."""
    embedding_service.reset_embedding_model()
    yield
    embedding_service.reset_embedding_model()


def _stub_settings(monkeypatch, backend):
    """Redireciona get_settings do serviço para um stub com o backend dado."""
    settings = SimpleNamespace(
        embedding_model='sentence-transformers/all-MiniLM-L6-v2',
        embedding_backend=backend,
    )
    monkeypatch.setattr(embedding_service, 'get_settings', lambda: settings)
    return settings


def test_backend_padrao_torch(monkeypatch):
    """(a) Default torch: SentenceTransformer chamado sem backend (inalterado)."""
    settings = _stub_settings(monkeypatch, 'torch')
    fake_model = MagicMock()
    mock_st = MagicMock(return_value=fake_model)
    monkeypatch.setattr(embedding_service, 'SentenceTransformer', mock_st)

    model = embedding_service.get_embedding_model()

    assert model is fake_model
    mock_st.assert_called_once_with(settings.embedding_model)


def test_backend_onnx_selecionado(monkeypatch):
    """(b) Backend onnx configurado: SentenceTransformer chamado com backend='onnx'."""
    settings = _stub_settings(monkeypatch, 'onnx')
    fake_model = MagicMock()
    mock_st = MagicMock(return_value=fake_model)
    monkeypatch.setattr(embedding_service, 'SentenceTransformer', mock_st)

    model = embedding_service.get_embedding_model()

    assert model is fake_model
    mock_st.assert_called_once_with(settings.embedding_model, backend='onnx')


def test_fallback_onnx_para_torch_em_falha(monkeypatch, caplog):
    """(c) Falha no load ONNX: fallback explícito para torch, com warning, sem exceção."""
    settings = _stub_settings(monkeypatch, 'onnx')
    fake_model = MagicMock()
    mock_st = MagicMock(side_effect=[RuntimeError('onnx indisponível'), fake_model])
    monkeypatch.setattr(embedding_service, 'SentenceTransformer', mock_st)

    with caplog.at_level(logging.WARNING, logger=embedding_service.logger.name):
        model = embedding_service.get_embedding_model()

    assert model is fake_model
    assert mock_st.call_count == 2
    # 1ª tentativa: backend onnx; 2ª (fallback): torch puro, sem kwarg backend
    assert mock_st.call_args_list[0].kwargs == {'backend': 'onnx'}
    assert mock_st.call_args_list[1].args == (settings.embedding_model,)
    assert mock_st.call_args_list[1].kwargs == {}
    assert any('fallback torch' in rec.message for rec in caplog.records)


def test_backend_invalido_usa_torch_com_warning(monkeypatch, caplog):
    """Valor fora de 'torch'/'onnx' cai em torch com warning (config defensiva)."""
    settings = _stub_settings(monkeypatch, 'tensorrt')
    fake_model = MagicMock()
    mock_st = MagicMock(return_value=fake_model)
    monkeypatch.setattr(embedding_service, 'SentenceTransformer', mock_st)

    with caplog.at_level(logging.WARNING, logger=embedding_service.logger.name):
        model = embedding_service.get_embedding_model()

    assert model is fake_model
    mock_st.assert_called_once_with(settings.embedding_model)
    assert any('inválido' in rec.message for rec in caplog.records)
