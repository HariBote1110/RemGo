## Development Commands

Start full dev stack (frontend + Node backend + Python inference runtime setup):
```bash
./run_remgo.sh
```

Windows:
```bat
run_remgo.bat
```

Start backend only:
```bash
./run_backend.sh
```

Backend tests:
```bash
cd backend
npm test
```

Python worker syntax check:
```bash
python3 -m py_compile python_worker.py
```

## Deprecations

- `api_server.py` is legacy and disabled by default.
- `launch.py` and `entry_with_update.py` are legacy and disabled by default.
- Use `backend/src/server.ts` (Node/TypeScript) as the only supported API entrypoint.
- To run legacy API temporarily, set `REMGO_ENABLE_LEGACY_API_SERVER=1` explicitly.
- To run legacy Fooocus launchers temporarily, set `REMGO_ENABLE_LEGACY_FOOOCUS_LAUNCHER=1` explicitly.
