"""The status panel window: a small pywebview window that hides instead of closing."""

from __future__ import annotations

import logging
from typing import Callable

import webview

from .controller import DesktopController


log = logging.getLogger(__name__)


class PanelWindow:
    def __init__(self, controller: DesktopController) -> None:
        self.controller = controller
        self._destroying = False
        self.window = webview.create_window(
            "DeskAtlas",
            controller.panel_url(),
            width=580,
            height=780,
            min_size=(440, 560),
            text_select=False,
        )
        self.window.events.closing += self._on_closing
        controller.window = self

    def _on_closing(self) -> bool:
        if self._destroying:
            return True
        # Closing the window only hides it; the tray icon keeps the service alive.
        self.window.hide()
        return False

    def show(self) -> None:
        try:
            self.window.show()
            self.window.restore()
        except Exception:  # noqa: BLE001 - window may already be visible
            log.debug("show window failed", exc_info=True)

    def load(self, url: str) -> None:
        try:
            self.window.load_url(url)
        except Exception:  # noqa: BLE001
            log.debug("load url failed", exc_info=True)

    def run(self, on_start: Callable[[], None] | None = None) -> None:
        webview.start(on_start, private_mode=False)

    def destroy(self) -> None:
        # destroy() also fires closing; an explicit quit must not be vetoed.
        self._destroying = True
        try:
            self.window.destroy()
        except Exception:  # noqa: BLE001
            log.debug("destroy window failed", exc_info=True)
