from .base import BaseFilter
from .registry import FilterRegistry
from .content_length import ContentLengthChecker
from .data_validator import DataValidator
from .llm_checker import LLMChecker
from .keyword_matcher import KeywordMatcher, check_keywords
from .hallucination_checker import HallucinationChecker
from .ai_generated_checker import AIGeneratedChecker

# VectorSimilarityMatcher imports sentence-transformers (heavy / can hang on some Macs).
# Load lazily so API startup does not block on it.
def __getattr__(name: str):
    if name == "VectorSimilarityMatcher":
        from .vector_similarity_matcher import VectorSimilarityMatcher

        return VectorSimilarityMatcher
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "BaseFilter",
    "FilterRegistry",
    "ContentLengthChecker",
    "DataValidator",
    "LLMChecker",
    "KeywordMatcher",
    "VectorSimilarityMatcher",
    "HallucinationChecker",
    "AIGeneratedChecker",
    "check_keywords",
]
