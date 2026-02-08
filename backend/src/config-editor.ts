import * as fs from 'fs';
import * as path from 'path';

type PrimitiveType = 'string' | 'number' | 'boolean';
type ConfigFieldType = PrimitiveType | 'array' | 'object' | 'unknown';

export interface ConfigField {
    key: string;
    type: ConfigFieldType;
    default_value: unknown;
    current_value: unknown;
}

export interface ConfigEditorPayload {
    config_path: string;
    tutorial_path: string;
    restart_required: boolean;
    fields: ConfigField[];
}

function parseTutorialJson(tutorialText: string): Record<string, unknown> {
    const start = tutorialText.indexOf('{');
    const end = tutorialText.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) {
        throw new Error('Failed to locate JSON block in config_modification_tutorial.txt');
    }
    const jsonText = tutorialText.slice(start, end + 1);
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tutorial JSON root must be an object');
    }
    return parsed as Record<string, unknown>;
}

function inferType(value: unknown): ConfigFieldType {
    if (Array.isArray(value)) {
        return 'array';
    }
    if (typeof value === 'string') {
        return 'string';
    }
    if (typeof value === 'number') {
        return 'number';
    }
    if (typeof value === 'boolean') {
        return 'boolean';
    }
    if (value && typeof value === 'object') {
        return 'object';
    }
    return 'unknown';
}

function isSameContainerType(value: unknown, expected: ConfigFieldType): boolean {
    switch (expected) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return !!value && typeof value === 'object' && !Array.isArray(value);
        case 'unknown':
            return true;
        default:
            return false;
    }
}

export function loadConfigEditorPayload(rootPath: string): ConfigEditorPayload {
    const tutorialPath = path.join(rootPath, 'config_modification_tutorial.txt');
    const configPath = path.join(rootPath, 'config.txt');

    const tutorialText = fs.readFileSync(tutorialPath, 'utf-8');
    const tutorialDefaults = parseTutorialJson(tutorialText);

    let currentConfig: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
        const configText = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(configText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            currentConfig = parsed as Record<string, unknown>;
        }
    }

    const fields: ConfigField[] = Object.keys(tutorialDefaults).map((key) => {
        const defaultValue = tutorialDefaults[key];
        return {
            key,
            type: inferType(defaultValue),
            default_value: defaultValue,
            current_value: currentConfig[key] ?? defaultValue,
        };
    });

    return {
        config_path: configPath,
        tutorial_path: tutorialPath,
        restart_required: true,
        fields,
    };
}

export function saveConfigFromEditorPayload(rootPath: string, values: Record<string, unknown>): { updated_keys: string[]; config_path: string } {
    const tutorialPath = path.join(rootPath, 'config_modification_tutorial.txt');
    const configPath = path.join(rootPath, 'config.txt');

    const tutorialText = fs.readFileSync(tutorialPath, 'utf-8');
    const tutorialDefaults = parseTutorialJson(tutorialText);

    const allowedKeys = new Set(Object.keys(tutorialDefaults));
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(values)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Unknown config key: ${key}`);
        }
        const expectedType = inferType(tutorialDefaults[key]);
        if (!isSameContainerType(value, expectedType)) {
            throw new Error(`Invalid type for "${key}". Expected ${expectedType}.`);
        }
        sanitizedUpdates[key] = value;
    }

    let currentConfig: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
        const configText = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(configText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            currentConfig = parsed as Record<string, unknown>;
        }
    }

    const nextConfig: Record<string, unknown> = {
        ...currentConfig,
        ...sanitizedUpdates,
    };

    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 4), 'utf-8');

    return {
        updated_keys: Object.keys(sanitizedUpdates),
        config_path: configPath,
    };
}
