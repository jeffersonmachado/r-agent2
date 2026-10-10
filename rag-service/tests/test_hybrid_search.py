"""
Testes do núcleo de fusão híbrida (puro, sem banco).

A fusão decide o ranking final; um erro aqui degrada silenciosamente TODAS as
respostas do copiloto. Por isso: pesos, empates determinísticos, rastreabilidade
e fallback de modalidade ausente têm teste explícito.
"""

import pytest

from services.hybrid_search import (
    ALGORITHM_VERSION,
    reciprocal_rank_fusion,
    fuse_with_fallback,
)


def rows(*ids):
    return [{"id": i, "score": 0.5} for i in ids]


class TestReciprocalRankFusion:
    def test_concordancia_das_duas_modalidades_mantem_a_ordem(self):
        fused = reciprocal_rank_fusion(rows("a", "b", "c"), rows("a", "b", "c"))
        assert [r["id"] for r in fused] == ["a", "b", "c"]
        assert all(r["matchedBy"] == ["lexical", "semantic"] for r in fused)

    def test_documento_presente_so_no_lexical_entra_no_ranking(self):
        # Termo exato que o vetorial não recuperou.
        fused = reciprocal_rank_fusion(rows("a", "b"), rows("exato", "a"))
        ids = [r["id"] for r in fused]
        assert "exato" in ids
        entrada = next(r for r in fused if r["id"] == "exato")
        assert entrada["semanticRank"] is None
        assert entrada["lexicalRank"] == 1
        assert entrada["matchedBy"] == ["lexical"]

    def test_pesos_alteram_o_vencedor_conforme_configurado(self):
        # "sem" é 1º no vetorial; "lex" é 1º no lexical e 2º no vetorial.
        semantic = rows("sem", "lex")
        lexical = rows("lex", "sem")

        vies_semantico = reciprocal_rank_fusion(semantic, lexical, weight_semantic=0.9, weight_lexical=0.1)
        assert vies_semantico[0]["id"] == "sem"

        vies_lexical = reciprocal_rank_fusion(semantic, lexical, weight_semantic=0.1, weight_lexical=0.9)
        assert vies_lexical[0]["id"] == "lex"

    def test_empate_e_desempatado_de_forma_deterministica(self):
        # Com PESOS IGUAIS e posições espelhadas os scores são exatamente iguais
        # (0.5/62 + 0.5/61 nos dois). O desempate tem de ser determinístico
        # (id asc) e não depender da ordem de inserção das modalidades.
        primeira = reciprocal_rank_fusion(rows("b", "a"), rows("a", "b"), weight_semantic=0.5, weight_lexical=0.5)
        segunda = reciprocal_rank_fusion(rows("a", "b"), rows("b", "a"), weight_semantic=0.5, weight_lexical=0.5)

        assert [r["id"] for r in primeira] == ["a", "b"]
        assert [r["id"] for r in segunda] == ["a", "b"]
        assert primeira[0]["rrfScore"] == pytest.approx(primeira[1]["rrfScore"])

    def test_peso_maior_desempata_a_favor_da_modalidade_mais_pesada(self):
        # Com pesos assimétricos NÃO há empate: quem lidera o ranking da
        # modalidade mais pesada vence — comportamento intencional, não ruído.
        fused = reciprocal_rank_fusion(rows("sem", "lex"), rows("lex", "sem"))
        assert fused[0]["id"] == "sem"
        assert fused[0]["rrfScore"] > fused[1]["rrfScore"]

    def test_formula_rrf_confere_com_o_calculo_manual(self):
        fused = reciprocal_rank_fusion(rows("a"), rows("a"), k=60, weight_semantic=0.6, weight_lexical=0.4)
        esperado = 0.6 / (60 + 1) + 0.4 / (60 + 1)
        assert fused[0]["rrfScore"] == pytest.approx(esperado)
        assert fused[0]["rrfK"] == 60
        assert fused[0]["weights"] == {"semantic": 0.6, "lexical": 0.4}

    def test_rastreabilidade_completa_por_resultado(self):
        fused = reciprocal_rank_fusion(rows("a", "b"), rows("b"))
        for row in fused:
            assert row["algorithmVersion"] == ALGORITHM_VERSION
            assert row["strategy"] == "hybrid"
            assert isinstance(row["rank"], int)
            assert "semanticRank" in row and "lexicalRank" in row
        b = next(r for r in fused if r["id"] == "b")
        assert b["semanticRank"] == 2
        assert b["lexicalRank"] == 1
        assert b["matchedBy"] == ["lexical", "semantic"]

    def test_top_k_limita_sem_alterar_ordem(self):
        fused = reciprocal_rank_fusion(rows("a", "b", "c"), rows(), top_k=2)
        assert [r["id"] for r in fused] == ["a", "b"]

    def test_k_invalido_reprova(self):
        with pytest.raises(ValueError):
            reciprocal_rank_fusion(rows("a"), rows("a"), k=0)


class TestFallbackDeModalidade:
    def test_sem_lexical_o_vetorial_continua_respondendo(self):
        out = fuse_with_fallback(rows("a", "b"), [], lexical_error="timeout")
        assert [r["id"] for r in out["results"]] == ["a", "b"]
        assert out["degradationReasons"] == ["lexical:timeout"]
        assert out["degraded"] is True

    def test_sem_vetorial_o_lexical_continua_respondendo(self):
        out = fuse_with_fallback([], rows("x"), semantic_error="provider_down")
        assert [r["id"] for r in out["results"]] == ["x"]
        assert out["degradationReasons"] == ["semantic:provider_down"]

    def test_sem_nenhuma_modalidade_o_vazio_e_explicado(self):
        out = fuse_with_fallback([], [], semantic_error="e1", lexical_error="e2")
        assert out["results"] == []
        assert out["degraded"] is True
        assert len(out["degradationReasons"]) == 2

    def test_fusao_saudavel_nao_marca_degradacao(self):
        out = fuse_with_fallback(rows("a"), rows("b"))
        assert out["degraded"] is False
        assert out["degradationReasons"] == []
