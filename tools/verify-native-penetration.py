"""Hash-pinned, offline numeric penetration block. No DLL or OS imports execute.

Geometry, surface lookup, teammates, and shot timing are deliberately skipped.
Inputs feed the arithmetic block of the installed client, not a live process.
"""
import argparse
import json
import struct
from pathlib import Path

import runpy
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_RSP, UC_X86_REG_RBP, UC_X86_REG_RDI, UC_X86_REG_RIP, UC_X86_REG_XMM6, UC_X86_REG_XMM8, UC_X86_REG_XMM9, UC_X86_REG_XMM13, UC_X86_REG_XMM14

ROOT = Path(__file__).resolve().parents[1]
native = runpy.run_path(str(ROOT / 'tools/verify-native-recoil.py'), run_name='numeric_helpers')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    machine, base = native['image']('game/csgo/bin/win64/client.dll')
    bits, read_float = native['float_bits'], native['read_float']
    samples = []
    for damage, thickness, power, modifier, loss in [(36, 4, 2, .5, .16), (100, 2, 2, 3, .05),
            (36, 13.385827, 2, .9, .16), (115, 40, 3, .4, .16), (30, 6, 1, .99, .16),
            (100, 20, 2, 3, .16), (50, 8, 1, 2, .16)]:
        machine.reg_write(UC_X86_REG_RSP, 0x108000)
        machine.reg_write(UC_X86_REG_RBP, 0x109000)
        machine.reg_write(UC_X86_REG_RDI, 0x110000)
        machine.mem_write(0x110000, struct.pack('<ff', damage, power))
        machine.reg_write(UC_X86_REG_XMM6, bits(modifier))
        machine.reg_write(UC_X86_REG_XMM8, bits(thickness))
        machine.reg_write(UC_X86_REG_XMM9, bits(3))
        machine.reg_write(UC_X86_REG_XMM14, bits(loss))
        # Contains only scalar float instructions and two local max helpers.
        machine.emu_start(base + 0x8a2129, base + 0x8a21d2, count=10000)
        if machine.reg_read(UC_X86_REG_RIP) != base + 0x8a21d2:
            raise RuntimeError('Penetration instruction budget exceeded')
        samples.append(dict(damage=damage, thicknessUnits=thickness, power=power, modifier=modifier,
            damageLoss=loss, lostDamage=read_float(machine, UC_X86_REG_XMM8)))
    stop_samples = []
    machine.hook_add(UC_HOOK_CODE, lambda uc, _address, _size, _data: uc.emu_stop(),
        begin=base + 0x8a1fa8, end=base + 0x8a1fa8)
    for damage, loss in [(5, 3.999), (5, 4), (5, 4.001), (5, 5), (5, 6)]:
        machine.reg_write(UC_X86_REG_RSP, 0x108000)
        machine.reg_write(UC_X86_REG_RBP, 0x109000)
        machine.reg_write(UC_X86_REG_RDI, 0x110000)
        machine.mem_write(0x110000, struct.pack('<f', damage))
        machine.mem_write(0x110010, struct.pack('<I', 4))
        machine.mem_write(0x109198, struct.pack('<f', loss))
        machine.reg_write(UC_X86_REG_XMM13, bits(1))
        machine.emu_start(base + 0x8a2276, base + 0x8a22b5, count=10000)
        rip = machine.reg_read(UC_X86_REG_RIP)
        if rip not in [base + 0x8a1fa8, base + 0x8a22b5]:
            raise RuntimeError('Penetration stop instruction budget exceeded')
        stop_samples.append(dict(damage=damage, lostDamage=loss,
            residualDamage=struct.unpack('<f', machine.mem_read(0x110000, 4))[0],
            continued=rip == base + 0x8a22b5,
            remainingPenetrations=struct.unpack('<I', machine.mem_read(0x110010, 4))[0]))
    fixture = dict(build='2000924', clientSha256=native['HASHES']['game/csgo/bin/win64/client.dll'],
        rvas=dict(start='0x8a2129', end='0x8a21d2', stopStart='0x8a2276', stopEnd='0x8a22b5'),
        scope='Isolated scalar loss and residual-damage stop arithmetic only', samples=samples, stopSamples=stop_samples)
    path = ROOT / 'src/range/duel/native-penetration-fixture.json'
    if args.write:
        path.write_text(json.dumps(fixture, indent=2) + '\n', newline='\n')
    elif json.loads(path.read_text()) != fixture:
        raise SystemExit('native-penetration-fixture.json: numeric fixture mismatch')
    print('native-penetration-fixture.json: verified against hash-pinned offline machine code')


if __name__ == '__main__':
    main()
