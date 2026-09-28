"""Write and sign latest.json for a release installer.

    python scripts/make_update_manifest.py --version 1.2.3 --installer dist/DeskAtlas-Setup-1.2.3.exe \
        --url https://github.com/lycself/DeskAtlas/releases/download/v1.2.3/DeskAtlas-Setup-1.2.3.exe \
        --notes-file notes.md --output dist/latest.json

Signing is optional. When DESKATLAS_UPDATE_PRIVATE_KEY (base64 raw Ed25519 key, see
scripts/generate_update_keys.py) is set the manifest is signed and works from any update source;
without it the manifest is unsigned and the desktop app accepts it only from the official GitHub
releases page, which HTTPS already protects.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from desktop.updater import canonical_bytes, is_official_source, verify_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--installer", type=Path, required=True)
    parser.add_argument("--url", required=True, help="public download URL of the installer")
    parser.add_argument("--notes-file", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=Path("dist/latest.json"))
    args = parser.parse_args()

    key_b64 = os.environ.get("DESKATLAS_UPDATE_PRIVATE_KEY", "").strip()
    private_key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(key_b64)) if key_b64 else None

    digest = hashlib.sha256()
    with args.installer.open("rb") as handle:
        while chunk := handle.read(1024 * 256):
            digest.update(chunk)
    manifest = {
        "version": args.version.lstrip("vV"),
        "url": args.url,
        "sha256": digest.hexdigest(),
        "size": args.installer.stat().st_size,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "notes": args.notes_file.read_text(encoding="utf-8").strip() if args.notes_file and args.notes_file.is_file() else "",
    }
    if private_key is not None:
        manifest["signature"] = base64.b64encode(private_key.sign(canonical_bytes(manifest))).decode()
        verify_manifest(manifest)
        print("manifest signed; intranet mirrors can serve it")
    else:
        if not is_official_source(args.url):
            print("DESKATLAS_UPDATE_PRIVATE_KEY is not set, and the installer URL is not on the official GitHub "
                  "releases page; clients would reject this manifest", file=sys.stderr)
            return 1
        print("DESKATLAS_UPDATE_PRIVATE_KEY not set; manifest is unsigned and valid only from the official GitHub source")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output} for version {manifest['version']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
