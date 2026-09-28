"""Generate installer/deskatlas.ico from the code-drawn application icon."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from desktop.icons import save_ico  # noqa: E402


def main() -> None:
    target = ROOT / "installer" / "deskatlas.ico"
    save_ico(target)
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
