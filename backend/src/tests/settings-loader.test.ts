import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import { loadSettings } from '../settings-loader';

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

test('settings loader matches fixture golden snapshot', () => {
    const fixtureRoot = path.join(__dirname, '../../src/testdata/settings-fixture');
    const goldenPath = path.join(__dirname, '../../src/testdata/settings-loader.golden.json');

    const actual = loadSettings(fixtureRoot);
    const golden = readJson<typeof actual>(goldenPath);

    assert.deepEqual(actual, golden);
});
