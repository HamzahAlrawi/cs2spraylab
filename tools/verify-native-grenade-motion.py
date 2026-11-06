"""Isolated current grenade arithmetic with explicit engine getters/traces, never a loaded DLL."""
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
from unicorn import x86_const as r

game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw = (game / 'game/csgo/bin/win64/server.dll').read_bytes()
SHA = '70c66e850b2ce72c8c7ca026de6989ef4de7f12dad64ec503645fbd2a7f06d9f'
if hashlib.sha256(raw).hexdigest() != SHA:
    raise SystemExit('Installed server changed: re-inspect motion/contact before regenerating')
pe = pefile.PE(data=raw)
base = pe.OPTIONAL_HEADER.ImageBase
u = Uc(UC_ARCH_X86, UC_MODE_64)
u.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
u.mem_write(base, pe.get_memory_mapped_image())
heap, stack = 0x10000000, 0x20000000
u.mem_map(heap, 0x10000)
u.mem_map(stack, 0x10000)
f = lambda x: struct.unpack('<f', struct.pack('<f', x))[0]
scalar = lambda at, x: u.mem_write(at, struct.pack('<f', x))
pointer = lambda at, x: u.mem_write(at, struct.pack('<Q', x))
putvec = lambda at, v: u.mem_write(at, struct.pack('<3f', *v))
getvec = lambda at: list(struct.unpack('<3f', u.mem_read(at, 12)))
actor, hit, trace, output, local, basevel, globalvars = [heap + n * 0x1000 for n in range(7)]
sentinel = heap + 0xf000
velocity = [0, 0, 0]
pushes, fractions, normals = [], [], []
supported, grounded, dt = True, False, 1 / 128
smoke_now,smoke_detonated=0,False

def ret(value=None):
    if value is not None:
        u.reg_write(r.UC_X86_REG_RAX, value)
    sp = u.reg_read(r.UC_X86_REG_RSP)
    u.reg_write(r.UC_X86_REG_RIP, struct.unpack('<Q', u.mem_read(sp, 8))[0])
    u.reg_write(r.UC_X86_REG_RSP, sp + 8)

def xmm(register, value):
    u.reg_write(register, struct.unpack('<I', struct.pack('<f', value))[0])

def hook(_u, address, _size, _data):
    global velocity, grounded,smoke_detonated
    at = address - base
    if address == sentinel or at == 0x9cf007:
        u.emu_stop()
    elif at == 0x3d6fb0:
        dest = u.reg_read(r.UC_X86_REG_RDX)
        putvec(dest, velocity)
        ret(dest)
    elif at == 0x3d7740:
        dest = u.reg_read(r.UC_X86_REG_RDX)
        putvec(dest, [0, 0, 0])
        ret(dest)
    elif at == 0x927c20:
        xmm(r.UC_X86_REG_XMM0, dt)
        ret()
    elif at == 0x927cb0:
        dest=u.reg_read(r.UC_X86_REG_RCX)
        scalar(dest,smoke_now)
        ret(dest)
    elif at == 0x3eb9e0:
        ret()
    elif address == heap+0xe100:
        smoke_detonated=True
        u.emu_stop()
    elif at == 0x187770:
        xmm(r.UC_X86_REG_XMM0, 800)
        ret()
    elif at == 0x3ea4a0:
        velocity = getvec(u.reg_read(r.UC_X86_REG_RDX))
        ret()
    elif at in [0x3ea860, 0x3eb230, 0xe8eb40]:
        ret()
    elif at == 0x16b6d80 or address == heap + 0xe000:
        ret(0)
    elif at == 0x3e0100:
        ret(int(supported))
    elif at == 0xe95a10:
        grounded = True
        ret()
    elif at == 0x148890:
        dest = u.reg_read(r.UC_X86_REG_RCX)
        v = getvec(dest)
        length = f(math.sqrt(f(f(f(v[2]*v[2]) + f(v[1]*v[1])) + f(v[0]*v[0]))))
        putvec(dest, [f(n * f(1 / length)) for n in v] if length else [0, 0, 0])
        ret()
    elif at == 0xe8f7d0:
        delta = getvec(u.reg_read(r.UC_X86_REG_RDX))
        index = len(pushes)
        pushes.append(delta)
        dest = u.reg_read(r.UC_X86_REG_R8)
        scalar(dest + 0xac, fractions[index] if index < len(fractions) else 1)
        putvec(dest + 0x90, normals[index] if index < len(normals) else [0, 0, 1])
        ret()
    elif not (0xe8e9b0 <= at < 0xe8eb36 or 0xe8efa0 <= at < 0xe8f02a or
              0x9ce9d5 <= at < 0x9cf007 or 0x9d4721 <= at < 0x9d4793):
        raise RuntimeError(f'Unverified native path {at:#x}')

u.hook_add(UC_HOOK_CODE, hook)

