import os
from pathlib import Path

from cryptography.fernet import Fernet
from pwdlib import PasswordHash


TEST_DB = Path(__file__).with_name("deskatlas-test.db")
if TEST_DB.exists():
    TEST_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD_HASH"] = PasswordHash.recommended().hash("test-password-123")
os.environ["SESSION_SECRET"] = "test-session-secret-with-sufficient-randomness"
os.environ["SETTINGS_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["APP_ENV"] = "development"

