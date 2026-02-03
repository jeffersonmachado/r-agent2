"""
Serviço de Aprendizado Adaptativo para RAG.

Responsabilidades:
- Extração dinâmica de sinônimos dos documentos
- Aprendizado de padrões de perguntas
- Ajuste dinâmico de prompts baseado em sucesso/falha
- Otimização contínua de configurações por tenant
"""

import json
import re
import logging
import os
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime, timedelta
import math

logger = logging.getLogger(__name__)

# Caminho para armazenar dados de aprendizado por tenant
LEARNING_DATA_PATH = Path("./data/adaptive_learning")
LEARNING_DATA_PATH.mkdir(parents=True, exist_ok=True)

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


# Caminho para regras de validação
# Tenta encontrar o diretório raiz do projeto
project_root = find_project_root()
if project_root is None:
    # Fallback para variável de ambiente
    project_root_env = os.getenv("PROJECT_ROOT")
    if project_root_env:
        project_root = Path(project_root_env)

VALIDATION_RULES_PATH = None

# Tenta caminhos baseados no diretório raiz detectado
if project_root:
    candidate = project_root / "api" / "data" / "rag_validation_rules.json"
    if candidate.exists():
        VALIDATION_RULES_PATH = candidate

# Se não encontrou, tenta caminhos relativos
if VALIDATION_RULES_PATH is None or not VALIDATION_RULES_PATH.exists():
    for rel_path in [
        Path("../api/data/rag_validation_rules.json"),
        Path("../../api/data/rag_validation_rules.json"),
        Path("./api/data/rag_validation_rules.json"),
    ]:
        if rel_path.exists():
            VALIDATION_RULES_PATH = rel_path
            break

# Se ainda não encontrou, usa None (será tratado no código que usa)
if VALIDATION_RULES_PATH is None or not VALIDATION_RULES_PATH.exists():
    VALIDATION_RULES_PATH = None