def reset():
    u.mem_write(heap, bytes(0x10000))
    u.mem_write(stack, bytes(0x10000))
    pointer(base + 0x1e328d0, globalvars)
    scalar(globalvars + 0x34, dt)
    pointer(actor + 0x10, actor + 0x800)
    scalar(actor + 0x40c, .4)
    sp = stack + 0x8000
    pointer(sp, sentinel)
    u.reg_write(r.UC_X86_REG_RSP, sp)
    return sp

integration = []
for initial in [[675, 0, 117.21251678466797], [120, -250, 800], [0, 0, -900], [0, 0, 0]]:
    for dt in [1 / 128, .003125]:
        reset()
        velocity = initial[:]
        for reg, val in [(r.UC_X86_REG_RCX, actor), (r.UC_X86_REG_RDX, output)]:
            u.reg_write(reg, val)
        u.emu_start(base + 0xe8e9b0, sentinel, count=500)
        integration.append({'velocity': initial, 'dt': dt, 'delta': getvec(output), 'after': velocity})

contacts = []
for initial, normal, supported, fraction, secondary in [
    ([300, 40, -500], [0, 0, 1], True, .25, 1),
    ([100, 50, 0], [-1, 0, 0], True, .25, .2),
    ([100, 50, -400], [-1, 0, 0], True, .4, .7),
    ([100, 50, -400], [-1, 0, 0], True, .4, .2),
    ([100, 50, -400], [-1, 0, 0], True, .4, .5),
    ([0, 0, -5], [0, 0, 1], True, .8, 1),
    ([0, 0, -1000], [0, 0, 1], True, .2, 1),
    ([0, 0, -1000], [0, 0, 1], False, .2, 1),
]:
    dt = 1 / 128
    sp = reset()
    pushes = []
    fractions = [secondary, 1]
    normals = [[0, 0, 1], [0, 1, 0]]
    velocity = initial[:]
    grounded = False
    scalar(actor + 0x3f8, .45)
    pointer(hit, heap + 0xd000)
    pointer(heap + 0xd000 + 0x558, heap + 0xe000)
    pointer(heap + 0xd000 + 0x570, heap + 0xe000)
    putvec(trace + 0x90, normal)
    scalar(trace + 0xac, fraction)
    for reg, val in [(r.UC_X86_REG_RDI, actor), (r.UC_X86_REG_RSI, hit), (r.UC_X86_REG_R14, trace),
                     (r.UC_X86_REG_R15, output), (r.UC_X86_REG_R12, 0), (r.UC_X86_REG_RBP, sp + 0x100)]:
        u.reg_write(reg, val)
    xmm(r.UC_X86_REG_XMM7, 1)
    xmm(r.UC_X86_REG_XMM8, 0)
    xmm(r.UC_X86_REG_XMM14, 1e-17)
    try:
        u.emu_start(base + 0x9ce9d5, base + 0x9cf008, count=2000)
    except Exception as error:
        raise RuntimeError(f'Contact {initial}: RIP={u.reg_read(r.UC_X86_REG_RIP):#x}, hit={u.reg_read(r.UC_X86_REG_RSI):#x}') from error
    contacts.append({'velocity': initial, 'normal': normal, 'supportEligible': supported, 'fraction': fraction,
                     'secondaryFraction': secondary, 'secondaryNormal': normals[0], 'dt': dt,
                     'after': velocity, 'resting': grounded, 'pushes': pushes})

smokes=[]
for age,speed in [(1,0),(1.1875,0),(1.203125,0),(8,100),(12,100),(30,100),(12,0)]:
    dt=1/128
    sp=reset()
    pointer(sp+0x48,sentinel)
    pointer(actor,heap+0xd000)
    pointer(heap+0xd000+0x9a8,heap+0xe100)
    scalar(actor+0xb08,0)
    u.reg_write(r.UC_X86_REG_RDI,actor)
    xmm(r.UC_X86_REG_XMM0,speed)
    smoke_now,smoke_detonated=age,False
    u.emu_start(base+0x9d4721,sentinel,count=200)
    smokes.append({'age':age,'speed':speed,'detonated':smoke_detonated})

report = {'build': '2000942', 'serverSha256': SHA, 'integrationRva': '0xe8e9b0..0xe8eb36',
          'contactRva': '0x9ce9d5..0x9cf007', 'clipRva': '0xe8efa0..0xe8f02a',
          'method': 'Isolated static native arithmetic; getter/setter, time, gravity, support, normalization and world traces are explicit fixture inputs/stubs.',
          'excluded': 'No live game, DLL loading, full entity dispatch, trace solver, moving supports, breakables or first-spawn scheduling.',
          'smokeGateRva':'0x9d4721..0x9d4793','integration': integration, 'contacts': contacts,'smokes':smokes}
path = ROOT / 'src/range/duel/native-grenade-motion-fixture.json'
if '--write' in sys.argv:
    path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8', newline='\n')
elif json.loads(path.read_text()) != report:
    raise SystemExit('Native grenade motion fixture mismatch')
print(f'PASS {len(integration)} integration, {len(contacts)} ordinary contact/residual and {len(smokes)} smoke gate fixtures')
