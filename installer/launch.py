"""PyInstaller entry point: an absolute import so the bundle has a proper package context."""

import sys

from desktop.app import main


if __name__ == "__main__":
    sys.exit(main())
