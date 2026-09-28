"""Application version, injected at build time by CI."""

try:
    from ._build_version import VERSION
except ImportError:  # pragma: no cover - development checkout
    VERSION = "0.0.0-dev"

__all__ = ["VERSION"]
