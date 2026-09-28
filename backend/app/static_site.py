"""Serve the exported Next.js site from FastAPI so one process hosts everything."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response


IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"


def resolve_static(static_dir: Path, path: str) -> tuple[Path, int] | None:
    """Map a request path to a file the way Next.js expects (`/a` -> a.html or a/index.html)."""
    clean = path.strip("/")
    if any(part in {"", ".", ".."} for part in clean.split("/")) and clean:
        return None
    root = static_dir.resolve()
    base = (root / clean).resolve() if clean else root
    try:
        base.relative_to(root)
    except ValueError:
        return None
    candidates = [base, base.with_suffix(base.suffix + ".html"), base / "index.html"] if clean else [root / "index.html"]
    for candidate in candidates:
        if candidate.is_file():
            return candidate, 200
    fallback = root / "404.html"
    if fallback.is_file():
        return fallback, 404
    return None


def install_static_site(app: FastAPI, static_dir: Path) -> None:
    @app.get("/{path:path}", include_in_schema=False)
    async def static_site(path: str, request: Request) -> Response:
        if path.startswith("api/") or path == "api":
            raise HTTPException(status_code=404, detail="接口不存在")
        resolved = resolve_static(static_dir, path)
        if resolved is None:
            raise HTTPException(status_code=404, detail="页面不存在")
        file, status = resolved
        cache = IMMUTABLE if path.startswith("_next/static/") else NO_CACHE
        return FileResponse(file, status_code=status, headers={"Cache-Control": cache})
