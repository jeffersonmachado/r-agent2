"""
Serviço de Processamento de Linguagem Natural (NLP).

Responsabilidades:
- Normalização de texto
- Extração de entidades
- Análise de intenção
- Expansão de sinônimos
- Melhoria de queries
"""

import re
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import unicodedata

logger = logging.getLogger(__name__)


class NLPResult:
    """Resultado do processamento NLP."""
    
    def __init__(self):
        self.original_text: str = ""
        self.normalized_text: str = ""
        self.entities: Dict[str, List[str]] = {}
        self.intent: Optional[str] = None
        self.sentiment: Optional[str] = None
        self.keywords: List[str] = []
        self.expanded_query: str = ""
        self.confidence: float = 0.0


def normalize_text(text: str) -> str:
    """
    Normaliza texto para melhor busca.
    
    - Remove acentos
    - Converte para lowercase
    - Remove caracteres especiais desnecessários
    - Remove espaços extras
    """
    if not text:
        return ""
    
    # Remove acentos
    text = unicodedata.normalize('NFD', text)
    text = ''.join(char for char in text if unicodedata.category(char) != 'Mn')
    
    # Converte para lowercase
    text = text.lower()
    
    # Remove caracteres especiais, mantém letras, números e espaços
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    
    # Remove espaços extras
    text = re.sub(r'\s+', ' ', text)
    
    return text.strip()


def extract_entities(text: str) -> Dict[str, List[str]]:
    """
    Extrai entidades do texto.
    
    Retorna:
    - emails: Lista de emails
    - phones: Lista de telefones
    - dates: Lista de datas
    - numbers: Lista de números
    - urls: Lista de URLs
    - keywords: Palavras-chave importantes
    """
    entities = {
        'emails': [],
        'phones': [],
        'dates': [],
        'numbers': [],
        'urls': [],
        'keywords': []
    }
    
    # Email
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    entities['emails'] = re.findall(email_pattern, text, re.IGNORECASE)
    
    # Telefone (formato brasileiro e internacional)
    phone_pattern = r'(\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}'
    entities['phones'] = re.findall(phone_pattern, text)
    # Limpa telefones
    entities['phones'] = [re.sub(r'[-.\s()]', '', phone) for phone in entities['phones'] if phone.strip()]
    
    # Datas (formato DD/MM/YYYY, DD-MM-YYYY, etc)
    date_pattern = r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'
    entities['dates'] = re.findall(date_pattern, text)
    
    # Números (valores monetários, quantidades)
    number_pattern = r'\b\d+[.,]?\d*\b'
    entities['numbers'] = re.findall(number_pattern, text)
    
    # URLs
    url_pattern = r'https?://[^\s]+|www\.[^\s]+'
    entities['urls'] = re.findall(url_pattern, text)
    
    # Palavras-chave (palavras com 4+ caracteres, não muito comuns)
    stopwords = {'como', 'para', 'com', 'que', 'uma', 'mais', 'muito', 'sobre', 'sobre', 
                 'isso', 'isso', 'quando', 'onde', 'qual', 'quais', 'este', 'esta', 
                 'esse', 'essa', 'aqui', 'lá', 'então', 'mas', 'por', 'porque', 'se'}
    
    words = re.findall(r'\b[a-záàâãéêíóôõúç]{4,}\b', text.lower())
    entities['keywords'] = [w for w in words if w not in stopwords and len(w) >= 4]
    
    return entities


def analyze_intent(text: str) -> Tuple[Optional[str], float]:
    """
    Analisa a intenção do texto.
    
    Retorna: (intent, confidence)
    
    Intenções possíveis:
    - question: Pergunta
    - complaint: Reclamação
    - request: Solicitação
    - greeting: Saudação
    - goodbye: Despedida
    - information: Busca de informação
    - support: Pedido de suporte
    """
    text_lower = text.lower()
    
    # Padrões de intenção
    intent_patterns = {
        'question': [
            r'\b(como|quando|onde|qual|quais|por que|porque|o que|quem)\b',
            r'\?',
            r'\b(pode|poderia|seria|é possível)\b.*\?'
        ],
        'complaint': [
            r'\b(reclamação|reclamar|problema|erro|falha|não funciona|não está funcionando)\b',
            r'\b(ruim|péssimo|horrível|insatisfeito)\b'
        ],
        'request': [
            r'\b(quero|preciso|gostaria|solicito|pedido)\b',
            r'\b(fazer|fazer|realizar|executar)\b'
        ],
        'greeting': [
            r'\b(olá|oi|bom dia|boa tarde|boa noite|olá|hey)\b'
        ],
        'goodbye': [
            r'\b(tchau|até|até logo|até breve|obrigado|obrigada)\b'
        ],
        'information': [
            r'\b(quero saber|preciso saber|informação|dados|detalhes)\b',
            r'\b(sobre|acerca|a respeito)\b'
        ],
        'support': [
            r'\b(suporte|ajuda|assistência|atendimento|socorro)\b',
            r'\b(problema|dificuldade|dúvida)\b'
        ]
    }
    
    scores = {}
    for intent, patterns in intent_patterns.items():
        score = 0.0
        for pattern in patterns:
            matches = len(re.findall(pattern, text_lower))
            score += matches * 0.3
        
        if score > 0:
            scores[intent] = score
    
    if not scores:
        return None, 0.0
    
    # Retorna intenção com maior score
    best_intent = max(scores.items(), key=lambda x: x[1])
    confidence = min(1.0, best_intent[1])
    
    return best_intent[0], confidence


