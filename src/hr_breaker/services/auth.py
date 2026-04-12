"""
Auth: JWT and password hashing. Uses bcrypt and PyJWT (pip install 'hr-breaker[auth]' or passlib[bcrypt], pyjwt[crypto]).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from hr_breaker.config import get_settings

logger = logging.getLogger(__name__)

# bcrypt limit; truncate to avoid ValueError
BCRYPT_MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    """Hash password with bcrypt (direct bcrypt, not passlib, for compatibility with newer bcrypt)."""
    try:
        import bcrypt
    except ImportError:
        raise RuntimeError("bcrypt not installed. Install: pip install 'passlib[bcrypt]' or bcrypt")
    raw = password.encode("utf-8")
    if len(raw) > BCRYPT_MAX_PASSWORD_BYTES:
        raw = raw[:BCRYPT_MAX_PASSWORD_BYTES]
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify password against bcrypt hash."""
    try:
        import bcrypt
    except ImportError:
        return False
    raw = plain.encode("utf-8")
    if len(raw) > BCRYPT_MAX_PASSWORD_BYTES:
        raw = raw[:BCRYPT_MAX_PASSWORD_BYTES]
    try:
        return bcrypt.checkpw(raw, hashed.encode("ascii"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    """Create JWT for user."""
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed. Install: pip install 'hr-breaker[auth]'")
    settings = get_settings()
    if not settings.jwt_secret:
        raise ValueError("JWT_SECRET not set in .env")
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(
        payload,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def create_email_unsubscribe_token(user_id: str) -> str:
    """Long-lived JWT for one-click unsubscribe from marketing email (no login)."""
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed. Install: pip install 'hr-breaker[auth]'")
    settings = get_settings()
    if not settings.jwt_secret:
        raise ValueError("JWT_SECRET not set in .env")
    now = datetime.utcnow()
    payload = {
        "sub": user_id,
        "purpose": "email_unsub",
        "exp": now + timedelta(days=365),
        "iat": now,
    }
    return jwt.encode(
        payload,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> dict[str, Any] | None:
    """Decode JWT; return payload or None if invalid."""
    try:
        import jwt
    except ImportError:
        return None
    settings = get_settings()
    if not settings.jwt_secret:
        return None
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except Exception:
        return None
