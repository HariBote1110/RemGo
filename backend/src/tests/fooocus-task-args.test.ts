import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import {
    buildFooocusTaskArgs,
    FOOOCUS_ARGS_CONTRACT_VERSION,
    FOOOCUS_ARGS_EXPECTED_LENGTH,
    validateFooocusTaskArgs,
} from '../fooocus-task-args';

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

test('fooocus task args matches golden snapshot', () => {
    const requestPath = path.join(__dirname, '../../src/testdata/fooocus-task-request.json');
    const goldenPath = path.join(__dirname, '../../src/testdata/fooocus-task-args.golden.json');

    const request = readJson<Record<string, unknown>>(requestPath);
    const golden = readJson<{ contract_version: number; expected_length: number; args: unknown[] }>(goldenPath);

    const builtArgs = buildFooocusTaskArgs(request);

    assert.equal(FOOOCUS_ARGS_CONTRACT_VERSION, golden.contract_version);
    assert.equal(FOOOCUS_ARGS_EXPECTED_LENGTH, golden.expected_length);
    assert.equal(builtArgs.length, FOOOCUS_ARGS_EXPECTED_LENGTH);
    assert.deepEqual(builtArgs, golden.args);

    const validation = validateFooocusTaskArgs(builtArgs);
    assert.equal(validation.ok, true);
});

test('fooocus task args validator rejects invalid payload', () => {
    const invalid = ['not-valid'];
    const validation = validateFooocusTaskArgs(invalid);
    assert.equal(validation.ok, false);
});

test('fooocus task args normalizes aspect ratio delimiters', () => {
    const args = buildFooocusTaskArgs({
        aspect_ratios_selection: '1152*896',
    });
    assert.equal(args[5], '1152×896');
});
