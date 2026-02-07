import os
import sys

if os.environ.get('REMGO_ENABLE_LEGACY_FOOOCUS_LAUNCHER') != '1':
    print('[DEPRECATED] launch.py is deprecated and disabled by default.')
    print('[DEPRECATED] Use TypeScript launcher: ./run_remgo.sh (or run_remgo.bat).')
    print('[DEPRECATED] Set REMGO_ENABLE_LEGACY_FOOOCUS_LAUNCHER=1 only for temporary fallback.')
    sys.exit(1)

raise RuntimeError('Legacy launcher is no longer maintained in this repository.')
