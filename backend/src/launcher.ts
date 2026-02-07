import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';

const isWindows = process.platform === 'win32';
const npmCmd = 'npm';

function runCommandOrThrow(command: string, args: string[], cwd: string, useShell = false): void {
    const result = spawnSync(command, args, {
        cwd,
        stdio: 'inherit',
        shell: useShell,
    });

    if (result.status !== 0) {
        throw new Error(`Command failed: ${command} ${args.join(' ')}`);
    }
}

function commandExists(command: string): boolean {
    const probe = isWindows ? spawnSync('where', [command], { stdio: 'ignore' }) : spawnSync('which', [command], { stdio: 'ignore' });
    return probe.status === 0;
}

function detectPythonCommand(rootPath: string): string {
    const venvPython = isWindows
        ? path.join(rootPath, 'venv', 'Scripts', 'python.exe')
        : path.join(rootPath, 'venv', 'bin', 'python');

    if (fs.existsSync(venvPython)) {
        return venvPython;
    }

    const candidates = isWindows ? ['python', 'py'] : ['python3', 'python'];
    for (const candidate of candidates) {
        if (commandExists(candidate)) {
            return candidate;
        }
    }

    throw new Error('Python is not installed or not found in PATH.');
}

function ensureVenv(rootPath: string, python: string): void {
    const venvPath = path.join(rootPath, 'venv');
    if (fs.existsSync(venvPath)) {
        return;
    }

    console.log('[Launcher] Creating Python virtual environment...');
    if (isWindows && path.basename(python).toLowerCase() === 'py') {
        runCommandOrThrow(python, ['-3', '-m', 'venv', 'venv'], rootPath);
    } else {
        runCommandOrThrow(python, ['-m', 'venv', 'venv'], rootPath);
    }
}

function ensureNodeModules(projectPath: string): void {
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
        return;
    }
    console.log(`[Launcher] Installing dependencies in ${projectPath} ...`);
    runCommandOrThrow(npmCmd, ['install'], projectPath, isWindows);
}

function installPythonDependencies(rootPath: string, python: string): void {
    console.log('[Launcher] Installing Python dependencies (inference runtime)...');
    runCommandOrThrow(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], rootPath);
    runCommandOrThrow(python, ['-m', 'pip', 'install', '-r', 'requirements_remgo.txt'], rootPath);
}

function startBackend(rootPath: string): ChildProcess {
    const backendPath = path.join(rootPath, 'backend');
    const logPath = path.join(rootPath, 'api_server.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    console.log('[Launcher] Starting backend (Node/TS)...');
    const child = spawn(npmCmd, ['run', 'dev'], {
        cwd: backendPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows,
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    return child;
}

function stopChild(child: ChildProcess | null | undefined): void {
    if (!child || child.killed) {
        return;
    }
    child.kill('SIGTERM');
}

function startFrontend(rootPath: string): ChildProcess {
    const frontendPath = path.join(rootPath, 'frontend');
    console.log('[Launcher] Starting frontend (Vite)...');
    return spawn(npmCmd, ['run', 'dev'], {
        cwd: frontendPath,
        stdio: 'inherit',
        shell: isWindows,
    });
}

async function main(): Promise<void> {
    const rootPath = path.join(__dirname, '../..');

    let python = detectPythonCommand(rootPath);
    ensureVenv(rootPath, python);
    python = detectPythonCommand(rootPath);

    installPythonDependencies(rootPath, python);
    ensureNodeModules(path.join(rootPath, 'backend'));
    ensureNodeModules(path.join(rootPath, 'frontend'));

    const backend = startBackend(rootPath);
    const frontend = startFrontend(rootPath);

    const shutdown = (): void => {
        stopChild(frontend);
        stopChild(backend);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('exit', shutdown);

    frontend.on('exit', (code) => {
        stopChild(backend);
        process.exit(code ?? 0);
    });

    backend.on('exit', (code) => {
        if ((code ?? 0) !== 0) {
            console.error(`[Launcher] Backend exited with code ${code}`);
        }
    });
}

main().catch((error) => {
    console.error(`[Launcher] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
