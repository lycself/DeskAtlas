"""Entry point for the DeskAtlas desktop application."""

from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import sys
import threading
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="deskatlas", description="DeskAtlas 桌面版")
    parser.add_argument("--data-dir", type=Path, default=None, help="数据目录（默认使用当前用户的应用数据目录）")
    parser.add_argument("--no-window", action="store_true", help="不打开状态面板窗口，只显示托盘图标")
    parser.add_argument("--port", type=int, default=None, help="覆盖设置中的端口（不保存）")
    return parser.parse_args(argv)


def setup_logging(log_dir: Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s %(levelname)-5s [%(name)s] %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    file_handler = logging.handlers.RotatingFileHandler(log_dir / "deskatlas.log", maxBytes=2 * 1024 * 1024, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)
    if sys.stderr is not None:
        stream = logging.StreamHandler(sys.stderr)
        stream.setFormatter(formatter)
        root.addHandler(stream)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def notify_existing_instance(port: int) -> bool:
    try:
        with urlopen(Request(f"http://127.0.0.1:{port}/api/panel/show", method="POST"), timeout=3) as response:
            return response.status == 200
    except (URLError, OSError):
        return False


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.data_dir:
        os.environ["DESKATLAS_DATA_DIR"] = str(args.data_dir.expanduser().resolve())
    elif not os.environ.get("DESKATLAS_DATA_DIR") and not getattr(sys, "frozen", False):
        from backend.app.config import default_data_dir

        os.environ["DESKATLAS_DATA_DIR"] = str(default_data_dir())

    # Import after the data directory is fixed: settings and the engine are created on import.
    from backend.app.config import get_settings

    settings = get_settings()
    assert settings.data_dir is not None
    setup_logging(settings.log_dir)
    log = logging.getLogger("desktop")

    from .settings import DesktopSettings

    desktop = DesktopSettings.load(settings.data_dir / "settings.json")
    if args.port:
        desktop.port = args.port

    from .hostos import InstanceLock, alert, prepare_native_graphics

    prepare_native_graphics()

    lock = InstanceLock(settings.data_dir)
    if not lock.acquire():
        if not notify_existing_instance(desktop.port):
            alert("DeskAtlas", "DeskAtlas 已经在运行，请在任务栏右下角找到它的图标。")
        return 0

    from backend.app.database import engine
    from backend.app.main import app

    from .controller import DesktopController
    from .tray import Tray

    controller = DesktopController(app, settings, desktop, engine)
    app.state.panel = controller
    tray = Tray(controller)  # registered first so the icon reflects the server state from the start
    controller.start()
    window = None
    finished = threading.Event()

    def quit_app() -> None:
        if finished.is_set():
            return
        finished.set()
        log.info("quit requested")
        controller.shutdown()
        tray.stop()
        if window is not None:
            window.destroy()

    controller.quit_requested = quit_app

    if not args.no_window:
        try:
            from .window import PanelWindow

            window = PanelWindow(controller)
        except Exception as exc:  # noqa: BLE001 - fall back to the browser when no webview is available
            log.warning("panel window unavailable, using the browser instead: %s", exc)
            window = None

    try:
        if window is not None:
            tray.run_detached()
            window.run()
        else:
            tray.run()
    finally:
        quit_app()
        lock.release()
    return 0
