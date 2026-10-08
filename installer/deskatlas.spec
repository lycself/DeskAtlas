# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build for the DeskAtlas desktop app (one directory, windowed).

Run from the repository root after `DESKATLAS_STATIC=1 pnpm build`:
    python -m PyInstaller installer/deskatlas.spec --noconfirm
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).resolve().parent
STATIC = ROOT / "out"
if not (STATIC / "index.html").is_file():
    raise SystemExit("out/index.html missing: run `DESKATLAS_STATIC=1 pnpm build` first")

icon_file = ROOT / "installer" / "deskatlas.ico"
datas = [
    (str(STATIC), "static"),
    (str(ROOT / "backend" / "alembic"), "backend/alembic"),
    (str(ROOT / "backend" / "alembic.ini"), "backend"),
]
datas += collect_data_files("webview")
datas += collect_data_files("qrcode")

hiddenimports = (
    collect_submodules("backend.app")
    + collect_submodules("desktop")
    + collect_submodules("uvicorn")
    + collect_submodules("alembic")
    + collect_submodules("pystray")
    + collect_submodules("webview")
    + [
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.dialects.postgresql",
        "PIL.Image",
        "PIL.ImageDraw",
        "qrcode.image.svg",
        "pwdlib.hashers.argon2",
        "argon2",
        "email_validator",
        "multipart",
        "python_multipart",
        "anyio._backends._asyncio",
    ]
)
if sys.platform == "win32":
    hiddenimports += ["clr", "pythonnet", "webview.platforms.edgechromium", "webview.platforms.winforms", "pystray._win32"]
elif sys.platform.startswith("linux"):
    hiddenimports += ["webview.platforms.gtk", "pystray._appindicator", "gi.repository.Gtk",
                      "gi.repository.WebKit2", "gi.repository.AyatanaAppIndicator3", "gi.repository.DBus"]

a = Analysis(
    [str(ROOT / "installer" / "launch.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    hooksconfig={"gi": {"module-versions": {"Gtk": "3.0", "WebKit2": "4.1", "JavaScriptCore": "4.1", "AyatanaAppIndicator3": "0.1", "DBus": "1.0"}}},
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "psycopg", "pytest"],
    noarchive=False,
)
if sys.platform.startswith("linux"):
    # The deb declares GTK/WebKit dependencies; their shared libraries must match the host's typelibs.
    a.exclude_system_libraries()
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="DeskAtlas",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(icon_file) if icon_file.is_file() else None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="DeskAtlas",
)
