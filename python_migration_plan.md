# Python Migration Plan (RemGo)

## Goal
- Reduce Python to the inference kernel and move service/orchestration concerns to TypeScript (and optionally Go later).
- Keep behavior stable during migration using adapter boundaries and golden tests.

## Current Snapshot
- Python files: 198
- Python LOC: 53,341
- Heavy maintenance areas:
  - `modules/async_worker.py` (task pipeline)
  - `modules/config.py` (runtime config/defaults)
  - `python_worker.py` (transport + request mapping)
  - `webui.py` (legacy UI path)

## Target Architecture
- TS owns:
  - API routes, job queue/scheduling, task lifecycle, output indexing/history, progress broadcast
  - request validation and normalization
  - config/preset/style catalog loading
- Python owns:
  - model loading and generation execution
  - minimal pre/post-process strictly required by ML libs

## Migration Phases
1. Contract-first boundary
- Define a versioned worker contract (`task payload`, `progress payload`, `result payload`).
- Add compatibility mode so both old/new payloads are accepted.

2. Move orchestration logic to TS
- Keep Python worker as execution engine only.
- Port argument normalization and default expansion from Python to TS.
- Remove Python HTTP logic later by replacing it with a thinner RPC shim.

3. Move catalog/config/history to TS
- Model/style/preset enumeration and validation in TS modules.
- History + metadata indexing in TS (sqlite/json reader), not Python.

4. Shrink Python core
- Isolate `async_worker` dependencies and extract optional features.
- Deprecate legacy `webui.py` path in favor of TS frontend/backend.

5. Optional Go adoption
- Introduce Go only where it provides clear wins (high-concurrency I/O workers or queue service).
- Keep ML execution boundary unchanged.

## Backlog (Prioritized)
1. Stabilize worker contract and add typed schema in TS + fallback in Python.
2. Port task-arg normalization to TS and make Python consume prebuilt positional args.
3. Port settings/catalog loader to dedicated TS modules (remove hardcoded route logic).
4. Add golden tests for request->result contract (single GPU first).
5. Port output history + metadata aggregation to TS module.
6. Reduce Python startup surface (`args_manager`/`api_server.py` path deprecation).
7. Split Python package into `core_inference` and `legacy_ui` folders.

## Implemented in This Change
- Completed backlog item 1.
- Completed backlog item 2.
- Added TS task argument builder: `backend/src/fooocus-task-args.ts`.
- Updated worker manager to send prebuilt args: `backend/src/worker-manager.ts`.
- Updated Python worker to consume `fooocus_args` with fallback compatibility: `python_worker.py`.
- Added worker contract version field and strict validation for `fooocus_args` length/types on both sides.
- Added contract documentation: `docs/worker-contract.md`.
