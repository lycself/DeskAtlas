"""Bring a database to the current schema, whether it is empty, legacy, or versioned."""

from __future__ import annotations

import logging

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from . import models  # noqa: F401  (registers every table on Base.metadata)
from .config import resource_root
from .database import Base


log = logging.getLogger(__name__)


def alembic_config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(resource_root() / "backend" / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    config.attributes["database_url"] = database_url
    return config


def head_revision() -> str:
    script = ScriptDirectory.from_config(alembic_config("sqlite://"))
    return script.get_current_head() or ""


def current_revision(engine: Engine) -> str | None:
    if "alembic_version" not in inspect(engine).get_table_names():
        return None
    with engine.connect() as connection:
        return connection.execute(text("SELECT version_num FROM alembic_version")).scalar()


def stamp(engine: Engine, database_url: str, revision: str = "head") -> None:
    command.stamp(alembic_config(database_url), revision)


def upgrade_database(engine: Engine, database_url: str) -> str:
    """Create or migrate the schema and return the resulting revision."""
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" in tables:
        log.info("Running schema migrations")
        command.upgrade(alembic_config(database_url), "head")
    else:
        # create_all adds missing tables, but cannot add columns to legacy tables.
        Base.metadata.create_all(engine)
        if tables:
            stamp(engine, database_url, "0001_initial")
            command.upgrade(alembic_config(database_url), "head")
        else:
            stamp(engine, database_url, "head")
    return current_revision(engine) or head_revision()
