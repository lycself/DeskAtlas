"""Run uvicorn on a background thread with clean start, stop, and restart."""

from __future__ import annotations

import logging
import socket
import threading
import time

import uvicorn


log = logging.getLogger(__name__)


def port_available(port: int, host: str = "0.0.0.0") -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


class ServerThread:
    def __init__(self, app, host: str = "0.0.0.0") -> None:
        self.app = app
        self.host = host
        self.port: int | None = None
        self.error: str | None = None
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return bool(self._server and self._server.started and self._thread and self._thread.is_alive())

    def start(self, port: int, timeout: float = 30.0) -> None:
        if self.running:
            raise RuntimeError("服务已经在运行")
        if not port_available(port, self.host):
            self.error = f"端口 {port} 已被其他程序占用"
            raise ValueError(self.error)
        # Only the local HTTPS proxy may set the client address: the login limit and the loopback-only
        # panel both judge requests by it, so never widen forwarded_allow_ips (or let the environment do so).
        config = uvicorn.Config(self.app, host=self.host, port=port, log_config=None, access_log=False, lifespan="on",
                                proxy_headers=True, forwarded_allow_ips="127.0.0.1")
        server = uvicorn.Server(config)
        failure: list[str] = []

        def run() -> None:
            try:
                server.run()
            except BaseException as exc:  # noqa: BLE001 - surface every failure to the panel
                failure.append(f"{type(exc).__name__}: {exc}")
                log.exception("server thread crashed")

        thread = threading.Thread(target=run, name=f"uvicorn-{port}", daemon=True)
        self._server, self._thread, self.port, self.error = server, thread, port, None
        thread.start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if server.started:
                log.info("serving on %s:%s", self.host, port)
                return
            if not thread.is_alive():
                break
            time.sleep(0.1)
        self.error = failure[0] if failure else "服务启动超时"
        self._server = None
        raise ValueError(self.error)

    def stop(self, timeout: float = 15.0) -> None:
        server, thread = self._server, self._thread
        if server is None:
            return
        server.should_exit = True
        if thread is not None:
            thread.join(timeout)
        self._server = None
        self._thread = None
        log.info("server stopped")

    def restart(self, port: int) -> None:
        previous = self.port
        self.stop()
        try:
            self.start(port)
        except ValueError:
            if previous is not None:
                self.start(previous)
            raise
