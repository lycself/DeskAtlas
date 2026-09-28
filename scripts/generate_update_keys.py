"""Generate a new Ed25519 keypair for signing update manifests.

Prints the public key to paste into desktop/update_key.py and the private key to store as the
GitHub Actions secret DESKATLAS_UPDATE_PRIVATE_KEY. Rotating the key means every installed copy
must be updated once with a build that carries the new public key before newer releases verify.
"""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main() -> None:
    private = Ed25519PrivateKey.generate()
    private_b64 = base64.b64encode(private.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())).decode()
    public_b64 = base64.b64encode(private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    print("PUBLIC_KEY (desktop/update_key.py):", public_b64)
    print("DESKATLAS_UPDATE_PRIVATE_KEY (GitHub secret):", private_b64)


if __name__ == "__main__":
    main()
