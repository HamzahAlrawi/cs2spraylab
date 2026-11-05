"""Verify hash-pinned CS2 damage-punch arithmetic without loading a game DLL.

Unicorn emulates only the hitgroup arithmetic blocks. Aim services and RNG are
stubbed; no process, hooks, OS calls, multiplayer or live game interaction.
"""
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local-tools/analysis-python'))
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_RSP, UC_X86_REG_RBP, UC_X86_REG_RDI,
    UC_X86_REG_R14, UC_X86_REG_R15, UC_X86_REG_R13, UC_X86_REG_RIP,
    UC_X86_REG_XMM0, UC_X86_REG_XMM6, UC_X86_REG_XMM7, UC_X86_REG_XMM8,
    UC_X86_REG_XMM9, UC_X86_REG_XMM10, UC_X86_REG_XMM14, UC_X86_REG_RSI)

game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw = (game / 'game/csgo/bin/win64/server.dll').read_bytes()
sha = hashlib.sha256(raw).hexdigest()
assert sha == '7e88b23196b0a746d99c7c622f947b96c25de61cc4d921d8dda79e515c4b48a8', 'Build changed: re-audit before updating offsets'
pe = pefile.PE(data=raw); base = pe.OPTIONAL_HEADER.ImageBase
uc = Uc(UC_ARCH_X86, UC_MODE_64)
uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
uc.mem_write(base, pe.get_memory_mapped_image())
heap, stack = 0x10000000, 0x20000000
uc.mem_map(heap, 0x10000); uc.mem_map(stack, 0x10000)
actor, armor_service, convar = heap, heap + 0x3000, heap + 0x4000
sp, bp = stack + 0x4000, stack + 0x8000
branches = struct.unpack('<8I', pe.get_data(0xa8fcd0, 32))
uc.mem_write(base + 0x2177a78, struct.pack('<Q', convar))
uc.mem_write(convar + 0x58, struct.pack('<f', 3))
uc.mem_write(actor + 0xb18, struct.pack('<Q', armor_service))
punch = None
roll_random = 0

def scalar(reg, value): uc.reg_write(reg, struct.unpack('<I', struct.pack('<f', value))[0])

def hook(machine, address, _size, _):
    global punch
    if address == base + 0xa8fa15:
        machine.emu_stop(); return
    if address == base + 0xa454b0:
        # Capture native (pitch,yaw,roll) BEFORE the angle-service notification.
        punch = struct.unpack('<3f', machine.mem_read(sp + 0x30, 12))
    elif address == base + 0x168d261: scalar(UC_X86_REG_XMM0, roll_random)
    else: return
    rsp = machine.reg_read(UC_X86_REG_RSP)
    machine.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', machine.mem_read(rsp, 8))[0])
    machine.reg_write(UC_X86_REG_RSP, rsp + 8)

uc.hook_add(UC_HOOK_CODE, hook)
cases = []
for group, index, multiplier in [('head', 0, 4), ('chest', 1, 1), ('stomach', 2, 1.25), ('arm', 3, 1), ('leg', 5, .75)]:
    for damage in [12, 36, 120, 700]:
        for armor in [0, 100]:
            for helmet in ([False, True] if group == 'head' else [False]):
                for roll_random in ([-.8, 0, .8] if group == 'head' and not helmet else [0]):
                    punch = None
                    uc.mem_write(stack, bytes(0x10000))
                    uc.mem_write(actor + 0x1514, struct.pack('<I', armor))
                    uc.mem_write(armor_service + 0x49, bytes([helmet]))
                    uc.reg_write(UC_X86_REG_RSP, sp); uc.reg_write(UC_X86_REG_RBP, bp)
                    uc.reg_write(UC_X86_REG_R14, actor); uc.reg_write(UC_X86_REG_RDI, heap + 0x5000)
                    uc.reg_write(UC_X86_REG_R13, 0); uc.reg_write(UC_X86_REG_R15, 0)
                    for reg, value in [(UC_X86_REG_XMM6, 1), (UC_X86_REG_XMM7, damage),
                            (UC_X86_REG_XMM8, 1), (UC_X86_REG_XMM9, 4), (UC_X86_REG_XMM10, 1)]: scalar(reg, value)
                    uc.emu_start(base + branches[index], base + 0xa8fa15, count=1000)
                    assert uc.reg_read(UC_X86_REG_RIP) == base + 0xa8fa15, 'Unexpected native path'
                    native = punch or (0, 0, 0)
                    cases.append({'group': group, 'rawDamage': damage * multiplier, 'armor': armor,
                        'helmet': helmet, 'random': (roll_random + 1) / 2,
                        'angle': {'pitch': -native[0], 'yaw': native[1], 'roll': native[2]}})

recovery = []
for initial in [(0, 0, 0), (.14, 0, 0), (.15, 0, 0), (.54, 0, 0),
                (3.564, 0, 0), (36, 0, 27), (4.4, -2.2, -6.6)]:
    point = heap + 0x7000
    uc.mem_write(point, struct.pack('<3f', *initial))
    for tick in range(1, 129):
        before = struct.unpack('<3f', uc.mem_read(point, 12))
        uc.reg_write(UC_X86_REG_RSP, sp); uc.reg_write(UC_X86_REG_RSI, point)
        scalar(UC_X86_REG_XMM10, math.exp(-8 / 128))
        scalar(UC_X86_REG_XMM8, 18 / 128); scalar(UC_X86_REG_XMM14, 1)
        # Execute the actual scale, length and radial subtraction helpers.
        uc.emu_start(base + 0xa45c1d, base + 0xa45c73, count=1000)
        assert uc.reg_read(UC_X86_REG_RIP) == base + 0xa45c73, 'Unexpected recovery path'
        after = struct.unpack('<3f', uc.mem_read(point, 12))
        if tick in [1, 2, 4, 16, 32, 64, 128]:
            recovery.append({'tick': tick, 'before': dict(zip(['pitch', 'yaw', 'roll'], before)),
                'after': dict(zip(['pitch', 'yaw', 'roll'], after))})

output = {'build': '2000940', 'serverSha256': sha, 'damageRva': '0xa8f6a0',
    'angleServiceRva': '0xa454b0', 'recoveryRva': '0xa459d0', 'scale': 3,
    'note': 'Offline native hitgroup arithmetic and 128 Hz angle recovery, pre-armor damage and standard team scales. RNG and angle-service calls stubbed. Angles use trainer up-positive pitch; not live game parity.', 'cases': cases, 'recovery': recovery}
(ROOT / 'src/range/aim-punch-native-fixture.json').write_text(json.dumps(output, indent=2) + '\n')
print(f'Verified {len(cases)} native damage-punch cases, build {output["build"]}, sha256 {sha}')
for group in ['head', 'chest', 'stomach', 'arm', 'leg']:
    print(group, [case for case in cases if case['rawDamage'] == 36 * (4 if group == 'head' else 1.25 if group == 'stomach' else .75 if group == 'leg' else 1)
        and case['group'] == group and case['random'] == .5])
