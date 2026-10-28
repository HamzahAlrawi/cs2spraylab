"""Offline spread arithmetic audit. Never loads a DLL or accesses a game process.

Build 2000930 sampler was located through its float32 2*pi references, then
inspected at d235a0..d238c4. Uniform draws and trigonometry are isolated stubs;
native weapon identity/cache and pattern-off flags are fixture inputs.
"""
import argparse
import hashlib
import json
import math
import os
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn import x86_const as reg

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
SHA = '44af2aa0d2c64f90d273444cb393b8b679094f0b02136dbdb89d4ec82a560008'
START, END = 0xd235a0, 0xd238c4


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def verify():
    raw = (GAME / 'game/csgo/bin/win64/client.dll').read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHA:
        raise SystemExit('Client build changed: re-inspect spread offsets before emulation.')
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    machine = Uc(UC_ARCH_X86, UC_MODE_64)
    machine.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
    machine.mem_write(base, pe.get_memory_mapped_image())
    heap, stack = 0x10000000, 0x20000000
    machine.mem_map(heap, 0x10000)
    machine.mem_map(stack, 0x10000)
    manager, revolver, negev, pattern_flag = [heap + n * 0x100 for n in range(1, 5)]
    rng_stub, cos_stub, sin_stub = [heap + 0x1000 + n * 0x100 for n in range(3)]
    pointer = lambda address, value: machine.mem_write(address, struct.pack('<Q', value & ((1 << 64) - 1)))
    scalar = lambda address, value: machine.mem_write(address, struct.pack('<f', value))

    def xmm(register, value):
        machine.reg_write(register, struct.unpack('<I', struct.pack('<f', value))[0])

    def value(register):
        return struct.unpack('<f', struct.pack('<I', machine.reg_read(register) & 0xffffffff))[0]

    for address, destination in [(0x1aa7668, rng_stub), (0x1aa78a0, cos_stub), (0x1aa7898, sin_stub),
                                 (0x2237700, revolver), (0x2237718, negev), (0x25b5aa0, pattern_flag)]:
        pointer(base + address, destination)
    for address in [manager + 0x34, base + 0x2237708, base + 0x2237720]:
        machine.mem_write(address, struct.pack('<I', 1))
    machine.mem_write(revolver + 0x10, struct.pack('<H', 64))
    machine.mem_write(negev + 0x10, struct.pack('<H', 28))
    machine.mem_write(pattern_flag + 0x58, b'\0')
    samples, draw = [], 0

    def hook(uc, address, _size, _data):
        nonlocal draw
        if base + START <= address < base + END:
            return
        if address == rng_stub:
            if draw >= len(samples):
                raise RuntimeError('Unexpected uniform draw')
            low, high = value(reg.UC_X86_REG_XMM0), value(reg.UC_X86_REG_XMM1)
            xmm(reg.UC_X86_REG_XMM0, low + samples[draw] * (high - low))
            draw += 1
        elif address in [cos_stub, sin_stub]:
            function = math.cos if address == cos_stub else math.sin
            xmm(reg.UC_X86_REG_XMM0, function(value(reg.UC_X86_REG_XMM0)))
        elif address == base + 0x111e0f0:
            uc.reg_write(reg.UC_X86_REG_RAX, manager)
        else:
            raise RuntimeError(f'Unverified execution path at {address - base:#x}')
        sp = uc.reg_read(reg.UC_X86_REG_RSP)
        uc.reg_write(reg.UC_X86_REG_RIP, struct.unpack('<Q', uc.mem_read(sp, 8))[0])
        uc.reg_write(reg.UC_X86_REG_RSP, sp + 8)

    machine.hook_add(UC_HOOK_CODE, hook)
    variants = [('ak47', 7, False, 0), ('revolver', 64, False, 0), ('revolver', 64, True, 0)]
    variants += [('negev', 28, False, index) for index in [0, .5, 1, 2, 3]]
    inputs = [([.1, .2, .3, .4], .0065, .003), ([0, 0, 1, .99], 0, .0006), ([.999, .875, .5, .25], .05, .01)]
    cases = []
    for weapon, identity, alternate, index in variants:
        for samples, inaccuracy, spread in inputs:
            draw = 0
            sp, horizontal, vertical = stack + 0x8000, heap + 0x8000, heap + 0x8008
            machine.reg_write(reg.UC_X86_REG_RSP, sp)
            for register, number in [(reg.UC_X86_REG_RDI, 0), (reg.UC_X86_REG_RSI, identity),
                                     (reg.UC_X86_REG_RBP, int(alternate)), (reg.UC_X86_REG_R12, 0),
                                     (reg.UC_X86_REG_R13, vertical), (reg.UC_X86_REG_R14, 0), (reg.UC_X86_REG_R15, 0)]:
                machine.reg_write(register, number)
            machine.mem_write(sp + 0x118, struct.pack('<I', 1))
            pointer(sp + 0x38, 1)
            pointer(sp + 0x148, horizontal - vertical)
            scalar(sp + 0x138, spread)
            for register, number in [(reg.UC_X86_REG_XMM9, index), (reg.UC_X86_REG_XMM10, 1),
                                     (reg.UC_X86_REG_XMM11, 3), (reg.UC_X86_REG_XMM13, math.pi / 2),
                                     (reg.UC_X86_REG_XMM14, 2 * math.pi), (reg.UC_X86_REG_XMM15, inaccuracy)]:
                xmm(register, number)
            machine.emu_start(base + START, base + END, count=600)
            if machine.reg_read(reg.UC_X86_REG_RIP) != base + END or draw != 4:
                raise RuntimeError('Spread arithmetic budget or draw count changed')
            read = lambda address: struct.unpack('<f', machine.mem_read(address, 4))[0]
            cases.append({'weaponId': weapon, 'alternateFire': alternate, 'recoilIndex': index,
                          'random': samples, 'inaccuracy': inaccuracy, 'spread': spread,
                          'horizontal': read(horizontal), 'vertical': read(vertical)})
    return {'build': '2000930', 'clientSha256': SHA, 'range': [hex(START), hex(END)],
            'limitations': ['Supplied uniform draws, not native command/subtick seed derivation.',
                            'Python float32 sin/cos substitutes, not native V_sinf/V_cosf.',
                            'Pattern-off single-pellet sampler only; weapon state and final ray tested separately.'],
            'cases': cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    result = verify()
    path = ROOT / 'src/range/native-spread-fixture.json'
    if args.write:
        path.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\n')
    elif json.loads(path.read_text()) != result:
        raise SystemExit('Numeric spread fixture changed: re-inspect before regeneration.')
    print(f"Verified {len(result['cases'])} native spread cases; client SHA256 {SHA}")


if __name__ == '__main__':
    main()
