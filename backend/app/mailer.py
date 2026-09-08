from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from .config import get_settings
from .models import EmailDelivery, SmtpSetting, utcnow


settings = get_settings()


def _cipher() -> Fernet:
    if not settings.settings_encryption_key:
        raise RuntimeError("SETTINGS_ENCRYPTION_KEY is not configured")
    return Fernet(settings.settings_encryption_key.encode())


def encrypt_secret(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _cipher().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("SMTP password cannot be decrypted") from exc


def deliver(db: Session, delivery: EmailDelivery) -> EmailDelivery:
    config = db.get(SmtpSetting, 1)
    delivery.attempt_count += 1
    delivery.last_attempt_at = utcnow()
    if not config or not config.is_configured:
        delivery.status = "failed"
        delivery.error = "SMTP 尚未配置"
        db.commit()
        return delivery

    try:
        message = EmailMessage()
        message["Subject"] = delivery.subject
        message["From"] = f"{config.sender_name} <{config.sender_email}>"
        message["To"] = delivery.recipient
        message.set_content(delivery.body)
        password = decrypt_secret(config.encrypted_password)
        if config.security == "ssl":
            with smtplib.SMTP_SSL(config.host, config.port, timeout=15, context=ssl.create_default_context()) as client:
                if config.username:
                    client.login(config.username, password)
                client.send_message(message)
        else:
            with smtplib.SMTP(config.host, config.port, timeout=15) as client:
                if config.security == "starttls":
                    client.starttls(context=ssl.create_default_context())
                if config.username:
                    client.login(config.username, password)
                client.send_message(message)
        delivery.status = "sent"
        delivery.error = None
    except Exception as exc:  # SMTP providers return varied exception types.
        delivery.status = "failed"
        delivery.error = str(exc)[:2000]
    db.commit()
    db.refresh(delivery)
    return delivery


def create_delivery(
    db: Session,
    *,
    recipient: str,
    subject: str,
    body: str,
    application_id: int | None = None,
) -> EmailDelivery:
    delivery = EmailDelivery(
        recipient=recipient,
        subject=subject,
        body=body,
        application_id=application_id,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return deliver(db, delivery)

