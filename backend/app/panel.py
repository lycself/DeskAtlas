"""Loopback-only endpoints for the desktop status panel.

The desktop shell registers a controller on `app.state.panel`; the endpoints just relay to it.
Without a controller (plain server deployments) the panel reports itself unavailable.
"""

from __future__ import annotations

import socket
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .version import VERSION


router = APIRouter(prefix="/api/panel")
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


class PanelController(Protocol):
    def state(self) -> dict[str, Any]: ...
    def update_settings(self, changes: dict[str, Any]) -> dict[str, Any]: ...
    def backup_now(self) -> dict[str, Any]: ...
    def open_target(self, target: str) -> None: ...
    def check_update(self) -> dict[str, Any]: ...
    def apply_update(self) -> dict[str, Any]: ...
    def show_window(self) -> None: ...


class PanelSettings(BaseModel):
    port: int | None = Field(default=None, ge=1, le=65535)
    public_address: str | None = Field(default=None, max_length=200)
    autostart: bool | None = None
    prevent_sleep: bool | None = None
    auto_backup: bool | None = None
    backup_keep: int | None = Field(default=None, ge=1, le=365)
    update_url: str | None = Field(default=None, max_length=500)


def lan_addresses() -> list[dict[str, Any]]:
    """Non-loopback IPv4 addresses of this machine, with the primary outbound one first."""
    primary = None
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("10.255.255.255", 1))
            primary = probe.getsockname()[0]
        finally:
            probe.close()
    except OSError:
        primary = None
    found: list[str] = []
    if primary and not primary.startswith("127."):
        found.append(primary)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = info[4][0]
            if address not in found and not address.startswith(("127.", "169.254.")):
                found.append(address)
    except OSError:
        pass
    return [{"address": address, "primary": index == 0} for index, address in enumerate(found)]


def require_loopback(request: Request) -> None:
    host = request.client.host if request.client else None
    if host not in LOOPBACK_HOSTS:
        raise HTTPException(status_code=403, detail="状态面板只能在本机打开")


def controller(request: Request) -> PanelController:
    require_loopback(request)
    instance = getattr(request.app.state, "panel", None)
    if instance is None:
        raise HTTPException(status_code=503, detail="当前不是桌面模式，没有可用的状态面板")
    return instance


def relay(action, *args):
    """Run a controller action, turning validation problems into 422 responses."""
    try:
        return action(*args)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/state")
def panel_state(request: Request) -> dict[str, Any]:
    require_loopback(request)
    instance = getattr(request.app.state, "panel", None)
    if instance is None:
        return {"available": False, "version": VERSION, "addresses": lan_addresses()}
    return {"available": True, **instance.state()}


@router.put("/settings")
def panel_settings(payload: PanelSettings, request: Request) -> dict[str, Any]:
    changes = payload.model_dump(exclude_none=True)
    return relay(controller(request).update_settings, changes)


@router.post("/backup")
def panel_backup(request: Request) -> dict[str, Any]:
    return relay(controller(request).backup_now)


@router.post("/open")
def panel_open(request: Request, target: str = Query(pattern=r"^(data|backups|logs|admin|public)$")) -> dict[str, Any]:
    relay(controller(request).open_target, target)
    return {"opened": target}


@router.post("/update/check")
def panel_update_check(request: Request) -> dict[str, Any]:
    return relay(controller(request).check_update)


@router.post("/update/apply")
def panel_update_apply(request: Request) -> dict[str, Any]:
    return relay(controller(request).apply_update)


@router.post("/show")
def panel_show(request: Request) -> dict[str, Any]:
    relay(controller(request).show_window)
    return {"shown": True}


@router.get("/qr.svg")
def panel_qr(request: Request, text: str = Query(min_length=1, max_length=300)) -> Response:
    require_loopback(request)
    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise HTTPException(status_code=501, detail="二维码组件未安装") from exc
    image = qrcode.make(text, image_factory=SvgPathImage, box_size=12, border=1)
    return Response(content=image.to_string(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})
