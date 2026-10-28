"""Generate/check flash fixtures using isolated replay of pinned server.dll bytes.

Never loads a DLL into Windows, attaches to CS2, or reads game process memory.
"""
import argparse
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local-tools/analysis-python'))
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--write', action='store_true', help='Regenerate the checked-in test-only JSON')
args = parser.parse_args()
SHA = '2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c'
path = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive')) / 'game/csgo/bin/win64/server.dll'
raw = path.read_bytes()
if hashlib.sha256(raw).hexdigest() != SHA:
    raise SystemExit('Installed server.dll does not match pinned build 2000935; refusing to regenerate')
pe = pefile.PE(data=raw, fast_load=True)
BASE = pe.OPTIONAL_HEADER.ImageBase
uc = Uc(UC_ARCH_X86, UC_MODE_64)
uc.mem_map(BASE, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
for section in pe.sections:
    uc.mem_write(BASE + section.VirtualAddress, section.get_data())
STACK, ENTITY, STOP = 0x70008000, 0x60000000, 0x60003000
uc.mem_map(0x70000000, 0x10000)
uc.mem_map(ENTITY, 0x10000)
clock = 10.0

def f32(v):
    return struct.unpack('<f', struct.pack('<f', v))[0]

def constant(rva):
    return struct.unpack('<f', pe.get_data(rva, 4))[0]

def writef(addr, v):
    uc.mem_write(addr, struct.pack('<f', v))

def readf(addr):
    return struct.unpack('<f', uc.mem_read(addr, 4))[0]

def setx(reg, v):
    uc.reg_write(reg, struct.unpack('<I', struct.pack('<f', v))[0])

def getx(reg):
    return struct.unpack('<f', struct.pack('<I', uc.reg_read(reg) & 0xffffffff))[0]

def ret():
    rsp = uc.reg_read(UC_X86_REG_RSP)
    uc.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', uc.mem_read(rsp, 8))[0])
    uc.reg_write(UC_X86_REG_RSP, rsp + 8)

def hook(uc, addr, size, user):
    if addr in (STOP, BASE + 0x3adf3b):
        uc.emu_stop()
    elif addr == BASE + 0x92db00:
        ptr = uc.reg_read(UC_X86_REG_RCX)
        writef(ptr, clock)
        uc.reg_write(UC_X86_REG_RAX, ptr)
        ret()
    elif addr in (BASE + 0x216d00, BASE + 0x216e40):
        ret()  # Network dirty notification, no arithmetic result.

uc.hook_add(UC_HOOK_CODE, hook)

def run(begin, end):
    uc.emu_start(BASE + begin, BASE + end, count=10000)
    if uc.reg_read(UC_X86_REG_RIP) not in (BASE + end, BASE + 0x3adf3b):
        raise AssertionError('Native replay did not reach expected boundary')

def native_arguments(distance, dot, visibility):
    # API starts after vector length/dot calculation. Replay the scalar blocks,
    # preserving their original division, multiplication and branch instructions.
    uc.reg_write(UC_X86_REG_RSP, STACK)
    uc.reg_write(UC_X86_REG_R14, ENTITY)
    setx(UC_X86_REG_XMM15, 3)
    setx(UC_X86_REG_XMM12, 0)
    run(0x3ad912, 0x3ad924)
    setx(UC_X86_REG_XMM0, distance)
    run(0x3adab0, 0x3adac7)
    if uc.reg_read(UC_X86_REG_RIP) == BASE + 0x3adf3b:
        return {'hold': 0.0, 'fade': 0.0, 'duration': 0.0}
    setx(UC_X86_REG_XMM8, dot)
    setx(UC_X86_REG_XMM13, visibility)
    run(0x3adc22, 0x3adc98)
    hold, fade = getx(UC_X86_REG_XMM6), getx(UC_X86_REG_XMM7)
    # Execute the actual duration-divide instruction, not a Python formula.
    run(0x1fb094, 0x1fb09c)
    return {'hold': hold, 'fade': fade, 'duration': getx(UC_X86_REG_XMM7)}

def apply(hold, fade, now=10, prior=None):
    global clock
    clock = now
    uc.mem_write(ENTITY, bytes(0x2000))
    uc.mem_write(ENTITY+0x10, struct.pack('<Q', ENTITY+0x1000))
    if prior:
        for key, offset in [('blindUntil', 0xd38), ('blindStart', 0xd3c), ('duration', 0xe04), ('alpha', 0xe08)]:
            writef(ENTITY+offset, prior[key])
    uc.reg_write(UC_X86_REG_RSP, STACK-8)
    uc.mem_write(STACK-8, struct.pack('<Q', STOP))
    uc.reg_write(UC_X86_REG_RCX, ENTITY)
    setx(UC_X86_REG_XMM1, hold)
    setx(UC_X86_REG_XMM2, fade)
    setx(UC_X86_REG_XMM3, 255)
    uc.emu_start(BASE+0x1faf60, STOP, count=10000)
    assert uc.reg_read(UC_X86_REG_RIP) == STOP
    return dict(zip(['blindUntil', 'blindStart', 'duration', 'alpha'], [readf(ENTITY+x) for x in [0xd38, 0xd3c, 0xe04, 0xe08]]))

source = {'build': 2000935, 'module': 'server.dll', 'sha256': SHA, 'rvas': {
    'detonate': '0x3aaeb0', 'radial': '0x3ad840', 'visibility': '0x3ad2d0',
    'radius': '0x1dae828', 'distance': '0x3adab0', 'facing': '0x3adc22',
    'playerWrapper': '0x1faf60', 'apply': '0x1fafd0', 'durationDivide': '0x1fb094'}}
constants = {'strength': constant(0x178ae08), 'radiusUnits': constant(0x1dae828),
    'fadeDivisor': constant(0x17a0874), 'maxAlpha': constant(0x178ae18),
    'updateBump': constant(0x17a0864),
    'facingDots': [constant(x) for x in [0x17b8430, 0x1795d6c, 0x17cf13c]],
    'holdMultipliers': [constant(x) for x in [0x17cf130, 0x1795d74, 0x178657c, 0x1795d68]],
    'fadeMultipliers': [constant(x) for x in [0x1795d88, 0x17c95bc, 0x1786580, 0x178657c]]}
cases = []
for distance in [0.001, 500, 1000, 2000, 2999, 3000, 3001]:
    for dot in [1, f32(.6), f32(.6)-2**-24, f32(.3), f32(.3)-2**-25, 0, f32(-.2), f32(-.2)-2**-26, -1]:
        for visibility in [0, f32(.167), f32(.334), f32(.501), 1]:
            a = native_arguments(distance, dot, visibility)
            state = apply(a['hold'], a['fade']) if visibility > 0 and distance < 3000 else None
            cases.append({'id': len(cases), 'distanceUnits': distance, 'dot': dot, 'visibility': visibility,
                          'time': 10, 'arguments': a, 'state': state})
strong = native_arguments(500, 1, 1)
weak = native_arguments(500, -1, 1)
prior = apply(strong['hold'], strong['fade'])
overlaps = []

def overlap(name, p, h, tail, time):
    overlaps.append({'name': name, 'prior': p, 'hold': h, 'fade': tail, 'time': time,
                     'state': apply(h, tail, time, p)})

overlap('weak-after-one-second', prior, weak['hold'], weak['fade'], 11)
overlap('same-time-update-bump', prior, strong['hold'], strong['fade'], 10)
overlap('deadline-equality-is-active', prior, weak['hold'], weak['fade'], prior['blindUntil'])
overlap('expired-resets-duration-alpha', {**prior, 'alpha': 300}, weak['hold'], weak['fade'], 20)
overlap('active-preserves-higher-alpha', {**prior, 'alpha': 300}, weak['hold'], weak['fade'], 11)
overlap('stronger-replaces-weak', apply(weak['hold'], weak['fade']), strong['hold'], strong['fade'], 10.25)
overlap('float32-time-and-addition-order', {'blindUntil': 100000, 'blindStart': 99999.75, 'duration': 4.464285850524902, 'alpha': 255}, .625, 1.25, 100000.001)
fixture = {'source': source, 'constants': constants,
    'method': 'Isolated Unicorn replay of pinned static x64 scalar blocks and player Blind; no collision/renderer parity claim.',
    'cases': cases, 'overlaps': overlaps}
output = ROOT / 'src/range/duel/native-grenade-flash-fixture.json'
if args.write:
    output.write_text(json.dumps(fixture, indent=2)+'\n', encoding='utf-8')
else:
    assert json.loads(output.read_text(encoding='utf-8')) == fixture, 'Fixture differs; review native changes before --write'
print(f'PASS {len(cases)} native scalar cases + {len(overlaps)} overlap cases ({"wrote" if args.write else "verified"} fixture)')
