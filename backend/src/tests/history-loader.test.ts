import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadHistory, loadHistoryPage } from '../history-loader';

function createTempOutputs(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'remgo-history-loader-'));
    const outputsPath = path.join(base, 'outputs');
    fs.mkdirSync(outputsPath, { recursive: true });
    return base;
}

function touch(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
}

test('history loader returns latest images with correct paths', () => {
    const base = createTempOutputs();
    const outputsPath = path.join(base, 'outputs');

    try {
        touch(path.join(outputsPath, '2026-02-09_01-00-00_9999.png'));
        touch(path.join(outputsPath, '2026-02-08', '2026-02-08_10-00-00_0001.png'));
        touch(path.join(outputsPath, '2026-02-08', '2026-02-08_09-00-00_0002.png'));
        touch(path.join(outputsPath, '2026-02-07', '2026-02-07_23-59-59_0003.png'));

        const history = loadHistory(outputsPath, 3);

        assert.equal(history.length, 3);
        assert.equal(history[0].path, '2026-02-09_01-00-00_9999.png');
        assert.equal(history[1].path, '2026-02-08/2026-02-08_10-00-00_0001.png');
        assert.equal(history[2].path, '2026-02-08/2026-02-08_09-00-00_0002.png');
        assert.equal(history.every((entry) => entry.metadata === null), true);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('history loader enforces minimum limit', () => {
    const base = createTempOutputs();
    const outputsPath = path.join(base, 'outputs');

    try {
        touch(path.join(outputsPath, '2026-02-09_01-00-00_9999.png'));
        touch(path.join(outputsPath, '2026-02-08', '2026-02-08_10-00-00_0001.png'));

        const history = loadHistory(outputsPath, 0);
        assert.equal(history.length, 1);
        assert.equal(history[0].path, '2026-02-09_01-00-00_9999.png');
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('history loader returns paged payload', () => {
    const base = createTempOutputs();
    const outputsPath = path.join(base, 'outputs');

    try {
        touch(path.join(outputsPath, '2026-02-09_01-00-00_9999.png'));
        touch(path.join(outputsPath, '2026-02-09_00-59-59_9998.png'));
        touch(path.join(outputsPath, '2026-02-09_00-59-58_9997.png'));
        touch(path.join(outputsPath, '2026-02-09_00-59-57_9996.png'));

        const page = loadHistoryPage(outputsPath, 2, 2);

        assert.equal(page.total, 4);
        assert.equal(page.limit, 2);
        assert.equal(page.offset, 2);
        assert.equal(page.page, 2);
        assert.equal(page.total_pages, 2);
        assert.equal(page.items.length, 2);
        assert.equal(page.items[0].path, '2026-02-09_00-59-58_9997.png');
        assert.equal(page.items[1].path, '2026-02-09_00-59-57_9996.png');
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});
