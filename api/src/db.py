"""Capa de base de datos con psycopg2 puro (sin ORM).

Esquema:
  jobs
    id            UUID PK
    label         TEXT          nombre del vídeo
    filename      TEXT          nombre original del fichero
    file_size     BIGINT        bytes
    s3_key        TEXT          clave en el bucket (videos/<id>.<ext>)
    status        TEXT          pending | uploading | queued | processing | done | error
    steps         TEXT[]        pasos solicitados: quality, speakers, denoise
    progress      INT           0-100
    current_step  TEXT          step en curso: quality | denoise | speakers (null si no processing)
    error_msg     TEXT          mensaje de error si status=error
    results       JSONB         resultados del análisis
    created_at    TIMESTAMPTZ
    updated_at    TIMESTAMPTZ
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from psycopg2.pool import ThreadedConnectionPool

from src.config import settings

# Pool de conexiones — se inicializa en lifespan
_pool: ThreadedConnectionPool | None = None

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label         TEXT NOT NULL,
    filename      TEXT NOT NULL,
    file_size     BIGINT,
    s3_key        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    steps         TEXT[] NOT NULL DEFAULT ARRAY['quality','speakers','denoise'],
    progress      INT NOT NULL DEFAULT 0,
    current_step  TEXT,
    error_msg     TEXT,
    results       JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at DESC);

-- Migración: añadir current_step si la tabla ya existe sin esa columna
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='jobs' AND column_name='current_step'
    ) THEN
        ALTER TABLE jobs ADD COLUMN current_step TEXT;
    END IF;
END$$;
"""


def init_db() -> None:
    """Crea el pool y las tablas si no existen."""
    global _pool
    _pool = ThreadedConnectionPool(minconn=0, maxconn=10, dsn=settings.database_url)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)
        conn.commit()


@contextmanager
def get_conn():
    """Context manager que devuelve una conexión del pool."""
    if _pool is None:
        raise RuntimeError("DB no inicializada — llama a init_db() primero")
    conn = _pool.getconn()
    try:
        yield conn
    finally:
        _pool.putconn(conn)


def close_db() -> None:
    if _pool:
        _pool.closeall()


# --------------------------------------------------------------------------- #
# CRUD helpers                                                                 #
# --------------------------------------------------------------------------- #

def job_create(
    label: str,
    filename: str,
    file_size: int | None,
    steps: list[str],
) -> dict:
    sql = """
        INSERT INTO jobs (label, filename, file_size, steps, status)
        VALUES (%s, %s, %s, %s, 'pending')
        RETURNING *
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (label, filename, file_size, steps))
            row = dict(cur.fetchone())
        conn.commit()
    return _serialize(row)


def job_get(job_id: str) -> dict | None:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
    return _serialize(dict(row)) if row else None


def job_list(limit: int = 100, offset: int = 0) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT %s OFFSET %s",
                (limit, offset),
            )
            rows = cur.fetchall()
    return [_serialize(dict(r)) for r in rows]


def job_update(job_id: str, **fields) -> dict | None:
    """Actualiza campos arbitrarios + updated_at."""
    allowed = {"s3_key", "status", "progress", "current_step", "error_msg", "results", "file_size"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return job_get(job_id)

    set_parts = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [datetime.now(timezone.utc), job_id]
    sql = f"UPDATE jobs SET {set_parts}, updated_at = %s WHERE id = %s RETURNING *"

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, values)
            row = cur.fetchone()
        conn.commit()
    return _serialize(dict(row)) if row else None


def job_delete(job_id: str) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM jobs WHERE id = %s", (job_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def _serialize(row: dict) -> dict:
    """Convierte tipos no-JSON-serializables a strings/dicts."""
    for k, v in row.items():
        if isinstance(v, datetime):
            row[k] = v.isoformat()
        elif isinstance(v, uuid.UUID):
            row[k] = str(v)
        elif isinstance(v, memoryview):
            row[k] = bytes(v).decode()
    return row
