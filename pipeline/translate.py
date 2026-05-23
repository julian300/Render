from __future__ import annotations


def translate(text: str, target_language: str = "en-US") -> str:
    """Translate Japanese text to target language. Default implementation covers JA->EN."""
    if not text.strip():
        return ""

    if not target_language.lower().startswith("en"):
        return text

    try:
        from transformers import pipeline  # type: ignore

        translator = pipeline("translation", model="Helsinki-NLP/opus-mt-ja-en")
        translated = translator(text)
        return str(translated[0]["translation_text"]).strip()
    except Exception:
        # Fallback keeps pipeline running in environments without models.
        return f"[EN] {text}"
