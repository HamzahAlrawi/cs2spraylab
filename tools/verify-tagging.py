"""Offline arithmetic fixtures; does not load, run, or hook the game process.

Requires pefile/unicorn. Only the pinned tagging routines are emulated;
weapon lookup, ConVar access and network notifications are stubbed.
"""
import hashlib
import json
import os
import struct
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

root = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw = (root / 'game/csgo/bin/win64/server.dll').read_bytes()
sha = hashlib.sha256(raw).hexdigest()
assert sha == 'f95fe0dcd7b526137a8b305dd76a72f624e0508ad42bb5949d05c77a37e1bd70', 'Game build changed: re-audit, do not replace the hash blindly'
pe = pefile.PE(data=raw)
base = pe.OPTIONAL_HEADER.ImageBase
uc = Uc(UC_ARCH_X86, UC_MODE_64)
uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
uc.mem_write(base, pe.get_memory_mapped_image())
heap, stack = 0x10000000, 0x20000000
uc.mem_map(heap, 0x10000); uc.mem_map(stack, 0x10000)
actor, services, weapon, vtable, reactions, clock = [heap + n * 0x2000 for n in range(6)]
sentinel, speed_stub = heap + 0xe000, heap + 0xe100

def write_float(address, value): uc.mem_write(address, struct.pack('<f', value))
def read_float(address): return struct.unpack('<f', uc.mem_read(address, 4))[0]
def pointer(address, value): uc.mem_write(address, struct.pack('<Q', value))
def xmm(reg, value): uc.reg_write(reg, struct.unpack('<I', struct.pack('<f', value))[0])

pointer(actor + 0xb10, services); pointer(actor + 0xb50, reactions)
pointer(weapon, vtable); pointer(vtable + 0xc20, speed_stub)
pointer(0x181e31690, clock)
uc.mem_write(actor + 0x388, b'\x01')
held_speed = 225

def hook(uc, address, size, _):
    if address in [sentinel, 0x180ad7e53]:
        uc.emu_stop(); return
    if address == 0x180187f30:
        xmm(UC_X86_REG_XMM0, 1)  # mp_tagging_scale; aim-flinch cap does not affect the result
    elif address == 0x180c81950:
        uc.reg_write(UC_X86_REG_RAX, weapon)
    elif address == speed_stub:
        xmm(UC_X86_REG_XMM0, held_speed)
    elif address not in [0x1801d63f0, 0x1801d6a30, 0x1801d67b0]:
        return
    sp = uc.reg_read(UC_X86_REG_RSP)
    uc.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', uc.mem_read(sp, 8))[0])
    uc.reg_write(UC_X86_REG_RSP, sp + 8)

uc.hook_add(UC_HOOK_CODE, hook)

def execute(address):
    sp = stack + 0x8008
    pointer(sp, sentinel)
    uc.reg_write(UC_X86_REG_RSP, sp)
    uc.reg_write(UC_X86_REG_RCX, actor)
    uc.emu_start(address, sentinel, count=5000)
    assert uc.reg_read(UC_X86_REG_RIP) in [sentinel, 0x180ad7e53], 'Unexpected execution path'

data = json.loads(Path('src/range/tagging-data.json').read_text())
assert data['build'] == '2000919', 'Tagging input and audited DLL builds differ'
cases = []
for attacker, victim in [('ak47', 'm4a4'), ('ak47', 'knife'), ('usp', 'ak47'), ('mp9', 'ak47'), ('knife', 'm4a4'), ('m4a1s', 'negev')]:
    held_speed = data['weapons'][victim]['speed']
    write_float(actor + 0x14ec, 1); write_float(actor + 0x14f0, 1)
    hits = []
    for i in range(4):
        if i:
            write_float(clock + 0x34, 1 / 128)
            for _ in range(12):
                execute(0x180ac3a40)
                pointer(services + 0x38, actor)
                uc.reg_write(UC_X86_REG_RDI, services)
                execute(0x180ad7d61)
        xmm(UC_X86_REG_XMM1, data['weapons'][attacker]['large'])
        xmm(UC_X86_REG_XMM2, data['weapons'][attacker]['small'])
        xmm(UC_X86_REG_XMM3, 1)
        execute(0x180ab2960)
        hits.append({'stack': read_float(actor + 0x14ec), 'modifier': read_float(actor + 0x14f0)})
    cases.append({'attacker': attacker, 'victim': victim, 'gapTicks': 12, 'hits': hits})

recovery = []
for grounded, ticks in [(True, 64), (False, 64), (True, 384)]:
    write_float(actor + 0x14ec, .4); write_float(actor + 0x14f0, .3)
    uc.mem_write(actor + 0x388, b'\x01' if grounded else b'\x00')
    write_float(clock + 0x34, 1 / 128)
    for _ in range(ticks):
        execute(0x180ac3a40)
        pointer(services + 0x38, actor)
        uc.reg_write(UC_X86_REG_RDI, services)
        execute(0x180ad7d61)
    recovery.append({'grounded': grounded, 'ticks': ticks,
                     'stack': read_float(actor + 0x14ec), 'modifier': read_float(actor + 0x14f0)})

output = {'build': data['build'], 'serverSha256': sha, 'weaponSha256': data['sha256'],
          'tagRva': '0xab2960', 'stackRecoveryRva': '0xac3a40', 'movementRecoveryRva': '0xad7d61',
          'note': 'Offline native arithmetic, standard tagging scale 1; lookup/notification calls stubbed. Not a live movement parity measurement.', 'cases': cases, 'recovery': recovery}
Path('src/range/tagging-native-fixture.json').write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps(output, indent=2))
