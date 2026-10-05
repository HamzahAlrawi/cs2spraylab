"""Hash-pinned, offline CS2 landing-factor arithmetic fixtures.

Reads server.dll as data; no DLL is loaded and no running process is accessed.
Unicorn executes two small arithmetic blocks. The jump block's time-to-seconds
helper is stubbed. Timestamp selection, collision, ladders/water and complete
subtick scheduling are NOT verified by this fixture.
"""
import argparse
import hashlib
import json
import os
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_RSP, UC_X86_REG_RBP, UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_R8, UC_X86_REG_RIP, UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM6

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw = (game / 'game/csgo/bin/win64/server.dll').read_bytes()
sha = hashlib.sha256(raw).hexdigest()
assert sha == '098d4ddd57e2fbe9a73623a2bf68ebaff86f7b6342ddb3d5a0f69cd6335b31cc', 'Build changed: re-audit offsets'
pe = pefile.PE(data=raw, fast_load=True)
base = pe.OPTIONAL_HEADER.ImageBase
uc = Uc(UC_ARCH_X86, UC_MODE_64)
uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
uc.mem_write(base, pe.get_memory_mapped_image())
uc.mem_map(0x20000000, 0x20000)
stack = 0x20008000
elapsed = 0


def write_float(address, value):
    uc.mem_write(address, struct.pack('<f', value))


def xmm(register, value):
    uc.reg_write(register, struct.unpack('<I', struct.pack('<f', value))[0])


def result():
    return struct.unpack('<f', struct.pack('<I', uc.reg_read(UC_X86_REG_XMM0) & 0xffffffff))[0]


def time_stub(machine, address, _size, _data):
    if address == base + 0xab2266:
        machine.reg_write(UC_X86_REG_RIP, base + 0xab226b)
        xmm(UC_X86_REG_XMM0, elapsed)


uc.hook_add(UC_HOOK_CODE, time_stub)
cases = []
for impact in [-100, -301.993, -1000, -3000]:
    for elapsed in [0, .125, .5, 1]:
        # Earlier native instructions build 1 + impactVelocity * .0005.
        initial = 1 + impact * .0005000000237487257
        write_float(stack + 0xa0, initial)
        write_float(stack + 0x98, .2)
        write_float(stack + 0x90, 1)
        write_float(stack + 0xa8, 1)
        uc.reg_write(UC_X86_REG_RSP, stack)
        uc.reg_write(UC_X86_REG_RCX, stack + 0xa0)
        uc.reg_write(UC_X86_REG_RDX, stack + 0x98)
        uc.reg_write(UC_X86_REG_R8, stack + 0x90)
        uc.emu_start(base + 0xab2251, base + 0xab2295, count=100)
        jump = result()
        baseline = max(.2, min(1, initial))
        assert abs(jump - min(1, baseline + elapsed * .6000000238418579)) < 1e-6
        cases.append({'kind': 'jump', 'impactUnitsPerSecond': impact, 'seconds': elapsed, 'result': jump})

        # Horizontal penalty block consumes tick-count * 1/64 after the native
        # timestamp helpers. All fixture times have exact 64 Hz representations.
        uc.reg_write(UC_X86_REG_RBP, stack)
        uc.reg_write(UC_X86_REG_RCX, stack + 0x38)
        uc.reg_write(UC_X86_REG_RDX, stack + 0x30)
        write_float(stack + 0x30, 1)
        xmm(UC_X86_REG_XMM6, baseline)
        xmm(UC_X86_REG_XMM1, elapsed * 64)
        uc.emu_start(base + 0xadbc95, base + 0xadbcb7, count=100)
        ground = result()
        assert abs(ground - min(1, baseline ** 2 + elapsed * 1.111189365386963)) < 1e-6
        cases.append({'kind': 'ground', 'impactUnitsPerSecond': impact, 'seconds': elapsed, 'result': ground})

output = {'build': '2000924', 'serverSha256': sha,
          'jumpBlock': '0xab2251..0xab2295', 'groundBlock': '0xadbc95..0xadbcb7',
          'scope': 'Arithmetic only; timestamp helper/initial landing-state construction supplied by fixture; no native collision or complete movement engine.',
          'constants': {'ladderDetachSpeed': struct.unpack('<f', pe.get_data(0x192393c, 4))[0]},
          'cases': cases}
assert output['constants']['ladderDetachSpeed'] == 270
path = root / 'src/range/native-terrain-fixture.json'
if args.write:
    path.write_text(json.dumps(output, indent=2) + '\n')
else:
    assert json.loads(path.read_text()) == output, 'Native terrain fixture changed'
print(f'{len(cases)} hash-pinned native landing-factor cases verified')
