import logging

from src.config import settings


def get_logger(name: str) -> logging.Logger:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return logging.getLogger(name)
