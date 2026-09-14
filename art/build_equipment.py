"""Use the native assembly pipeline for the fixed sidearm and melee slots."""
import runpy
from pathlib import Path

runpy.run_path(str(Path(SPRAYLAB_ROOT) / 'art/build_native.py'), init_globals={
    'SPRAYLAB_ROOT': SPRAYLAB_ROOT, 'SPRAYLAB_EQUIPMENT': True,
    'SPRAYLAB_WEAPONS': ['usp', 'knife'],
})
