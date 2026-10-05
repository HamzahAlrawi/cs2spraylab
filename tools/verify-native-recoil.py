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
    UC_X86_REG_RBX, UC_X86_REG_RDI, UC_X86_REG_RIP, UC_X86_REG_XMM0, UC_X86_REG_XMM1,
    UC_X86_REG_XMM2,
)

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
HASHES = {
    'game/csgo/bin/win64/client.dll': 'd7db25d48f1d10c5e0b0296e20ed803426eb9509da41760daeda39dd35ba89b9',
    'game/bin/win64/tier0.dll': '4e0dcb0af3f6953f37ddaed0f4e67a56d031f1e84964a262148f8a6f80547791',
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
            rng.reg_write(UC_X86_REG_RDX, seed & 0xffffffff)
        rng.reg_write(UC_X86_REG_XMM1, float_bits(low))
        rng.reg_write(UC_X86_REG_XMM2, float_bits(high))
        rng.emu_start(tier_base + (0x15e660 if seed is not None else 0x15e740), 0x100000, count=100000)
        if rng.reg_read(UC_X86_REG_RIP) != 0x100000:
            raise RuntimeError('RNG instruction budget exceeded')
        return read_float(rng, UC_X86_REG_XMM0)

    def import_call(machine, address, _size, _data):
        if address == base + 0x19a8d07:
            call_rng(seed=machine.reg_read(UC_X86_REG_RDX))
        elif address == base + 0x19a8cf5:
            value = call_rng(low=read_float(machine, UC_X86_REG_XMM1), high=read_float(machine, UC_X86_REG_XMM2))
            machine.reg_write(UC_X86_REG_XMM0, float_bits(value))
        else:
            return
        stack = machine.reg_read(UC_X86_REG_RSP)
        destination = struct.unpack('<Q', machine.mem_read(stack, 8))[0]
        machine.reg_write(UC_X86_REG_RSP, stack + 8)
        machine.reg_write(UC_X86_REG_RIP, destination)

    client.hook_add(UC_HOOK_CODE, import_call, begin=base + 0x19a8cf5, end=base + 0x19a8d07)
    random_values = {}
    for seed in [0, 1, -1, 223, -223, 38965, 57966, 2147483646, -2147483646, 2147483647, -2147483647]:
        call_rng(seed=seed)
        random_values[str(seed)] = [call_rng(low=-30, high=30) for _ in range(16)]
    tables = {}
    alternate_tables = {}
    spread_tables = {}
    data = json.loads((ROOT / 'src/range/game-data.json').read_text())
    inputs = [(weapon, values, tables) for weapon, values in data['weapons'].items()]
    inputs += [(weapon, dict(values, **values['alternate']), alternate_tables) for weapon, values in data['weapons'].items()]
    for weapon, values, destination in inputs:
        definition, output = 0x110000, 0x114000
        for offset, key in [(0x790, 'recoilAngle'), (0x798, 'recoilVariance'), (0x7a0, 'recoilMagnitude'), (0x7a8, 'recoilMagnitudeVariance')]:
            client.mem_write(definition + offset, struct.pack('<ff', values[key], values[key]))
        client.mem_write(definition + 0x7d4, struct.pack('<I', values['recoilSeed']))
        client.mem_write(definition + 0x72d, bytes([values['fullAuto']]))
        client.reg_write(UC_X86_REG_RSP, 0x108000)
        client.reg_write(UC_X86_REG_RSI, definition)
        client.reg_write(UC_X86_REG_RBX, output)
        # Skip resource lookup; feed audited weapon parameters to the actual loop.
        client.emu_start(base + 0x7cb72b, base + 0x7cb903, count=100000)
        if client.reg_read(UC_X86_REG_RIP) != base + 0x7cb903:
            raise RuntimeError('Recoil instruction budget exceeded')
        destination[weapon] = [dict(zip(('angle', 'magnitude'), struct.unpack('<ff', client.mem_read(output + 4 + i * 8, 8)))) for i in range(64)]
    for weapon, values in data['weapons'].items():
        if values.get('pellets', 1) <= 1:
            continue
        output = 0x114000
        client.reg_write(UC_X86_REG_RSP, 0x108000)
        client.reg_write(UC_X86_REG_RBX, output)
        client.reg_write(UC_X86_REG_RDI, values['pellets'])
        client.reg_write(UC_X86_REG_RDX, values['spreadSeed'])
        client.emu_start(base + 0x7cba49, base + 0x7cbb4a, count=100000)
        if client.reg_read(UC_X86_REG_RIP) != base + 0x7cbb4a:
            raise RuntimeError('Shotgun table instruction budget exceeded')
        spread_tables[weapon] = [dict(zip(('angle', 'radius'), struct.unpack('<ff', client.mem_read(output + 0x404 + i * 8, 8)))) for i in range(64)]
    for name, value in [('native-rng-fixture.json', random_values), ('native-table-fixture.json', tables), ('native-alternate-table-fixture.json', alternate_tables), ('native-shotgun-table-fixture.json', spread_tables)]:
        path = ROOT / 'src/range' / name
        if args.write:
            path.write_text(json.dumps(value, indent=2) + '\n', newline='\n')
        elif json.loads(path.read_text()) != value:
            raise SystemExit(f'{name}: numeric fixture mismatch')
        print(f'{name}: verified against hash-pinned offline machine code')


if __name__ == '__main__':
    main()
