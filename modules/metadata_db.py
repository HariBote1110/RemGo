"""
SQLite-based metadata storage for generated images.
Replaces log.html with efficient database storage.
"""
import sqlite3
import json
import os
from datetime import datetime
from typing import Optional, Dict, List, Any

import modules.config

DB_PATH = os.path.join(modules.config.path_outputs, 'metadata.db')

_connection: Optional[sqlite3.Connection] = None


def get_connection() -> sqlite3.Connection:
    """Get or create database connection."""
    global _connection
    if _connection is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        init_db(_connection)
    return _connection


def init_db(conn: sqlite3.Connection) -> None:
    """Initialise database schema."""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            metadata TEXT
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_created ON images(created_at DESC)')
    conn.commit()


def save_metadata(filename: str, metadata: Dict[str, Any]) -> None:
    """Save metadata for an image."""
    conn = get_connection()
    metadata_json = json.dumps(metadata, ensure_ascii=False)
    conn.execute('''
        INSERT OR REPLACE INTO images (filename, created_at, metadata)
        VALUES (?, ?, ?)
    ''', (filename, datetime.now().isoformat(), metadata_json))
    conn.commit()


def get_metadata(filename: str) -> Optional[Dict[str, Any]]:
    """Get metadata for a specific image."""
    conn = get_connection()
    cursor = conn.execute('SELECT metadata FROM images WHERE filename = ?', (filename,))
    row = cursor.fetchone()
    if row and row['metadata']:
        return json.loads(row['metadata'])
    return None


def get_all_images(limit: int = 500, offset: int = 0) -> List[Dict[str, Any]]:
    """Get all images with metadata, sorted by creation time descending."""
    conn = get_connection()
    cursor = conn.execute('''
        SELECT filename, created_at, metadata
        FROM images
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    ''', (limit, offset))
    
    results = []
    for row in cursor:
        entry = {
            'filename': row['filename'],
            'created_at': row['created_at'],
            'metadata': json.loads(row['metadata']) if row['metadata'] else None
        }
        results.append(entry)
    return results


def get_image_count() -> int:
    """Get total number of images in database."""
    conn = get_connection()
    cursor = conn.execute('SELECT COUNT(*) as count FROM images')
    return cursor.fetchone()['count']


def close() -> None:
    """Close database connection."""
    global _connection
    if _connection:
        _connection.close()
        _connection = None