class AdaptiveLearningService:
    """Serviço de aprendizado adaptativo para melhorar acurácia do RAG."""
    
    def __init__(self):
        self.learning_data: Dict[str, Dict] = {}
        self.validation_rules: Optional[Dict] = None
        self.load_all_learning_data()
        self.load_validation_rules()
    
    def get_learning_file_path(self, tenant_id: str) -> Path:
        """Retorna caminho do arquivo de aprendizado para um tenant."""
        return LEARNING_DATA_PATH / f"{tenant_id}_learning.json"
    
    def load_learning_data(self, tenant_id: str) -> Dict:
        """Carrega dados de aprendizado de um tenant."""
        file_path = self.get_learning_file_path(tenant_id)
        
        if file_path.exists():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.learning_data[tenant_id] = data
                    return data
            except Exception as e:
                logger.error(f"Erro ao carregar dados de aprendizado para {tenant_id}: {e}")
        
        # Retorna estrutura padrão
        default_data = {
            "tenantId": tenant_id,
            "synonyms": {},
            "queryPatterns": {
                "successful": [],
                "failed": []
            },
            "promptVariations": [],
            "metrics": {
                "totalQueries": 0,
                "successfulQueries": 0,
                "failedQueries": 0,
                "avgConfidence": 0.0,
                "lastUpdated": None
            },
            "config": {
                "minScore": 0.45,
                "topK": 6,
                "chunkOverlap": 75
            },
            "learningCycles": {
                "total": 0,
                "lastCycle": None,
                "cycles": []
            },
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat()
        }
        
        self.learning_data[tenant_id] = default_data
        return default_data
    
    def save_learning_data(self, tenant_id: str):
        """Salva dados de aprendizado de um tenant."""
        if tenant_id not in self.learning_data:
            return
        
        file_path = self.get_learning_file_path(tenant_id)
        data = self.learning_data[tenant_id]
        data["updatedAt"] = datetime.utcnow().isoformat()
        
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.debug(f"Dados de aprendizado salvos para {tenant_id}")
        except Exception as e:
            logger.error(f"Erro ao salvar dados de aprendizado para {tenant_id}: {e}")
    
    def load_all_learning_data(self):
        """Carrega todos os dados de aprendizado disponíveis."""
        if not LEARNING_DATA_PATH.exists():
            return
        
        for file_path in LEARNING_DATA_PATH.glob("*_learning.json"):
            tenant_id = file_path.stem.replace("_learning", "")
            self.load_learning_data(tenant_id)
    
    def load_validation_rules(self) -> Dict:
        """Carrega regras de validação do arquivo JSON."""
        if VALIDATION_RULES_PATH is not None and VALIDATION_RULES_PATH.exists():
            try:
                with open(VALIDATION_RULES_PATH, 'r', encoding='utf-8') as f:
                    self.validation_rules = json.load(f)
                    logger.info(f"Regras de validação carregadas de {VALIDATION_RULES_PATH}")
                    return self.validation_rules
            except Exception as e:
                logger.error(f"Erro ao carregar regras de validação: {e}")
        
        # Retorna regras padrão se não conseguir carregar
        logger.warning("Usando regras de validação padrão")
        self.validation_rules = self._get_default_validation_rules()
        return self.validation_rules
    
    def _get_default_validation_rules(self) -> Dict:
        """Retorna regras de validação padrão."""
        return {
            "version": "1.0.0",
            "lastUpdated": datetime.utcnow().isoformat(),
            "adaptationCycles": 0,
            "maxCycles": 50,
            "targetAccuracy": 0.85,
            "currentAccuracy": 0.0,
            "rules": {
                "length": {"enabled": True, "minLength": 10, "maxLength": 200, "weight": 1.0},
                "alphanumeric": {"enabled": True, "minAlphanumericRatio": 0.6, "weight": 1.0},
                "uuid": {"enabled": True, "rejectFullUuid": True, "rejectUuidInShortText": True, "shortTextMaxLength": 50, "weight": 1.0},
                "repetition": {"enabled": True, "maxConsecutiveRepetitions": 2, "maxWordRepetitionRatio": 0.5, "weight": 1.0},
                "invalidPrefixes": {"enabled": True, "patterns": ["^jpeg\\]", "^\\[imagem:", "^imagem:", "^texto extraído", "^ocr:", "^\\[imagem"], "weight": 1.0},
                "invalidPatterns": {"enabled": True, "patterns": ["\\[imagem:.*?\\]", "texto extraído.*ocr", "jpeg.*texto extraído", "^\\w+\\]\\s*texto", "^\\w+\\]\\s*imagem", "extraído.*ocr", "ace.*friday.*r\\$"], "weight": 1.0},
                "genericQuestions": {"enabled": True, "patterns": ["^(o que|como|qual|quais|quem|onde|quando)\\s*$", "^(o que|como|qual|quais|quem|onde|quando)\\s+(é|são|faz|fazem)\\s*$", "^[a-z]+\\s+[a-z]+\\s*$"], "weight": 1.0},
                "questionStructure": {"enabled": True, "requireQuestionWord": False, "requireQuestionMark": False, "minMeaningfulWords": 3, "weight": 1.0},
                "metadataPatterns": {"enabled": True, "patterns": ["^\\w+\\]\\s*texto", "^\\w+\\]\\s*imagem", "extraído.*ocr", "ace.*friday.*r\\$"], "weight": 1.0}
            },
            "adaptation": {"enabled": True, "adjustmentRate": 0.1, "minWeight": 0.1, "maxWeight": 2.0, "accuracyHistory": []}
        }
    
    def save_validation_rules(self):
        """Salva regras de validação no arquivo JSON."""
        if not self.validation_rules:
            return
        
        if VALIDATION_RULES_PATH is None:
            logger.warning("Caminho de regras de validação não configurado. Não é possível salvar.")
            return
        
        try:
            # Garante que o diretório existe
            VALIDATION_RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.validation_rules["lastUpdated"] = datetime.utcnow().isoformat()
            with open(VALIDATION_RULES_PATH, 'w', encoding='utf-8') as f:
                json.dump(self.validation_rules, f, indent=2, ensure_ascii=False)
            logger.info(f"Regras de validação salvas em {VALIDATION_RULES_PATH}")
        except Exception as e:
            logger.error(f"Erro ao salvar regras de validação: {e}")
    
    def extract_synonyms_from_documents(self, documents: List[Dict]) -> Dict[str, List[str]]:
        """
        Extrai sinônimos dinamicamente dos documentos indexados.
        
        Analisa títulos e conteúdo para encontrar termos relacionados.
        """
        synonyms = defaultdict(set)
        
        # Palavras comuns a ignorar
        stopwords = {
            'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
            'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem',
            'que', 'qual', 'quais', 'este', 'esta', 'esse', 'essa',
            'como', 'quando', 'onde', 'porque', 'por que'
        }
        
        # Coleta todos os termos dos documentos
        all_terms = defaultdict(list)
        
        for doc in documents:
            # Extrai termos do título
            title = doc.get('title', '').lower()
            title_terms = self._extract_meaningful_terms(title, stopwords)
            
            # Extrai termos do conteúdo (primeiros 1000 caracteres)
            content = doc.get('content', '')[:1000].lower()
            content_terms = self._extract_meaningful_terms(content, stopwords)
            
            # Combina termos
            all_terms_in_doc = set(title_terms + content_terms)
            
            # Agrupa termos que aparecem juntos frequentemente
            for term in all_terms_in_doc:
                if len(term) >= 4:  # Apenas termos com 4+ caracteres
                    all_terms[term].append(doc.get('id'))
        
        # Identifica termos relacionados (aparecem nos mesmos documentos)
        term_cooccurrence = defaultdict(Counter)
        
        for doc in documents:
            doc_id = doc.get('id')
            title = doc.get('title', '').lower()
            content = doc.get('content', '')[:1000].lower()
            doc_terms = self._extract_meaningful_terms(title + ' ' + content, stopwords)
            doc_terms = [t for t in doc_terms if len(t) >= 4]
            
            # Conta co-ocorrências
            for i, term1 in enumerate(doc_terms):
                for term2 in doc_terms[i+1:]:
                    if term1 != term2:
                        term_cooccurrence[term1][term2] += 1
                        term_cooccurrence[term2][term1] += 1
        
        # Cria grupos de sinônimos baseado em co-ocorrência
        for term, cooccurrences in term_cooccurrence.items():
            # Termos que aparecem juntos frequentemente são sinônimos potenciais
            top_cooccurrences = cooccurrences.most_common(5)
            if top_cooccurrences:
                synonym_group = [term]
                for co_term, count in top_cooccurrences:
                    if count >= 2:  # Aparecem juntos em pelo menos 2 documentos
                        synonym_group.append(co_term)
                
                if len(synonym_group) > 1:
                    # Adiciona todos como sinônimos uns dos outros
                    for syn in synonym_group:
                        synonyms[syn].update(synonym_group)
        
        # Converte sets para lists
        result = {}
        for key, values in synonyms.items():
            result[key] = sorted(list(values - {key}))  # Remove o próprio termo
        
        return result
    
    def _extract_meaningful_terms(self, text: str, stopwords: set) -> List[str]:
        """Extrai termos significativos de um texto."""
        # Remove pontuação e normaliza
        text = re.sub(r'[^\w\s]', ' ', text.lower())
        words = re.findall(r'\b[a-záàâãéêíóôõúç]{3,}\b', text)
        
        # Filtra stopwords
        meaningful = [w for w in words if w not in stopwords and len(w) >= 3]
        
        return meaningful
    
    def _is_valid_query(self, query: str) -> bool:
        """
        Valida se uma query é válida antes de registrar usando regras do JSON.
        
        Args:
            query: Query a validar
        
        Returns:
            True se a query é válida
        """
        if not query or not isinstance(query, str):
            return False
        
        if not self.validation_rules:
            self.load_validation_rules()
        
        rules = self.validation_rules.get("rules", {})
        q = query.strip()
        
        # Regra: Comprimento
        if rules.get("length", {}).get("enabled", True):
            min_len = rules["length"].get("minLength", 10)
            max_len = rules["length"].get("maxLength", 200)
            if len(q) < min_len or len(q) > max_len:
                return False
        
        # Regra: Caracteres alfanuméricos
        if not re.search(r'[a-záàâãéêíóôõúç]', q, re.IGNORECASE):
            return False
        
        if rules.get("alphanumeric", {}).get("enabled", True):
            min_ratio = rules["alphanumeric"].get("minAlphanumericRatio", 0.6)
            alphanumeric_count = len(re.findall(r'[a-záàâãéêíóôõúç0-9]', q, re.IGNORECASE))
            total_chars = len(re.sub(r'\s', '', q))
            if total_chars > 0 and alphanumeric_count / total_chars < min_ratio:
                return False
        
        # Regra: Prefixos inválidos
        if rules.get("invalidPrefixes", {}).get("enabled", True):
            patterns = rules["invalidPrefixes"].get("patterns", [])
            for pattern in patterns:
                if re.match(pattern, q, re.IGNORECASE):
                    return False
        
        # Regra: Padrões inválidos
        if rules.get("invalidPatterns", {}).get("enabled", True):
            patterns = rules["invalidPatterns"].get("patterns", [])
            for pattern in patterns:
                if re.search(pattern, q, re.IGNORECASE):
                    return False
        
        # Regra: UUIDs
        if rules.get("uuid", {}).get("enabled", True):
            uuid_pattern = r'[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}'
            if rules["uuid"].get("rejectFullUuid", True):
                if re.match(f'^{uuid_pattern}$', q, re.IGNORECASE):
                    return False
            if rules["uuid"].get("rejectUuidInShortText", True):
                if re.search(uuid_pattern, q, re.IGNORECASE):
                    max_len = rules["uuid"].get("shortTextMaxLength", 50)
                    if len(q) < max_len:
                        return False
        
        # Regra: Repetições
        if rules.get("repetition", {}).get("enabled", True):
            words = q.lower().split()
            max_consecutive = rules["repetition"].get("maxConsecutiveRepetitions", 2)
            consecutive_count = 1
            last_word = ''
            for word in words:
                if word == last_word and len(word) > 2:
                    consecutive_count += 1
                    if consecutive_count >= max_consecutive:
                        return False
                else:
                    consecutive_count = 1
                last_word = word
            
            max_ratio = rules["repetition"].get("maxWordRepetitionRatio", 0.5)
            word_counts = {}
            for w in words:
                word_counts[w] = word_counts.get(w, 0) + 1
            if words:
                max_repetition = max(word_counts.values())
                if max_repetition / len(words) > max_ratio:
                    return False
        
        # Regra: Perguntas genéricas
        if rules.get("genericQuestions", {}).get("enabled", True):
            patterns = rules["genericQuestions"].get("patterns", [])
            for pattern in patterns:
                if re.match(pattern, q, re.IGNORECASE):
                    return False
        
        # Regra: Estrutura de pergunta
        if rules.get("questionStructure", {}).get("enabled", True):
            min_words = rules["questionStructure"].get("minMeaningfulWords", 3)
            meaningful_words = [w for w in q.split() if len(w) >= 3 and re.search(r'[a-záàâãéêíóôõúç]', w, re.IGNORECASE)]
            if len(meaningful_words) < min_words:
                return False
        
        # Regra: Padrões de metadados
        if rules.get("metadataPatterns", {}).get("enabled", True):
            patterns = rules["metadataPatterns"].get("patterns", [])
            for pattern in patterns:
                if re.search(pattern, q, re.IGNORECASE):
                    return False
        
        return True
    
    def record_query_result(self, tenant_id: str, query: str, success: bool, 
                           confidence: float, chunks_found: int, 
                           response: Optional[str] = None):
        """
        Registra resultado de uma consulta para aprendizado.
        
        Args:
            tenant_id: ID do tenant
            query: Query realizada
            success: Se a consulta foi bem-sucedida
            confidence: Confiança da resposta
            chunks_found: Número de chunks encontrados
            response: Resposta gerada (opcional)
        """
        # Valida query antes de registrar
        if not self._is_valid_query(query):
            logger.debug(f"Query inválida ignorada: {query[:50]}")
            return
        
        data = self.load_learning_data(tenant_id)
        
        # Atualiza métricas
        metrics = data.get("metrics") or {}
        # Compatibilidade defensiva: arquivos antigos podem ter "metrics": null
        if not isinstance(metrics, dict):
            metrics = {}
        data["metrics"] = metrics
        metrics["totalQueries"] = metrics.get("totalQueries", 0) + 1
        
        if success:
            metrics["successfulQueries"] = metrics.get("successfulQueries", 0) + 1
        else:
            metrics["failedQueries"] = metrics.get("failedQueries", 0) + 1
        
        # Atualiza confiança média
        total_successful = metrics["successfulQueries"]
        if total_successful > 0:
            current_avg = metrics.get("avgConfidence", 0.0)
            # Média móvel exponencial
            alpha = 0.1
            if success:
                metrics["avgConfidence"] = (1 - alpha) * current_avg + alpha * confidence
            else:
                metrics["avgConfidence"] = (1 - alpha) * current_avg
        
        metrics["lastUpdated"] = datetime.utcnow().isoformat()
        
        # Registra padrão de query
        query_pattern = {
            "query": query,
            "success": success,
            "confidence": confidence,
            "chunksFound": chunks_found,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        if success:
            query_patterns = data.get("queryPatterns") or {"successful": [], "failed": []}
            if not isinstance(query_patterns, dict):
                query_patterns = {"successful": [], "failed": []}
            if not isinstance(query_patterns.get("successful"), list):
                query_patterns["successful"] = []
            if not isinstance(query_patterns.get("failed"), list):
                query_patterns["failed"] = []
            data["queryPatterns"] = query_patterns

            data["queryPatterns"]["successful"].append(query_pattern)
            # Mantém apenas últimas 100 queries bem-sucedidas
            if len(data["queryPatterns"]["successful"]) > 100:
                data["queryPatterns"]["successful"] = data["queryPatterns"]["successful"][-100:]
        else:
            query_patterns = data.get("queryPatterns") or {"successful": [], "failed": []}
            if not isinstance(query_patterns, dict):
                query_patterns = {"successful": [], "failed": []}
            if not isinstance(query_patterns.get("successful"), list):
                query_patterns["successful"] = []
            if not isinstance(query_patterns.get("failed"), list):
                query_patterns["failed"] = []
            data["queryPatterns"] = query_patterns

            data["queryPatterns"]["failed"].append(query_pattern)
            # Mantém apenas últimas 50 queries falhadas para análise
            if len(data["queryPatterns"]["failed"]) > 50:
                data["queryPatterns"]["failed"] = data["queryPatterns"]["failed"][-50:]
        
        self.save_learning_data(tenant_id)
    
    def get_synonyms(self, tenant_id: str) -> Dict[str, List[str]]:
        """Retorna sinônimos aprendidos para um tenant."""
        data = self.load_learning_data(tenant_id)
        return data.get("synonyms", {})
    
    def update_synonyms_from_analysis(self, tenant_id: str, documents: List[Dict]):
        """
        Atualiza sinônimos baseado em análise de documentos.
        
        Args:
            tenant_id: ID do tenant
            documents: Lista de documentos indexados
        """
        if not documents:
            return
        
        # Extrai sinônimos dos documentos
        new_synonyms = self.extract_synonyms_from_documents(documents)
        
        # Carrega dados existentes
        data = self.load_learning_data(tenant_id)
        existing_synonyms = data.get("synonyms", {})
        
        # Mescla sinônimos (prioriza novos, mas mantém existentes)
        merged_synonyms = existing_synonyms.copy()
        
        for term, synonyms_list in new_synonyms.items():
            if term in merged_synonyms:
                # Combina listas e remove duplicatas
                combined = set(merged_synonyms[term] + synonyms_list)
                merged_synonyms[term] = sorted(list(combined))
            else:
                merged_synonyms[term] = synonyms_list
        
        data["synonyms"] = merged_synonyms
        
        # Registra ciclo de aprendizado
        learning_cycles = data.get("learningCycles", {})
        cycle_count = learning_cycles.get("total", 0) + 1
        learning_cycles["total"] = cycle_count
        learning_cycles["lastCycle"] = datetime.utcnow().isoformat()
        
        # Adiciona ciclo à lista (mantém últimos 50)
        cycles = learning_cycles.get("cycles", [])
        cycles.append({
            "cycle": cycle_count,
            "timestamp": datetime.utcnow().isoformat(),
            "type": "synonym_update",
            "synonymsAdded": len(new_synonyms),
            "totalSynonyms": len(merged_synonyms)
        })
        if len(cycles) > 50:
            cycles = cycles[-50:]
        learning_cycles["cycles"] = cycles
        data["learningCycles"] = learning_cycles
        
        self.save_learning_data(tenant_id)
        
        logger.info(f"Sinônimos atualizados para {tenant_id}: {len(merged_synonyms)} termos (ciclo {cycle_count})")
        
        # Dispara adaptação de regras se necessário
        self.adapt_validation_rules(tenant_id)
    
    def optimize_config(self, tenant_id: str) -> Dict:
        """
        Otimiza configurações baseado em métricas.
        
        Retorna configurações otimizadas.
        """
        data = self.load_learning_data(tenant_id)
        metrics = data.get("metrics") or {}
        if not isinstance(metrics, dict):
            metrics = {}
        current_config = data.get("config") or {}
        if not isinstance(current_config, dict):
            current_config = {}
        
        total = metrics.get("totalQueries", 0)
        if total < 10:  # Precisa de pelo menos 10 queries para otimizar
            return current_config
        
        success_rate = metrics.get("successfulQueries", 0) / total
        avg_confidence = metrics.get("avgConfidence", 0.0)
        
        # Ajusta minScore baseado em taxa de sucesso
        current_min_score = current_config.get("minScore", 0.45)
        new_min_score = current_min_score
        
        if success_rate < 0.70:  # Taxa de sucesso < 70%
            # Reduz minScore para capturar mais chunks
            new_min_score = max(0.30, current_min_score - 0.05)
        elif success_rate > 0.85 and avg_confidence > 0.70:  # Taxa alta e confiança boa
            # Aumenta minScore para melhor qualidade
            new_min_score = min(0.60, current_min_score + 0.05)
        
        # Ajusta topK baseado em chunks encontrados
        current_top_k = current_config.get("topK", 6)
        new_top_k = current_top_k
        
        # Analisa queries falhadas para ver se precisam de mais chunks
        query_patterns = data.get("queryPatterns") or {}
        if not isinstance(query_patterns, dict):
            query_patterns = {}
        failed_queries = query_patterns.get("failed") or []
        if not isinstance(failed_queries, list):
            failed_queries = []
        if failed_queries:
            avg_chunks_failed = sum(q.get("chunksFound", 0) for q in failed_queries[-10:]) / min(10, len(failed_queries))
            if avg_chunks_failed < 2:  # Poucos chunks encontrados
                new_top_k = min(10, current_top_k + 1)
            elif avg_chunks_failed > 5:  # Muitos chunks, pode reduzir
                new_top_k = max(4, current_top_k - 1)
        
        optimized_config = {
            "minScore": round(new_min_score, 2),
            "topK": new_top_k,
            "chunkOverlap": current_config.get("chunkOverlap", 75)
        }
        
        # Atualiza configuração se mudou
        if optimized_config != current_config:
            data["config"] = optimized_config
            
            # Registra ciclo de aprendizado para otimização
            learning_cycles = data.get("learningCycles", {})
            cycle_count = learning_cycles.get("total", 0) + 1
            learning_cycles["total"] = cycle_count
            learning_cycles["lastCycle"] = datetime.utcnow().isoformat()
            
            cycles = learning_cycles.get("cycles", [])
            cycles.append({
                "cycle": cycle_count,
                "timestamp": datetime.utcnow().isoformat(),
                "type": "config_optimization",
                "previousConfig": current_config,
                "newConfig": optimized_config
            })
            if len(cycles) > 50:
                cycles = cycles[-50:]
            learning_cycles["cycles"] = cycles
            data["learningCycles"] = learning_cycles
            
            self.save_learning_data(tenant_id)
            logger.info(f"Configuração otimizada para {tenant_id}: {optimized_config} (ciclo {cycle_count})")
        
        # Dispara adaptação de regras se necessário
        self.adapt_validation_rules(tenant_id)
        
        return optimized_config
    
    def get_optimized_prompt(self, tenant_id: str, base_prompt: str) -> str:
        """
        Retorna prompt otimizado baseado em padrões de sucesso/falha.
        
        Args:
            tenant_id: ID do tenant
            base_prompt: Prompt base
        
        Returns:
            Prompt otimizado
        """
        data = self.load_learning_data(tenant_id)
        
        # Analisa padrões de queries bem-sucedidas
        query_patterns = data.get("queryPatterns") or {}
        if not isinstance(query_patterns, dict):
            query_patterns = {}
        successful = query_patterns.get("successful") or []
        failed = query_patterns.get("failed") or []
        if not isinstance(successful, list):
            successful = []
        if not isinstance(failed, list):
            failed = []
        
        # Se há muitas falhas recentes, ajusta prompt para ser mais permissivo
        recent_failed = [q for q in failed if self._is_recent(q.get("timestamp", ""))]
        
        if len(recent_failed) > len(successful) * 0.3:  # Mais de 30% de falhas recentes
            # Adiciona instruções para ser mais permissivo
            enhancement = """
- Se o contexto contém informação parcial mas útil, forneça o que puder mesmo que não seja completo
- Priorize fornecer informação útil mesmo que não seja 100% precisa
- Se houver múltiplas fontes com informações complementares, integre todas elas
"""
            return base_prompt + enhancement
        
        return base_prompt
    
    def _is_recent(self, timestamp: str, days: int = 7) -> bool:
        """Verifica se timestamp é recente (últimos N dias)."""
        try:
            ts = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            if ts.tzinfo:
                ts = ts.replace(tzinfo=None)
            return (datetime.utcnow() - ts).days <= days
        except:
            return False
    
    def get_metrics(self, tenant_id: str) -> Dict:
        """Retorna métricas de aprendizado para um tenant."""
        data = self.load_learning_data(tenant_id)
        metrics = data.get("metrics") or {}
        if not isinstance(metrics, dict):
            metrics = {}
        learning_cycles = data.get("learningCycles", {})
        
        total = metrics.get("totalQueries", 0)
        if total == 0:
            return {
                "totalQueries": 0,
                "successRate": 0.0,
                "avgConfidence": 0.0,
                "status": "insufficient_data",
                "learningCycles": learning_cycles.get("total", 0),
                "lastCycle": learning_cycles.get("lastCycle")
            }
        
        success_rate = metrics.get("successfulQueries", 0) / total
        
        return {
            "totalQueries": total,
            "successfulQueries": metrics.get("successfulQueries", 0),
            "failedQueries": metrics.get("failedQueries", 0),
            "successRate": round(success_rate, 3),
            "avgConfidence": round(metrics.get("avgConfidence", 0.0), 3),
            "status": "good" if success_rate >= 0.85 else "needs_improvement" if success_rate >= 0.70 else "poor",
            "lastUpdated": metrics.get("lastUpdated"),
            "learningCycles": learning_cycles.get("total", 0),
            "lastCycle": learning_cycles.get("lastCycle"),
            "synonymsCount": len(data.get("synonyms", {})),
            "successfulPatterns": len((data.get("queryPatterns") or {}).get("successful") or []),
            "failedPatterns": len((data.get("queryPatterns") or {}).get("failed") or [])
        }
    
    def adapt_validation_rules(self, tenant_id: str) -> bool:
        """
        Adapta regras de validação baseado no desempenho.
        
        Args:
            tenant_id: ID do tenant
        
        Returns:
            True se adaptação foi realizada, False se atingiu limite ou acurácia
        """
        if not self.validation_rules:
            self.load_validation_rules()
        
        adaptation = self.validation_rules.get("adaptation", {})
        if not adaptation.get("enabled", True):
            return False
        
        # Verifica limite de ciclos
        cycles = self.validation_rules.get("adaptationCycles", 0)
        max_cycles = self.validation_rules.get("maxCycles", 50)
        if cycles >= max_cycles:
            logger.info(f"Limite de ciclos de adaptação atingido: {cycles}/{max_cycles}")
            return False
        
        # Calcula acurácia atual
        metrics = self.get_metrics(tenant_id)
        current_accuracy = metrics.get("successRate", 0.0)
        target_accuracy = self.validation_rules.get("targetAccuracy", 0.85)
        
        # Atualiza histórico de acurácia
        accuracy_history = adaptation.get("accuracyHistory", [])
        accuracy_history.append({
            "cycle": cycles,
            "accuracy": current_accuracy,
            "timestamp": datetime.utcnow().isoformat()
        })
        if len(accuracy_history) > 100:
            accuracy_history = accuracy_history[-100:]
        adaptation["accuracyHistory"] = accuracy_history
        
        # Verifica se atingiu acurácia alvo
        if current_accuracy >= target_accuracy:
            logger.info(f"Acurácia alvo atingida: {current_accuracy:.2%} >= {target_accuracy:.2%}")
            self.validation_rules["currentAccuracy"] = current_accuracy
            self.save_validation_rules()
            return False
        
        # Analisa padrões de queries para ajustar regras
        data = self.load_learning_data(tenant_id)
        query_patterns = data.get("queryPatterns") or {}
        if not isinstance(query_patterns, dict):
            query_patterns = {}
        successful = query_patterns.get("successful") or []
        failed = query_patterns.get("failed") or []
        if not isinstance(successful, list):
            successful = []
        if not isinstance(failed, list):
            failed = []
        
        # Analisa quais regras estão rejeitando queries válidas ou aceitando inválidas
        rule_performance = self._analyze_rule_performance(successful, failed)
        
        # Ajusta pesos das regras
        adjustment_rate = adaptation.get("adjustmentRate", 0.1)
        min_weight = adaptation.get("minWeight", 0.1)
        max_weight = adaptation.get("maxWeight", 2.0)
        
        rules = self.validation_rules.get("rules", {})
        for rule_name, performance in rule_performance.items():
            if rule_name not in rules:
                continue
            
            current_weight = rules[rule_name].get("weight", 1.0)
            
            # Se a regra está rejeitando muitas queries válidas, reduz peso
            if performance.get("false_positive_rate", 0) > 0.3:
                new_weight = max(min_weight, current_weight - adjustment_rate)
                rules[rule_name]["weight"] = new_weight
                logger.debug(f"Reduzindo peso da regra {rule_name}: {current_weight:.2f} -> {new_weight:.2f}")
            
            # Se a regra está aceitando muitas queries inválidas, aumenta peso
            elif performance.get("false_negative_rate", 0) > 0.3:
                new_weight = min(max_weight, current_weight + adjustment_rate)
                rules[rule_name]["weight"] = new_weight
                logger.debug(f"Aumentando peso da regra {rule_name}: {current_weight:.2f} -> {new_weight:.2f}")
        
        # Ajusta parâmetros específicos baseado no desempenho
        if current_accuracy < 0.5:
            # Se acurácia muito baixa, relaxa algumas regras
            if rules.get("length", {}).get("enabled", True):
                rules["length"]["minLength"] = max(5, rules["length"].get("minLength", 10) - 2)
            if rules.get("questionStructure", {}).get("enabled", True):
                rules["questionStructure"]["minMeaningfulWords"] = max(2, rules["questionStructure"].get("minMeaningfulWords", 3) - 1)
        elif current_accuracy > 0.75:
            # Se acurácia boa, pode ser mais restritivo
            if rules.get("length", {}).get("enabled", True):
                rules["length"]["minLength"] = min(15, rules["length"].get("minLength", 10) + 1)
        
        # Incrementa ciclo
        self.validation_rules["adaptationCycles"] = cycles + 1
        self.validation_rules["currentAccuracy"] = current_accuracy
        self.validation_rules["lastUpdated"] = datetime.utcnow().isoformat()
        
        self.save_validation_rules()
        
        logger.info(f"Ciclo de adaptação {cycles + 1}: Acurácia {current_accuracy:.2%}, Alvo {target_accuracy:.2%}")
        
        return True
    
    def _analyze_rule_performance(self, successful: List[Dict], failed: List[Dict]) -> Dict[str, Dict]:
        """
        Analisa desempenho de cada regra baseado em queries bem-sucedidas e falhadas.
        
        Args:
            successful: Lista de queries bem-sucedidas
            failed: Lista de queries falhadas
        
        Returns:
            Dicionário com métricas de desempenho por regra
        """
        # Por enquanto, retorna estrutura básica
        # Em implementação futura, pode analisar quais regras rejeitaram queries válidas
        # e quais aceitaram queries inválidas
        return {
            "length": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "alphanumeric": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "uuid": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "repetition": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "invalidPrefixes": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "invalidPatterns": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "genericQuestions": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "questionStructure": {"false_positive_rate": 0.0, "false_negative_rate": 0.0},
            "metadataPatterns": {"false_positive_rate": 0.0, "false_negative_rate": 0.0}
        }


# Instância global do serviço
_adaptive_learning_service: Optional[AdaptiveLearningService] = None


def get_adaptive_learning_service() -> AdaptiveLearningService:
    """Retorna instância singleton do serviço de aprendizado adaptativo."""
    global _adaptive_learning_service
    if _adaptive_learning_service is None:
        _adaptive_learning_service = AdaptiveLearningService()
    return _adaptive_learning_service