def analyze_sentiment(text: str) -> Tuple[Optional[str], float]:
    """
    Analisa sentimento do texto (simplificado).
    
    Retorna: (sentiment, confidence)
    
    Sentimentos:
    - positive: Positivo
    - negative: Negativo
    - neutral: Neutro
    """
    text_lower = text.lower()
    
    positive_words = ['bom', 'ótimo', 'excelente', 'perfeito', 'gostei', 'satisfeito', 
                     'feliz', 'obrigado', 'obrigada', 'grato', 'gratidão', 'amor', 
                     'adoro', 'maravilhoso', 'fantástico', 'incrível']
    
    negative_words = ['ruim', 'péssimo', 'horrível', 'terrível', 'odiei', 'insatisfeito',
                     'triste', 'raiva', 'frustrado', 'decepcionado', 'problema', 'erro',
                     'falha', 'não funciona', 'não gostei']
    
    positive_count = sum(1 for word in positive_words if word in text_lower)
    negative_count = sum(1 for word in negative_words if word in text_lower)
    
    if positive_count > negative_count:
        confidence = min(1.0, positive_count * 0.2)
        return 'positive', confidence
    elif negative_count > positive_count:
        confidence = min(1.0, negative_count * 0.2)
        return 'negative', confidence
    else:
        return 'neutral', 0.5


def expand_query(text: str, entities: Dict[str, List[str]]) -> str:
    """
    Expande query com sinônimos e entidades relevantes.
    
    Adiciona variações e termos relacionados para melhorar busca.
    """
    # Sinônimos comuns (pode ser expandido com dicionário)
    synonyms = {
        'preço': ['valor', 'custo', 'quanto custa'],
        'produto': ['item', 'artigo', 'mercadoria'],
        'pedido': ['compra', 'encomenda', 'solicitação'],
        'entrega': ['envio', 'frete', 'shipping'],
        'cancelar': ['cancelamento', 'desistir', 'anular'],
        'devolver': ['devolução', 'retornar', 'reembolso'],
        'problema': ['erro', 'falha', 'bug', 'dificuldade'],
        'ajuda': ['suporte', 'assistência', 'socorro']
    }
    
    expanded_terms = [text]
    
    # Adiciona sinônimos
    text_lower = text.lower()
    for word, syns in synonyms.items():
        if word in text_lower:
            expanded_terms.extend(syns)
    
    # Adiciona entidades relevantes
    if entities.get('keywords'):
        expanded_terms.extend(entities['keywords'][:3])  # Limita a 3 keywords
    
    # Combina termos expandidos
    expanded = ' '.join(expanded_terms)
    
    return expanded


def process_nlp(text: str, expand: bool = True) -> NLPResult:
    """
    Processa texto completo com NLP.
    
    Args:
        text: Texto a processar
        expand: Se deve expandir query com sinônimos
    
    Returns:
        NLPResult com todos os dados processados
    """
    result = NLPResult()
    result.original_text = text
    
    if not text or not text.strip():
        logger.warning("Texto vazio fornecido para processamento NLP")
        return result
    
    # Normalização
    result.normalized_text = normalize_text(text)
    
    # Extração de entidades
    result.entities = extract_entities(text)
    
    # Análise de intenção
    intent, intent_confidence = analyze_intent(text)
    result.intent = intent
    result.confidence = intent_confidence
    
    # Análise de sentimento
    sentiment, sentiment_confidence = analyze_sentiment(text)
    result.sentiment = sentiment
    
    # Expansão de query
    if expand:
        result.expanded_query = expand_query(text, result.entities)
    else:
        result.expanded_query = result.normalized_text
    
    logger.debug(f"NLP processado: intent={intent}, sentiment={sentiment}, entities={len(result.entities)}")
    
    return result


def improve_query_for_rag(original_query: str) -> str:
    """
    Melhora query para busca RAG.
    
    - Normaliza
    - Remove stopwords muito comuns
    - Mantém termos importantes
    - Adiciona contexto se necessário
    """
    # Normaliza
    normalized = normalize_text(original_query)
    
    # Remove stopwords muito comuns (mas mantém contexto)
    stopwords = {'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
                 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem',
                 'que', 'qual', 'quais', 'este', 'esta', 'esse', 'essa'}
    
    words = normalized.split()
    important_words = [w for w in words if w not in stopwords and len(w) >= 3]
    
    # Se ficou muito curto, mantém original normalizado
    if len(important_words) < 2:
        return normalized
    
    return ' '.join(important_words)

