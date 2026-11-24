"""Operating-system integration: single instance, dialogs, sleep prevention, autostart, opening things."""

from __future__ import annotations

import ctypes
import logging
import os
import shutil
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
IS_LINUX = sys.platform.startswith("linux")


def prepare_native_graphics() -> None:
    if IS_LINUX and is_frozen():
        # PyInstaller caches reference excluded graphics libraries; the deb uses the host's loaders and typelibs.
        for key in ("GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR", "GI_TYPELIB_PATH", "GTK_PATH", "GIO_MODULE_DIR"):
            os.environ.pop(key, None)


def external_environment() -> dict[str, str]:
    """System desktop tools must load system libraries rather than PyInstaller's copies."""
    env = os.environ.copy()
    if "LD_LIBRARY_PATH_ORIG" in env:
        env["LD_LIBRARY_PATH"] = env["LD_LIBRARY_PATH_ORIG"]
    else:
        env.pop("LD_LIBRARY_PATH", None)
    return env


def executable_command() -> list[str]:
    """Command that launches this desktop app again (for autostart entries)."""
    if is_frozen():
        return [sys.executable]
    return [sys.executable, "-m", "desktop"]


# --- single instance -------------------------------------------------------

INSTANCE_MUTEX = f"Local\\{APP_NAME}.SingleInstance"
# The installer (installer\DeskAtlas.iss) sets this event to ask a running copy to quit before it
# replaces DeskAtlas.exe; Windows refuses to overwrite an executable that is still running.
QUIT_EVENT = f"Local\\{APP_NAME}.Quit"


class InstanceLock:
    def __init__(self, data_dir: Path) -> None:
        self._handle = None
        self._quit_event = None
        self._file = None
        self.data_dir = data_dir

    def acquire(self) -> bool:
        if IS_WINDOWS:
            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            self._handle = kernel32.CreateMutexW(None, False, INSTANCE_MUTEX)
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

    def on_quit_signal(self, callback) -> None:
        """Call `callback` once the installer asks this instance to quit (Windows only)."""
        if not IS_WINDOWS:
            return
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        kernel32.CreateEventW.restype = ctypes.c_void_p
        handle = kernel32.CreateEventW(None, True, False, QUIT_EVENT)  # manual reset, initially unset
        if not handle:
            log.warning("quit event unavailable; the installer will have to end DeskAtlas itself")
            return
        self._quit_event = handle

        def wait() -> None:
            if kernel32.WaitForSingleObject(ctypes.c_void_p(handle), 0xFFFFFFFF) == 0:  # WAIT_OBJECT_0
                log.info("installer asked DeskAtlas to quit")
                callback()

        threading.Thread(target=wait, name="installer-quit", daemon=True).start()

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
    if IS_LINUX:
        try:
            return subprocess.run(["zenity", "--question", f"--title={title}", f"--text={message}"],
                                  env=external_environment(), timeout=120).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False
    return True


def alert(title: str, message: str) -> None:
    if IS_WINDOWS:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x40 | 0x10000 | 0x40000)  # type: ignore[attr-defined]
    elif IS_MAC:
        subprocess.run(["osascript", "-e", f'display dialog "{message}" with title "{title}" buttons {{"确定"}} default button "确定"'], capture_output=True, timeout=120)
    elif IS_LINUX:
        try:
            subprocess.run(["zenity", "--info", f"--title={title}", f"--text={message}"],
                           env=external_environment(), timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            log.warning("%s: %s", title, message)
    else:
        log.info("%s: %s", title, message)


# --- keep awake ------------------------------------------------------------

class KeepAwake:
    """Prevent system sleep while enabled. Windows requires the flag to live on one long-lived thread."""

    def __init__(self) -> None:
        self.supported = IS_WINDOWS or IS_MAC or (IS_LINUX and bool(shutil.which("systemd-inhibit")))
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
        elif IS_LINUX:
            if self.enabled and self._process is None:
                self._process = subprocess.Popen(
                    ["systemd-inhibit", "--what=sleep", "--who=DeskAtlas", "--why=Serving the office map", "sleep", "infinity"],
                    env=external_environment(),
                )
            elif not self.enabled and self._process is not None:
                self._process.terminate()
                self._process.wait(timeout=5)
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

# Windows: a per-user Run value, the same one the installer's autostart task writes (installer\DeskAtlas.iss).
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
# Task Manager's "Startup apps" switch; an odd first byte means the user disabled the Run value there.
STARTUP_APPROVED_KEY = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"


def _legacy_startup_shortcut() -> Path:
    """Startup-folder shortcut used by DeskAtlas 1.0.0; still honoured, removed when autostart is changed."""
    appdata = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / f"{APP_NAME}.lnk"


def _run_value() -> str:
    return f'"{sys.executable}"'


def _read_value(key_path: str):
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            return winreg.QueryValueEx(key, APP_NAME)[0]
    except FileNotFoundError:
        return None


def _delete_value(key_path: str) -> None:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, APP_NAME)
    except FileNotFoundError:
        pass


def _launch_agent() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / "com.deskatlas.desktop.plist"


def _linux_autostart() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "autostart/deskatlas.desktop"


def autostart_supported() -> bool:
    return is_frozen() and (IS_WINDOWS or IS_MAC or IS_LINUX)


def autostart_enabled() -> bool:
    if IS_WINDOWS:
        if _legacy_startup_shortcut().exists():
            return True
        if _read_value(RUN_KEY) is None:
            return False
        approved = _read_value(STARTUP_APPROVED_KEY)
        return not (isinstance(approved, bytes) and approved and approved[0] & 1)
    if IS_MAC:
        return _launch_agent().exists()
    if IS_LINUX:
        path = _linux_autostart()
        return path.is_file() and "Hidden=true" not in path.read_text(encoding="utf-8")
    return False


def set_autostart(enabled: bool) -> None:
    if not autostart_supported():
        raise ValueError("当前运行方式不支持开机自启")
    if IS_WINDOWS:
        import winreg

        _legacy_startup_shortcut().unlink(missing_ok=True)
        # Clearing Task Manager's switch makes a fresh value start enabled again.
        _delete_value(STARTUP_APPROVED_KEY)
        if not enabled:
            _delete_value(RUN_KEY)
            return
        try:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, _run_value())
        except OSError as error:
            raise ValueError(f"无法创建开机启动项：{error}") from error
        return
    if IS_LINUX:
        path = _linux_autostart()
        if not enabled:
            path.unlink(missing_ok=True)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        command = " ".join('"' + arg.replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$").replace("%", "%%") + '"'
                           for arg in executable_command())
        path.write_text("[Desktop Entry]\nType=Application\nName=DeskAtlas\n"
                        f"Exec={command}\nIcon=deskatlas\nTerminal=false\n", encoding="utf-8")
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
        subprocess.Popen(["xdg-open", str(path)], env=external_environment())


def open_url(url: str) -> None:
    if IS_LINUX:
        subprocess.Popen(["xdg-open", url], env=external_environment())
    else:
        webbrowser.open(url, new=2)


def run_installer(path: Path) -> None:
    """Start a downloaded Inno Setup package silently; it closes and relaunches DeskAtlas itself."""
    if IS_LINUX:
        subprocess.Popen(["xdg-open", str(path)], env=external_environment())
        return
    if not IS_WINDOWS:
        raise ValueError("自动安装更新只支持 Windows")
    subprocess.Popen(
        [str(path), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"],
        close_fds=True,
        creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    )
