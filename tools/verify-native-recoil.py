"""Offline numeric fixtures. Requires pefile and unicorn, never loads a DLL.

Only the hash-pinned RNG and recoil-table instruction ranges are emulated.
Unresolved imports cannot call the OS or a live game process.
"""
import argparse
import hashlib
import json
import os
import struct
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_RSP, UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_RSI,
    UC_X86_REG_RBX, UC_X86_REG_RIP, UC_X86_REG_XMM0, UC_X86_REG_XMM1,
    UC_X86_REG_XMM2,
)

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
HASHES = {
    'game/csgo/bin/win64/client.dll': 'a0c195f0b6ec00915ef08c548200a010ebbe7982d3a4bc468cad939b67c8c4e3',
    'game/bin/win64/tier0.dll': 'add398561b7831fc3b59356a3c3e48b87ba8d8db376b156c1b68c4d710136a8a',
}


def image(relative):
    path = GAME / relative
    if hashlib.sha256(path.read_bytes()).hexdigest() != HASHES[relative]:
        raise SystemExit(f'{relative}: build changed; revalidate offsets before emulation')
    pe = pefile.PE(str(path))
    base = pe.OPTIONAL_HEADER.ImageBase
    machine = Uc(UC_ARCH_X86, UC_MODE_64)
    machine.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
    machine.mem_write(base, pe.get_memory_mapped_image())
    machine.mem_map(0x100000, 0x20000)
    return machine, base


def float_bits(value):
    return struct.unpack('<I', struct.pack('<f', value))[0]


def read_float(machine, register):
    return struct.unpack('<f', struct.pack('<I', machine.reg_read(register) & 0xffffffff))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Regenerate numeric fixtures after verification')
    args = parser.parse_args()
    rng, tier_base = image('game/bin/win64/tier0.dll')
    client, base = image('game/csgo/bin/win64/client.dll')

    def call_rng(seed=None, low=0., high=1.):
        rng.mem_write(0x108008, struct.pack('<Q', 0x100000))
        rng.reg_write(UC_X86_REG_RSP, 0x108008)
        rng.reg_write(UC_X86_REG_RCX, 0x101000)
        if seed is not None:
            rng.reg_write(UC_X86_REG_RDX, seed)
        rng.reg_write(UC_X86_REG_XMM1, float_bits(low))
        rng.reg_write(UC_X86_REG_XMM2, float_bits(high))
        rng.emu_start(tier_base + (0x15ea30 if seed is not None else 0x15eb10), 0x100000, count=100000)
        if rng.reg_read(UC_X86_REG_RIP) != 0x100000:
            raise RuntimeError('RNG instruction budget exceeded')
        return read_float(rng, UC_X86_REG_XMM0)

    def import_call(machine, address, _size, _data):
        if address == base + 0x187e3b1:
            call_rng(seed=machine.reg_read(UC_X86_REG_RDX))
        elif address == base + 0x187e39f:
            value = call_rng(low=read_float(machine, UC_X86_REG_XMM1), high=read_float(machine, UC_X86_REG_XMM2))
            machine.reg_write(UC_X86_REG_XMM0, float_bits(value))
        else:
            return
        stack = machine.reg_read(UC_X86_REG_RSP)
        destination = struct.unpack('<Q', machine.mem_read(stack, 8))[0]
        machine.reg_write(UC_X86_REG_RSP, stack + 8)
        machine.reg_write(UC_X86_REG_RIP, destination)

    client.hook_add(UC_HOOK_CODE, import_call, begin=base + 0x187e39f, end=base + 0x187e3b1)
    random_values = {}
    for seed in [1, 223, 38965, 57966]:
        call_rng(seed=seed)
        random_values[str(seed)] = [call_rng(low=-30, high=30) for _ in range(16)]
    tables = {}
    data = json.loads((ROOT / 'src/range/game-data.json').read_text())
    for weapon, values in data['weapons'].items():
        definition, output = 0x110000, 0x114000
        for offset, key in [(0x798, 'recoilAngle'), (0x7a0, 'recoilVariance'), (0x7a8, 'recoilMagnitude'), (0x7b0, 'recoilMagnitudeVariance')]:
            client.mem_write(definition + offset, struct.pack('<ff', values[key], values[key]))
        client.mem_write(definition + 0x7dc, struct.pack('<I', values['recoilSeed']))
        client.mem_write(definition + 0x734, bytes([values['fullAuto']]))
        client.reg_write(UC_X86_REG_RSP, 0x108000)
        client.reg_write(UC_X86_REG_RSI, definition)
        client.reg_write(UC_X86_REG_RBX, output)
        # Skip resource lookup; feed audited weapon parameters to the actual loop.
        client.emu_start(base + 0x7a9c1b, base + 0x7a9df3, count=100000)
        if client.reg_read(UC_X86_REG_RIP) != base + 0x7a9df3:
            raise RuntimeError('Recoil instruction budget exceeded')
        tables[weapon] = [dict(zip(('angle', 'magnitude'), struct.unpack('<ff', client.mem_read(output + 4 + i * 8, 8)))) for i in range(64)]
    for name, value in [('native-rng-fixture.json', random_values), ('native-table-fixture.json', tables)]:
        path = ROOT / 'src/range' / name
        if args.write:
            path.write_text(json.dumps(value, indent=2) + '\n')
        elif json.loads(path.read_text()) != value:
            raise SystemExit(f'{name}: numeric fixture mismatch')
        print(f'{name}: verified against hash-pinned offline machine code')


if __name__ == '__main__':
    main()
