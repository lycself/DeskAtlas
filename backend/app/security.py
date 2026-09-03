from __future__ import annotations

import secrets
import time
from collections import defaultdict, deque

from fastapi import Cookie, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pwdlib import PasswordHash

from .config import get_settings


password_hash = PasswordHash.recommended()
settings = get_settings()
attempts: dict[str, deque[float]] = defaultdict(deque)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return password_hash.verify(password, hashed)
    except Exception:
        return False


def _serializer() -> URLSafeTimedSerializer:
    if not settings.session_secret:
        raise RuntimeError("SESSION_SECRET is not configured")
    return URLSafeTimedSerializer(settings.session_secret, salt="deskatlas-admin-session")


def create_session(username: str) -> str:
    return _serializer().dumps({"username": username, "nonce": secrets.token_hex(8)})


def read_session(token: str) -> str | None:
    try:
        data = _serializer().loads(token, max_age=settings.session_max_age_seconds)
    except (BadSignature, SignatureExpired, RuntimeError):
        return None
    username = data.get("username")
    return username if username == settings.admin_username else None


def require_admin(admin_session: str | None = Cookie(default=None)) -> str:
    if not admin_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录管理员账号")
    username = read_session(admin_session)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="管理员会话已失效")
    return username


def check_login_rate_limit(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    bucket = attempts[key]
    while bucket and now - bucket[0] > 300:
        bucket.popleft()
    if len(bucket) >= 8:
        raise HTTPException(status_code=429, detail="登录失败次数过多，请稍后再试")
    bucket.append(now)


def clear_login_attempts(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    attempts.pop(key, None)

