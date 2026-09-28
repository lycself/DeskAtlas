"""Operating-system integration: single instance, dialogs, sleep prevention, autostart, opening things."""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

from backend.app.config import is_frozen


log = logging.getLogger(__name__)
APP_NAME = "DeskAtlas"
IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
CREATE_NO_WINDOW = 0x08000000 if IS_WINDOWS else 0


def executable_command() -> list[str]:
    """Command that launches this desktop app again (for autostart entries)."""
    if is_frozen():
        return [sys.executable]
    return [sys.executable, "-m", "desktop"]


# --- single instance -------------------------------------------------------

class InstanceLock:
    def __init__(self, data_dir: Path) -> None:
        self._handle = None
        self._file = None
        self.data_dir = data_dir

    def acquire(self) -> bool:
        if IS_WINDOWS:
            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            self._handle = kernel32.CreateMutexW(None, False, f"Local\\{APP_NAME}.SingleInstance")
            already = kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS
            return not already
        import fcntl

        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._file = (self.data_dir / "desktop.lock").open("w")
        try:
            fcntl.flock(self._file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True

    def release(self) -> None:
        if self._file is not None:
            self._file.close()
        if self._handle:
            ctypes.windll.kernel32.CloseHandle(self._handle)  # type: ignore[attr-defined]


# --- dialogs ---------------------------------------------------------------

def confirm(title: str, message: str) -> bool:
    if IS_WINDOWS:
        MB_YESNO, MB_ICONQUESTION, MB_SETFOREGROUND, MB_TOPMOST = 0x4, 0x20, 0x10000, 0x40000
        result = ctypes.windll.user32.MessageBoxW(None, message, title, MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND | MB_TOPMOST)  # type: ignore[attr-defined]
        return result == 6  # IDYES
    if IS_MAC:
        script = f'display dialog "{message}" with title "{title}" buttons {{"取消", "确定"}} default button "确定"'
        try:
            completed = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            return True
        return completed.returncode == 0 and "确定" in completed.stdout
    return True


def alert(title: str, message: str) -> None:
    if IS_WINDOWS:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x40 | 0x10000 | 0x40000)  # type: ignore[attr-defined]
    elif IS_MAC:
        subprocess.run(["osascript", "-e", f'display dialog "{message}" with title "{title}" buttons {{"确定"}} default button "确定"'], capture_output=True, timeout=120)
    else:
        log.info("%s: %s", title, message)


# --- keep awake ------------------------------------------------------------

class KeepAwake:
    """Prevent system sleep while enabled. Windows requires the flag to live on one long-lived thread."""

    def __init__(self) -> None:
        self.supported = IS_WINDOWS or IS_MAC
        self.enabled = False
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._process: subprocess.Popen | None = None
        self._thread = threading.Thread(target=self._run, name="keep-awake", daemon=True) if IS_WINDOWS else None
        if self._thread:
            self._thread.start()

    def set(self, enabled: bool) -> None:
        self.enabled = enabled and self.supported
        if IS_WINDOWS:
            self._wake.set()
        elif IS_MAC:
            if self.enabled and self._process is None:
                self._process = subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
            elif not self.enabled and self._process is not None:
                self._process.terminate()
                self._process = None

    def close(self) -> None:
        self._stop.set()
        self.set(False)
        if self._thread:
            self._wake.set()

    def _run(self) -> None:  # Windows only
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        while not self._stop.is_set():
            self._wake.wait()
            self._wake.clear()
            flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if self.enabled else 0)
            kernel32.SetThreadExecutionState(flags)
        kernel32.SetThreadExecutionState(ES_CONTINUOUS)


# --- autostart -------------------------------------------------------------

def _startup_shortcut() -> Path:
    appdata = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / f"{APP_NAME}.lnk"


def _launch_agent() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / "com.deskatlas.desktop.plist"


def autostart_supported() -> bool:
    return is_frozen() and (IS_WINDOWS or IS_MAC)


def autostart_enabled() -> bool:
    if IS_WINDOWS:
        return _startup_shortcut().exists()
    if IS_MAC:
        return _launch_agent().exists()
    return False


def set_autostart(enabled: bool) -> None:
    if not autostart_supported():
        raise ValueError("当前运行方式不支持开机自启")
    if IS_WINDOWS:
        shortcut = _startup_shortcut()
        if not enabled:
            shortcut.unlink(missing_ok=True)
            return
        shortcut.parent.mkdir(parents=True, exist_ok=True)
        target = sys.executable
        script = (
            "$shell = New-Object -ComObject WScript.Shell; "
            f"$link = $shell.CreateShortcut('{shortcut}'); "
            f"$link.TargetPath = '{target}'; "
            f"$link.WorkingDirectory = '{Path(target).parent}'; "
            f"$link.Description = '{APP_NAME}'; "
            "$link.Save()"
        )
        completed = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                                   capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
        if completed.returncode != 0 or not shortcut.exists():
            raise ValueError(f"无法创建开机启动项：{completed.stderr.strip() or '未知错误'}")
        return
    plist = _launch_agent()
    if not enabled:
        plist.unlink(missing_ok=True)
        return
    plist.parent.mkdir(parents=True, exist_ok=True)
    arguments = "".join(f"<string>{item}</string>" for item in executable_command())
    plist.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>'
        "<key>Label</key><string>com.deskatlas.desktop</string>"
        f"<key>ProgramArguments</key><array>{arguments}</array>"
        "<key>RunAtLoad</key><true/>"
        "</dict></plist>\n",
        encoding="utf-8",
    )


# --- opening things --------------------------------------------------------

def open_path(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True) if path.suffix == "" else path.parent.mkdir(parents=True, exist_ok=True)
    if IS_WINDOWS:
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif IS_MAC:
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def open_url(url: str) -> None:
    webbrowser.open(url, new=2)


def run_installer(path: Path) -> None:
    """Start a downloaded Inno Setup package silently; it closes and relaunches DeskAtlas itself."""
    if not IS_WINDOWS:
        raise ValueError("自动安装更新只支持 Windows")
    subprocess.Popen(
        [str(path), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"],
        close_fds=True,
        creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    )
