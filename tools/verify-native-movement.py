"""Offline numeric acceleration fixture, CS2 build 2000919.

Requires pefile/unicorn. Only hash-pinned arithmetic is emulated. Pawn/weapon
lookups are stubbed; no game process, native DLL loading or OS calls are used.
The fixture excludes friction, collisions, water and scoped-weapon branches.
"""
import argparse
import hashlib
import json
import os
import struct
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw = (game / 'game/csgo/bin/win64/server.dll').read_bytes()
sha = hashlib.sha256(raw).hexdigest()
assert sha == 'f95fe0dcd7b526137a8b305dd76a72f624e0508ad42bb5949d05c77a37e1bd70', 'Build changed: re-audit offsets'
pe = pefile.PE(data=raw)
base = pe.OPTIONAL_HEADER.ImageBase
uc = Uc(UC_ARCH_X86, UC_MODE_64)
uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
uc.mem_write(base, pe.get_memory_mapped_image())
heap, stack = 0x10000000, 0x20000000
uc.mem_map(heap, 0x20000); uc.mem_map(stack, 0x10000)
movement, pawn, weapon, vtable, movedata, wish, cvars = [heap + i * 0x2000 for i in range(7)]
sentinel, speed_stub, zoom_stub = heap + 0x1e000, heap + 0x1e100, heap + 0x1e200

def pointer(address, value): uc.mem_write(address, struct.pack('<Q', value))
def write_float(address, value): uc.mem_write(address, struct.pack('<f', value))
def read_float(address): return struct.unpack('<f', uc.mem_read(address, 4))[0]
def xmm(reg, value): uc.reg_write(reg, struct.unpack('<I', struct.pack('<f', value))[0])

pointer(movement + 0x38, pawn); pointer(pawn + 0xb10, weapon)
pointer(pawn + 0xe30, heap + 0x1a000)
uc.mem_write(heap + 0x1a048, struct.pack('<i', -1))
pointer(weapon, vtable); pointer(vtable + 0xc20, speed_stub); pointer(vtable + 0xcb0, zoom_stub)
pointer(0x182174520, cvars); uc.mem_write(cvars + 0x58, b'\x01')
pointer(0x182174530, cvars + 0x100)  # debug disabled
write_float(movement + 0x26c, 1)  # surface friction
write_float(wish, 1)
held_speed = 215

def hook(machine, address, _size, _data):
    if address == 0x180c81950:
        machine.reg_write(UC_X86_REG_RAX, weapon)
    elif address == speed_stub:
        xmm(UC_X86_REG_XMM0, held_speed)
    elif address in [zoom_stub, 0x1803d3330]:
        machine.reg_write(UC_X86_REG_RAX, 0)
    else:
        return
    sp = machine.reg_read(UC_X86_REG_RSP)
    machine.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', machine.mem_read(sp, 8))[0])
    machine.reg_write(UC_X86_REG_RSP, sp + 8)

uc.hook_add(UC_HOOK_CODE, hook)
cases = []
for held_speed in [150, 215, 225, 240, 250]:
    for stance in ['run', 'walk', 'crouch']:
        cap = held_speed * {'run': 1, 'walk': .52, 'crouch': .34}[stance]
        for tag in [1, .35]:
            for current in [0, -80, cap * .9, cap]:
                for dt in [1 / 128, 1 / 64]:
                    uc.mem_write(movedata, bytes(0x200))
                    write_float(movedata + 0x38, current)
                    pointer(movement + 0x58, {'run': 0, 'walk': 1 << 16, 'crouch': 4}[stance])
                    sp = stack + 0x8008
                    pointer(sp, sentinel)
                    write_float(sp + 0x28, cap * tag)
                    write_float(sp + 0x30, 5.5)
                    uc.reg_write(UC_X86_REG_RSP, sp)
                    uc.reg_write(UC_X86_REG_RCX, movement)
                    uc.reg_write(UC_X86_REG_RDX, movedata)
                    uc.reg_write(UC_X86_REG_R9, wish)
                    xmm(UC_X86_REG_XMM2, dt)
                    try:
                        uc.emu_start(0x180ab1ff0, sentinel, count=4000)
                    except Exception as error:
                        raise RuntimeError(f'Offline path failed at {uc.reg_read(UC_X86_REG_RIP):#x}, {stance=}, {held_speed=}') from error
                    assert uc.reg_read(UC_X86_REG_RIP) == sentinel, 'Unexpected execution path'
                    cases.append({'weaponSpeed': held_speed, 'stance': stance, 'tag': tag,
                                  'current': current, 'dt': dt, 'wishSpeed': cap * tag,
                                  'result': read_float(movedata + 0x38)})
output = {'build': '2000919', 'serverSha256': sha, 'accelerateRva': '0xab1ff0',
          'note': 'Native acceleration only; friction/collision/duck-speed state and scoped/water branches excluded.', 'cases': cases}
path = root / 'src/range/native-movement-fixture.json'
if args.write:
    path.write_text(json.dumps(output, indent=2) + '\n')
else:
    assert json.loads(path.read_text()) == output, 'Native fixture changed'
print(f'{len(cases)} native acceleration cases verified')
