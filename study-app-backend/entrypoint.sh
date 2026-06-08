#!/bin/sh
set -e

echo "Running database migrations..."
if ! alembic upgrade head; then
    echo "WARNING: Migration failed. Check DATABASE_URL. Starting server anyway so logs are visible."
fi

echo "Starting server..."
export CUDA_VISIBLE_DEVICES=""
export TOKENIZERS_PARALLELISM=false
exec uvicorn src.main:app --host 0.0.0.0 --port "${PORT:-8000}"
