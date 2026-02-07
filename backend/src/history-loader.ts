import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

type JsonObject = Record<string, unknown>;

export interface HistoryEntry {
    filename: string;
    path: string;
    created: number;
    metadata: JsonObject | null;
}

interface SQLiteRow {
    filename?: unknown;
    metadata?: unknown;
}

function isImageFile(name: string): boolean {
    return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
}

function collectOutputFiles(outputsPath: string): HistoryEntry[] {
    if (!fs.existsSync(outputsPath)) {
        return [];
    }

    const history: HistoryEntry[] = [];
    const entries = fs.readdirSync(outputsPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isFile() && isImageFile(entry.name)) {
            const filePath = path.join(outputsPath, entry.name);
            const stats = fs.statSync(filePath);
            history.push({
                filename: entry.name,
                path: entry.name,
                created: stats.mtimeMs / 1000,
                metadata: null,
            });
            continue;
        }

        // Keep compatibility with date-based folder layout like outputs/2026-02-07/*.png.
        if (entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
            const dateDir = path.join(outputsPath, entry.name);
            const files = fs.readdirSync(dateDir, { withFileTypes: true });

            for (const file of files) {
                if (!file.isFile() || !isImageFile(file.name)) {
                    continue;
                }

                const relPath = `${entry.name}/${file.name}`;
                const filePath = path.join(dateDir, file.name);
                const stats = fs.statSync(filePath);
                history.push({
                    filename: file.name,
                    path: relPath,
                    created: stats.mtimeMs / 1000,
                    metadata: null,
                });
            }
        }
    }

    return history;
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function parseMetadataRows(rows: SQLiteRow[]): Map<string, JsonObject> {
    const map = new Map<string, JsonObject>();
    for (const row of rows) {
        if (typeof row.filename !== 'string' || typeof row.metadata !== 'string') {
            continue;
        }

        try {
            const parsed = JSON.parse(row.metadata) as JsonObject;
            map.set(row.filename, parsed);
        } catch {
            // Ignore malformed metadata rows and continue.
        }
    }
    return map;
}

function detectPythonExecutable(rootPath: string): string | null {
    const candidates = [
        path.join(rootPath, 'venv', 'Scripts', 'python.exe'),
        path.join(rootPath, 'venv', 'bin', 'python'),
        'python3',
        'python',
    ];

    for (const candidate of candidates) {
        try {
            execFileSync(candidate, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            return candidate;
        } catch {
            // Try next candidate.
        }
    }

    return null;
}

function loadMetadataMapViaPython(metadataDbPath: string, filenames: string[]): Map<string, JsonObject> {
    const rootPath = path.dirname(metadataDbPath);
    const python = detectPythonExecutable(path.dirname(rootPath));
    if (!python) {
        return new Map();
    }

    const script = [
        'import json, sqlite3, sys',
        'db_path = sys.argv[1]',
        'names = json.loads(sys.argv[2])',
        'if not names:',
        '    print("[]")',
        '    raise SystemExit(0)',
        'conn = sqlite3.connect(db_path)',
        'cur = conn.cursor()',
        'placeholders = ",".join("?" for _ in names)',
        'cur.execute(f"SELECT filename, metadata FROM images WHERE filename IN ({placeholders})", names)',
        'rows = [{"filename": r[0], "metadata": r[1]} for r in cur.fetchall()]',
        'print(json.dumps(rows, ensure_ascii=False))',
    ].join('; ');

    try {
        const raw = execFileSync(python, ['-c', script, metadataDbPath, JSON.stringify(filenames)], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const rows = JSON.parse(raw) as SQLiteRow[];
        return parseMetadataRows(rows);
    } catch (error) {
        console.warn('[HistoryLoader] Python fallback for metadata.db failed:', error);
        return new Map();
    }
}

function loadMetadataMapFromSQLite(outputsPath: string, filenames: string[]): Map<string, JsonObject> {
    const metadataDbPath = path.join(outputsPath, 'metadata.db');
    if (!fs.existsSync(metadataDbPath) || filenames.length === 0) {
        return new Map();
    }

    const uniqueNames = Array.from(new Set(filenames));
    const inClause = uniqueNames.map(shellQuote).join(', ');
    const sql = `SELECT filename, metadata FROM images WHERE filename IN (${inClause});`;

    try {
        const raw = execFileSync('sqlite3', [metadataDbPath, '-json', sql], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const rows = JSON.parse(raw) as SQLiteRow[];
        return parseMetadataRows(rows);
    } catch (error) {
        console.warn('[HistoryLoader] sqlite3 CLI query failed, trying Python fallback:', error);
        return loadMetadataMapViaPython(metadataDbPath, uniqueNames);
    }
}

export function loadHistory(outputsPath: string, limit = 500): HistoryEntry[] {
    const files = collectOutputFiles(outputsPath)
        .sort((a, b) => b.created - a.created)
        .slice(0, limit);

    const metadataMap = loadMetadataMapFromSQLite(outputsPath, files.map((f) => f.filename));
    for (const entry of files) {
        entry.metadata = metadataMap.get(entry.filename) ?? null;
    }

    return files;
}
