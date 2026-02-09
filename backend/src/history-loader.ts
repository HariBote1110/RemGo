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

const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;

function isImageFile(name: string): boolean {
    return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
}

function parseTimestampFromFilename(filename: string): number | null {
    const match = filename.match(FILE_DATETIME_PATTERN);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    const dt = new Date(year, month - 1, day, hour, minute, second);
    if (
        dt.getFullYear() !== year ||
        dt.getMonth() !== month - 1 ||
        dt.getDate() !== day ||
        dt.getHours() !== hour ||
        dt.getMinutes() !== minute ||
        dt.getSeconds() !== second
    ) {
        return null;
    }

    return dt.getTime() / 1000;
}

function readCreatedAt(filePath: string, filename: string): number {
    const parsed = parseTimestampFromFilename(filename);
    if (parsed !== null) {
        return parsed;
    }
    return fs.statSync(filePath).mtimeMs / 1000;
}

function collectRootFiles(outputsPath: string, entries: fs.Dirent[], limit: number): HistoryEntry[] {
    const history: HistoryEntry[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !isImageFile(entry.name)) {
            continue;
        }

        const filePath = path.join(outputsPath, entry.name);
        history.push({
            filename: entry.name,
            path: entry.name,
            created: readCreatedAt(filePath, entry.name),
            metadata: null,
        });
    }

    return history
        .sort((a, b) => b.created - a.created)
        .slice(0, limit);
}

function collectDateDirectoryFiles(outputsPath: string, entries: fs.Dirent[], limit: number): HistoryEntry[] {
    const history: HistoryEntry[] = [];
    const dateDirs = entries
        .filter((entry) => entry.isDirectory() && DATE_DIR_PATTERN.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name));

    for (const dirEntry of dateDirs) {
        if (history.length >= limit) {
            break;
        }

        const dateDir = path.join(outputsPath, dirEntry.name);
        const files = fs.readdirSync(dateDir, { withFileTypes: true })
            .filter((file) => file.isFile() && isImageFile(file.name))
            .sort((a, b) => b.name.localeCompare(a.name));

        for (const file of files) {
            if (history.length >= limit) {
                break;
            }

            const relPath = `${dirEntry.name}/${file.name}`;
            const filePath = path.join(dateDir, file.name);
            history.push({
                filename: file.name,
                path: relPath,
                created: readCreatedAt(filePath, file.name),
                metadata: null,
            });
        }
    }

    return history;
}

function collectOutputFiles(outputsPath: string, limit: number): HistoryEntry[] {
    if (!fs.existsSync(outputsPath) || limit <= 0) {
        return [];
    }

    const entries = fs.readdirSync(outputsPath, { withFileTypes: true });
    const rootFiles = collectRootFiles(outputsPath, entries, limit);
    const dateFiles = collectDateDirectoryFiles(outputsPath, entries, limit);

    return [...rootFiles, ...dateFiles]
        .sort((a, b) => b.created - a.created)
        .slice(0, limit);
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
        'names = json.loads(sys.stdin.read())',
        'conn = sqlite3.connect(db_path)',
        'cur = conn.cursor()',
        'placeholders = ",".join("?" for _ in names)',
        'cur.execute(f"SELECT filename, metadata FROM images WHERE filename IN ({placeholders})", names)',
        'rows = [{"filename": r[0], "metadata": r[1]} for r in cur.fetchall()]',
        'print(json.dumps(rows, ensure_ascii=False))',
    ].join('; ');

    try {
        const raw = execFileSync(python, ['-c', script, metadataDbPath], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            input: JSON.stringify(filenames),
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
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 500;
    const files = collectOutputFiles(outputsPath, safeLimit)
        .sort((a, b) => b.created - a.created)
        .slice(0, safeLimit);

    const metadataMap = loadMetadataMapFromSQLite(outputsPath, files.map((f) => f.filename));
    for (const entry of files) {
        entry.metadata = metadataMap.get(entry.filename) ?? null;
    }

    return files;
}
