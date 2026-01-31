FROM python:3.11-slim

WORKDIR /app

# Системные библиотеки для WeasyPrint и сборки
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    gcc \
    libffi-dev \
    libcairo2 \
    libpango-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

# Сначала только метаданные для кэша слоёв
COPY pyproject.toml README.md ./
COPY src/ ./src/

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# Установка браузеров Playwright (для скрапера)
RUN python -m playwright install --with-deps

# Переменная для облачных платформ (Heroku, Cloud Run и т.д.)
ENV PORT=8501

EXPOSE 8501

CMD streamlit run src/hr_breaker/main.py \
    --server.port=${PORT} \
    --server.address=0.0.0.0
