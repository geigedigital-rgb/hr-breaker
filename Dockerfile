FROM python:3.11-slim

WORKDIR /app

# системные библиотеки (иначе билд упадет)
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

COPY . .

RUN pip install --upgrade pip
COPY pyproject.toml .
COPY README.md .

RUN pip install .

COPY . .

# установить браузеры playwright
RUN python -m playwright install --with-deps

EXPOSE 8501

CMD streamlit run src/hr_breaker/main.py \
    --server.port=$PORT \
    --server.address=0.0.0.0
