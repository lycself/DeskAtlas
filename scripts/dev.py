"""Run the local development stack and clean it up on Ctrl+C."""

from __future__ import annotations

import fcntl
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import get_settings  # noqa: E402


def log(message: str) -> None:
    print(f"[dev] {message}", flush=True)


def listening(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def local_postgres() -> tuple[str, Path]:
    """Locate the existing cluster; never initialize or replace user data."""
    configured_data = os.environ.get("DESKATLAS_PGDATA")
    configured_ctl = os.environ.get("DESKATLAS_PG_CTL")
    if configured_data or configured_ctl:
        ctl = configured_ctl or shutil.which("pg_ctl")
        if ctl and configured_data and (Path(configured_data) / "PG_VERSION").is_file():
            return ctl, Path(configured_data)
        raise RuntimeError("请同时设置 DESKATLAS_PGDATA 和 DESKATLAS_PG_CTL，指向已有数据库及 pg_ctl。")

    for prefix in (Path("/opt/homebrew"), Path("/usr/local")):
        ctl = prefix / "opt/postgresql@17/bin/pg_ctl"
        data = prefix / "var/postgresql@17"
        if ctl.is_file() and (data / "PG_VERSION").is_file():
            return str(ctl), data
    raise RuntimeError("未找到本机 PostgreSQL 17。请设置 DESKATLAS_PGDATA 和 DESKATLAS_PG_CTL。")


class Development:
    def __init__(self) -> None:
        self.stopping = threading.Event()
        self.children: list[subprocess.Popen] = []
        self.database: tuple[str, Path] | None = None

    def request_stop(self, _signum: int, _frame: object) -> None:
        self.stopping.set()

    def prepare_database(self) -> None:
        url = make_url(get_settings().database_url)
        if url.get_backend_name() == "postgresql":
            host, port = url.host or "localhost", url.port or 5432
            if host in {"localhost", "127.0.0.1", "::1"} and port == 5432 and not listening(host, port):
                ctl, data = local_postgres()
                status = subprocess.run([ctl, "-D", str(data), "status"], capture_output=True)
                if status.returncode != 3:
                    raise RuntimeError("本机数据库状态与 DATABASE_URL 不一致，请检查数据库端口配置。")
                log("启动本机 PostgreSQL…")
                # Claim the stopped cluster before starting so partial startup is also cleaned up.
                self.database = ctl, data
                result = subprocess.run(
                    [ctl, "-D", str(data), "-l", str(data / "server.log"), "-w", "-t", "30", "start"],
                    start_new_session=True,
                )
                if result.returncode:
                    raise RuntimeError(f"数据库启动失败，请查看 {data / 'server.log'}。")
            else:
                log("连接已有数据库（退出时保留该服务）。")

        if self.stopping.is_set():
            return
        engine = create_engine(
            url, connect_args={"connect_timeout": 3} if url.get_backend_name() == "postgresql" else {},
        )
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            raise RuntimeError("数据库连接失败，请检查 .env 的 DATABASE_URL、账号及数据库是否存在。") from None
        finally:
            engine.dispose()
        log("数据库已就绪。")

    def spawn(self, command: list[str]) -> subprocess.Popen:
        child = subprocess.Popen(command, cwd=ROOT, start_new_session=True)
        self.children.append(child)
        return child

    def run(self) -> int:
        for port in (3000, 8000):
            if any(listening(host, port) for host in ("127.0.0.1", "::1")):
                raise RuntimeError(f"端口 {port} 已被占用，请先关闭之前启动的项目。")
        self.prepare_database()
        if self.stopping.is_set():
            return 0

        log("启动后端…")
        api = self.spawn([
            sys.executable, "-m", "uvicorn", "backend.app.main:app", "--reload",
            "--host", "127.0.0.1", "--port", "8000",
        ])
        deadline = time.monotonic() + 30
        while not self.stopping.is_set():
            if api.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError("后端未能启动，请查看上方错误。")
            try:
                with urlopen("http://127.0.0.1:8000/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError, OSError):
                pass
            self.stopping.wait(0.2)
        if self.stopping.is_set():
            return 0

        self.spawn(["pnpm", "dev:web"])
        log("按 Ctrl+C 同时停止前端、后端和本次启动的数据库。")
        while not self.stopping.wait(0.2):
            for child in self.children:
                if child.poll() is not None:
                    raise RuntimeError("开发服务已退出，正在关闭其余服务。")
        return 0

    def cleanup(self) -> None:
        log("正在关闭开发服务…")
        # Each service has its own process group, including Next and Uvicorn workers.
        for child in self.children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in self.children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            # Also clean up descendants if a launcher exited before its worker.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()

        if self.database:
            ctl, data = self.database
            status = subprocess.run([ctl, "-D", str(data), "status"], capture_output=True)
            if status.returncode == 0:
                log("停止本次启动的 PostgreSQL（保留全部数据）…")
                result = subprocess.run(
                    [ctl, "-D", str(data), "-m", "fast", "-w", "-t", "30", "stop"],
                    start_new_session=True,
                )
                if result.returncode:
                    raise RuntimeError(f"数据库未能正常停止，请查看 {data / 'server.log'}。")
        log("开发服务已关闭。")


def main() -> int:
    os.chdir(ROOT)
    # Prevent a second invocation from managing the same development stack.
    with (ROOT / ".venv/deskatlas-dev.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("已有 pnpm dev 正在运行，请在那个终端按 Ctrl+C 关闭。")
            return 1
        development = Development()
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, development.request_stop)
        try:
            return development.run()
        finally:
            development.cleanup()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError) as error:
        log(str(error))
        sys.exit(1)
