"""Build an Ubuntu desktop package from the frozen application directory."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def stage_package(bundle: Path, root: Path, version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[.+~-][A-Za-z0-9.]+)?", version):
        raise ValueError("Invalid package version")
    if not (bundle / "DeskAtlas").is_file() or not (bundle / "_internal/static/index.html").is_file():
        raise ValueError("Application or static frontend missing from bundle")
    shutil.copytree(bundle, root / "opt/deskatlas")
    binary = root / "usr/bin/deskatlas"
    binary.parent.mkdir(parents=True)
    binary.symlink_to("/opt/deskatlas/DeskAtlas")
    applications = root / "usr/share/applications"
    applications.mkdir(parents=True)
    (applications / "deskatlas.desktop").write_text(
        "[Desktop Entry]\nType=Application\nName=DeskAtlas\n"
        "Comment=Office seats and student directory\nExec=/usr/bin/deskatlas\n"
        "Icon=deskatlas\nTerminal=false\nCategories=Office;\nStartupWMClass=DeskAtlas\n", encoding="utf-8",
    )
    from desktop.icons import app_image

    icons = root / "usr/share/icons/hicolor/256x256/apps"
    icons.mkdir(parents=True)
    app_image(256).save(icons / "deskatlas.png")
    control = root / "DEBIAN"
    control.mkdir()
    size = sum(file.stat().st_size for file in (root / "opt").rglob("*") if file.is_file()) // 1024
    (control / "control").write_text(
        f"Package: deskatlas\nVersion: {version}\nArchitecture: amd64\n"
        "Section: office\nPriority: optional\nMaintainer: DeskAtlas contributors\n"
        f"Installed-Size: {size}\n"
        "Depends: libgtk-3-0, libwebkit2gtk-4.1-0, libayatana-appindicator3-1, zenity, xdg-utils\n"
        "Homepage: https://github.com/lycself/DeskAtlas\n"
        "Description: DeskAtlas office seat management desktop application\n"
        " Local desktop service with a status window, tray menu and portable data backups.\n", encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--bundle", type=Path, default=Path("dist/DeskAtlas"))
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    target = args.output_dir.resolve() / f"DeskAtlas-{args.version}-Ubuntu-amd64.deb"
    with tempfile.TemporaryDirectory(prefix="deskatlas-deb-") as work:
        root = Path(work) / "package"
        stage_package(args.bundle.resolve(), root, args.version)
        subprocess.run(["dpkg-deb", "--build", "--root-owner-group", str(root), str(target)], check=True)
    print(target)
    return 0


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    sys.exit(main())
