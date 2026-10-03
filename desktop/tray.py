"""System tray icon and menu."""

from __future__ import annotations

import logging
import threading

import pystray
from pystray import Menu, MenuItem

from . import hostos
from .controller import DesktopController
from .icons import tray_image


log = logging.getLogger(__name__)


class Tray:
    def __init__(self, controller: DesktopController) -> None:
        self.controller = controller
        self._quit_lock = threading.Lock()
        self.icon = pystray.Icon("DeskAtlas", tray_image("starting"), "DeskAtlas", menu=self._menu())
        controller.tray_status = self.set_status

    def _menu(self) -> Menu:
        controller = self.controller
        return Menu(
            MenuItem("打开状态面板", lambda: controller.show_window(), default=True),
            MenuItem("打开管理端", lambda: controller.open_target("admin")),
            MenuItem("打开学生端", lambda: controller.open_target("public")),
            Menu.SEPARATOR,
            MenuItem("立即备份", self._backup),
            MenuItem("检查更新", self._check_update),
            Menu.SEPARATOR,
            MenuItem(
                "开机自动启动",
                self._toggle_autostart,
                checked=lambda item: hostos.autostart_enabled(),
                enabled=lambda item: hostos.autostart_supported(),
            ),
            MenuItem(
                "阻止电脑睡眠",
                self._toggle_sleep,
                checked=lambda item: controller.desktop.prevent_sleep,
                enabled=lambda item: controller.keep_awake.supported,
            ),
            Menu.SEPARATOR,
            MenuItem("退出 DeskAtlas", self._quit),
        )

    def set_status(self, status: str, detail: str | None) -> None:
        try:
            self.icon.icon = tray_image(status)
            self.icon.title = "DeskAtlas" + (f" · {detail}" if detail else " · 服务运行中")
        except Exception:  # noqa: BLE001 - icon may not be visible yet
            log.debug("tray status update skipped", exc_info=True)

    def notify(self, message: str, title: str = "DeskAtlas") -> None:
        try:
            self.icon.notify(message, title)
        except Exception:  # noqa: BLE001 - notifications are best effort
            log.debug("notification failed", exc_info=True)

    def _backup(self) -> None:
        try:
            result = self.controller.backup_now("manual")
            self.notify(f"已生成备份 {result['name']}")
        except Exception as exc:  # noqa: BLE001
            log.exception("manual backup failed")
            self.notify(f"备份失败：{exc}")

    def _check_update(self) -> None:
        info = self.controller.check_update()
        labels = {"available": f"发现新版本 {info.get('latest')}，请在状态面板中更新", "latest": "已是最新版本",
                  "error": f"检查更新失败：{info.get('error')}", "unsigned": "非官方更新源必须提供签名的更新清单，已忽略"}
        self.notify(labels.get(info["status"], info["status"]))

    def _toggle_autostart(self) -> None:
        try:
            hostos.set_autostart(not hostos.autostart_enabled())
        except ValueError as exc:
            self.notify(str(exc))
        self.icon.update_menu()

    def _toggle_sleep(self) -> None:
        self.controller.update_settings({"prevent_sleep": not self.controller.desktop.prevent_sleep})
        self.icon.update_menu()

    def _quit(self) -> None:
        # Windows invokes menu actions inside the tray's native window procedure.
        # Return before opening a modal dialog or shutting down another GUI loop.
        if not self._quit_lock.acquire(blocking=False):
            return
        try:
            threading.Thread(target=self._confirm_quit, name="quit-confirm", daemon=True).start()
        except Exception:
            self._quit_lock.release()
            raise

    def _confirm_quit(self) -> None:
        try:
            if hostos.confirm("退出 DeskAtlas", "退出后学生将无法访问工位地图，确定退出吗？"):
                self.controller.request_quit()
        except Exception:  # noqa: BLE001 - keep the tray usable if a native dialog fails
            log.exception("quit failed")
            self.notify("退出失败，请查看日志后重试")
        finally:
            self._quit_lock.release()

    def run_detached(self) -> None:
        self.icon.run_detached()

    def run(self) -> None:
        self.icon.run()

    def stop(self) -> None:
        try:
            self.icon.stop()
        except Exception:  # noqa: BLE001
            log.debug("tray stop failed", exc_info=True)
