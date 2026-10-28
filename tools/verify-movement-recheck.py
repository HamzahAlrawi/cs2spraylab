"""Offline movement recheck: static PE inspection, never a loaded game DLL.

Requires pefile/capstone; numeric verification additionally requires Unicorn.
Unverified builds may be disassembled but must not be emulated at old offsets.
"""
import argparse
import bisect
import hashlib
import json
import os
import re
import struct
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
SERVER_SHA = '9f31fc84164f7822e015dcd95ea958f9dd33d02308a646a2bee5c9b39bd6fc28'
FIXTURE = ROOT / 'src/range/native-movement-recheck-fixture.json'


def verify(raw):
    """Emulate audited arithmetic; external state and scalar helpers are supplied."""
    if hashlib.sha256(raw).hexdigest() != SERVER_SHA:
        raise SystemExit('Server changed: re-inspect before numeric execution.')
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
    from unicorn.x86_const import (UC_X86_REG_RAX, UC_X86_REG_RBX, UC_X86_REG_RCX,
                                  UC_X86_REG_RDX, UC_X86_REG_RDI, UC_X86_REG_RSI,
                                  UC_X86_REG_R8, UC_X86_REG_R9, UC_X86_REG_R14,
                                  UC_X86_REG_RSP, UC_X86_REG_RIP,
                                  UC_X86_REG_XMM0, UC_X86_REG_XMM2, UC_X86_REG_XMM6,
                                  UC_X86_REG_XMM7, UC_X86_REG_XMM9, UC_X86_REG_XMM11)
    pe = pefile.PE(data=raw, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    default_rvas = {'sv_accelerate': 0x17b7c80, 'sv_friction': 0x19c2378,
                    'sv_stopspeed': 0x178bffc, 'sv_airaccelerate': 0x17b7c88,
                    'sv_air_max_wishspeed': 0x178bfe0, 'sv_gravity': 0x17aaa40,
                    'sv_jump_impulse': 0x191e744}
    defaults = {name: struct.unpack('<f', pe.get_data(rva, 4))[0] for name, rva in default_rvas.items()}
    snapshot = (ROOT / 'research/convars.txt').read_text()
    for name, value in defaults.items():
        match = re.search(rf'^{name} (\S+) ', snapshot, re.MULTILINE)
        if not match or abs(float(match[1]) - value) > .001:
            raise SystemExit(f'Convar snapshot differs from static registered default: {name}')
    uc = Uc(UC_ARCH_X86, UC_MODE_64)
    uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
    uc.mem_write(base, pe.get_memory_mapped_image())
    heap, stack = 0x10000000, 0x20000000
    uc.mem_map(heap, 0x20000)
    uc.mem_map(stack, 0x10000)
    movement, pawn, weapon, vtable, movedata, wish, cvars = [heap + i * 0x2000 for i in range(7)]
    sentinel, speed_stub, zoom_stub = heap + 0x1e000, heap + 0x1e100, heap + 0x1e200
    sp = stack + 0x8008
    pointer = lambda address, value: uc.mem_write(address, struct.pack('<Q', value))
    scalar = lambda address, value: uc.mem_write(address, struct.pack('<f', value))
    read = lambda address: struct.unpack('<f', uc.mem_read(address, 4))[0]

    def xmm(register, value):
        uc.reg_write(register, struct.unpack('<I', struct.pack('<f', value))[0])

    def ret():
        current = uc.reg_read(UC_X86_REG_RSP)
        uc.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', uc.mem_read(current, 8))[0])
        uc.reg_write(UC_X86_REG_RSP, current + 8)

    allowed = []
    stops = set()
    held_speed = 215

    def hook(machine, address, _size, _data):
        if address in stops:
            machine.emu_stop()
            return
        if address == base + 0xc7f370:
            machine.reg_write(UC_X86_REG_RAX, weapon)
        elif address == speed_stub:
            xmm(UC_X86_REG_XMM0, held_speed)
        elif address in [zoom_stub, base + 0x3d3b60]:
            machine.reg_write(UC_X86_REG_RAX, 0)
        elif address == base + 0xa3b350:
            a, b = machine.reg_read(UC_X86_REG_RCX), machine.reg_read(UC_X86_REG_RDX)
            xmm(UC_X86_REG_XMM0, sum(read(a + i) * read(b + i) for i in [0, 4, 8]))
        elif address in [base + 0x178af0, base + 0x178b00]:
            a, b = read(machine.reg_read(UC_X86_REG_RCX)), read(machine.reg_read(UC_X86_REG_RDX))
            xmm(UC_X86_REG_XMM0, (max if address == base + 0x178af0 else min)(a, b))
        elif address == base + 0x3d1f90:
            xmm(UC_X86_REG_XMM0, 1)  # extra pawn friction multiplier, not verified
        elif any(begin <= address < end for begin, end in allowed):
            return
        else:
            raise RuntimeError(f'Unexpected native path at RVA {address - base:#x}')
        ret()

    uc.hook_add(UC_HOOK_CODE, hook)

    def run(begin, end, ranges=None, exit_points=()):
        nonlocal allowed, stops
        allowed = [(base + a, base + b) for a, b in (ranges or [(begin, end)])]
        stops = {base + point for point in exit_points}
        uc.emu_start(base + begin, base + end if end else sentinel, count=4000)
        expected = stops | {base + end if end else sentinel}
        if uc.reg_read(UC_X86_REG_RIP) not in expected:
            raise RuntimeError('Native instruction limit reached')

    pointer(movement + 0x38, pawn)
    pointer(pawn + 0xb10, weapon)
    pointer(pawn + 0xe38, heap + 0x1a000)
    uc.mem_write(heap + 0x1a048, struct.pack('<i', -1))
    pointer(weapon, vtable)
    pointer(vtable + 0xc20, speed_stub)
    pointer(vtable + 0xcb0, zoom_stub)
    pointer(base + 0x216b0e0, cvars)
    uc.mem_write(cvars + 0x58, b'\x01')
    pointer(base + 0x216b0f0, cvars + 0x100)
    scalar(wish, 1)
    acceleration = []
    for held_speed in [150, 215, 225, 240, 250]:
        for stance in ['run', 'walk', 'crouch']:
            cap = held_speed * {'run': 1, 'walk': .52, 'crouch': .34}[stance]
            for tag in [1, .35]:
                for friction in [1, .5, 0]:
                    for current in [0, -80, cap * .9, cap]:
                        for dt in [1 / 128, 1 / 64]:
                            uc.mem_write(movedata, bytes(0x200))
                            scalar(movedata + 0x38, current)
                            scalar(movement + 0x26c, friction)
                            pointer(movement + 0x58, {'run': 0, 'walk': 1 << 16, 'crouch': 4}[stance])
                            pointer(sp, sentinel)
                            scalar(sp + 0x28, cap * tag)
                            scalar(sp + 0x30, 5.5)
                            uc.reg_write(UC_X86_REG_RSP, sp)
                            uc.reg_write(UC_X86_REG_RCX, movement)
                            uc.reg_write(UC_X86_REG_RDX, movedata)
                            uc.reg_write(UC_X86_REG_R9, wish)
                            xmm(UC_X86_REG_XMM2, dt)
                            run(0xaaf850, 0, [(0xaaf850, 0xaafdb5)])
                            acceleration.append(dict(weaponSpeed=held_speed, stance=stance, tag=tag,
                                                     current=current, dt=dt, surfaceFriction=friction,
                                                     wishSpeed=cap * tag, result=read(movedata + 0x38)))

    friction_cases = []
    pointer(base + 0x21c9150, cvars + 0x200)
    scalar(cvars + 0x258, 5.2)
    pointer(base + 0x21c9050, cvars + 0x300)
    scalar(cvars + 0x358, 80)
    pointer(base + 0x1e28930, cvars + 0x400)
    for current in [.05, .1, 1, 55, 80, 215, 300]:
        for friction in [1, .5, 0]:
            for dt in [1 / 128, 1 / 64]:
                uc.mem_write(movedata, bytes(0x200))
                scalar(movedata + 0x38, current)
                scalar(cvars + 0x434, dt)
                scalar(movement + 0x26c, friction)
                uc.reg_write(UC_X86_REG_RSP, sp)
                uc.reg_write(UC_X86_REG_RBX, movement)
                uc.reg_write(UC_X86_REG_RDI, movedata)
                uc.reg_write(UC_X86_REG_RCX, pawn)
                xmm(UC_X86_REG_XMM7, current)
                xmm(UC_X86_REG_XMM11, current)
                xmm(UC_X86_REG_XMM6, 0)
                run(0xabdebc, 0xabe123, [(0xabdebc, 0xabdecd)], [0xabdecd])
                if uc.reg_read(UC_X86_REG_RIP) == base + 0xabdecd:
                    run(0xabdefc, 0xabdf64)
                    run(0xabe0b7, 0xabe123)
                friction_cases.append(dict(current=current, surfaceFriction=friction, dt=dt,
                                           result=read(movedata + 0x38)))

    crouch, walk = [], []
    for amount in [0, .25, .5, .75, 1]:
        scalar(movedata + 0x120, 215)
        scalar(movedata + 0x2c, 215)
        uc.reg_write(UC_X86_REG_R14, movedata)
        xmm(UC_X86_REG_XMM6, amount)
        xmm(UC_X86_REG_XMM9, 1)
        run(0xabb4e8, 0xabb53b)
        crouch.append(dict(duckAmount=amount, weaponSpeed=215, result=read(movedata + 0x120),
                           forward=read(movedata + 0x2c)))
    for held_speed in [150, 215, 250]:
        for current in [0, held_speed * .52 + 24, held_speed * .52 + 25, held_speed * .52 + 26, 300]:
            scalar(movedata + 0x120, held_speed)
            uc.reg_write(UC_X86_REG_RSI, movedata)
            xmm(UC_X86_REG_XMM0, current)
            run(0xab5b65, 0xab5b8d, [(0xab5b65, 0xab5b8d)], [0xab5c04])
            walk.append(dict(weaponSpeed=held_speed, currentSpeed=current, result=read(movedata + 0x120)))
    return dict(build='2000930', serverSha256=SERVER_SHA,
                convarSnapshotSha256=hashlib.sha256((ROOT / 'research/convars.txt').read_bytes()).hexdigest(),
                scope='Isolated arithmetic; pawn/weapon/scalar helper stubs. No native traces, input scheduling, or complete air/jump integration.',
                registeredDefaultRvas={name: hex(rva) for name, rva in default_rvas.items()}, registeredDefaults=defaults,
                blocks=dict(acceleration='0xaaf850..0xaafdb5', friction='0xabdebc,0xabdefc..0xabdf64,0xabe0b7..0xabe123',
                            crouch='0xabb4e8..0xabb53b', walk='0xab5b65..0xab5b8d'),
                acceleration=acceleration, friction=friction_cases, crouch=crouch, walk=walk)


def inspect(raw, rva=None, size=None):
    pe = pefile.PE(data=raw, fast_load=True)
    pe.parse_data_directories(directories=[3])
    base = pe.OPTIONAL_HEADER.ImageBase
    functions = sorted((e.struct.BeginAddress, e.struct.EndAddress) for e in pe.DIRECTORY_ENTRY_EXCEPTION)
    starts = [s for s, _ in functions]
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True

    def listing(begin, end):
        for ins in md.disasm(pe.get_data(begin, end - begin), base + begin):
            notes = []
            for operand in ins.operands:
                if operand.type == CS_OP_MEM and ins.reg_name(operand.mem.base) == 'rip':
                    address = ins.address + ins.size + operand.mem.disp - base
                    data = pe.get_data(address, 4)
                    if len(data) == 4:
                        notes.append(f'[{address:#x}] f32={struct.unpack("<f", data)[0]:.10g}')
            print(f'{ins.address - base:x} {ins.mnemonic} {ins.op_str} {"; ".join(notes)}')

    if rva is not None:
        index = bisect.bisect_right(starts, rva) - 1
        if index < 0 or rva >= functions[index][1]:
            raise SystemExit('RVA has no enclosing PE unwind function')
        begin, end = functions[index]
        listing(*(rva, rva + size) if size else (begin, end))
        return
    constants = {}
    for value in [.34, .52, 30, 80, 250, .0005, .6, 1.111189365386963]:
        for match in re.finditer(re.escape(struct.pack('<f', value)), raw):
            try:
                constants[base + pe.get_rva_from_offset(match.start())] = value
            except pefile.PEFormatError:
                pass
    matches = {}
    pattern = rb'\xf3[\x40-\x4f]?\x0f[\x10\x58\x59\x5c\x5e\x5d\x5f][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]'
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        code, start = section.get_data(), base + section.VirtualAddress
        for match in re.finditer(pattern, code):
            offset, length = match.start(), len(match.group())
            address = start + offset + length + 4 + struct.unpack_from('<i', code, offset + length)[0]
            if address not in constants:
                continue
            current = start + offset - base
            function = functions[bisect.bisect_right(starts, current) - 1]
            if function[0] <= current < function[1] and 0xaa0000 <= current < 0xaf0000:
                matches.setdefault(function, []).append((hex(current), constants[address]))
    for function, refs in sorted(matches.items()):
        print('FUNCTION', hex(function[0]), hex(function[1]), refs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--rva', type=lambda value: int(value, 0))
    parser.add_argument('--size', type=lambda value: int(value, 0))
    parser.add_argument('--write', action='store_true', help='Regenerate only the arithmetic regression fixture')
    args = parser.parse_args()
    raw = (GAME / 'game/csgo/bin/win64/server.dll').read_bytes()
    print((GAME / 'game/csgo/steam.inf').read_text().strip())
    print('serverSha256', hashlib.sha256(raw).hexdigest())
    print('convarSnapshotSha256', hashlib.sha256((ROOT / 'research/convars.txt').read_bytes()).hexdigest())
    if args.inspect or args.rva is not None:
        if args.write:
            raise SystemExit('--write cannot be combined with inspection')
        inspect(raw, args.rva, args.size)
    else:
        output = verify(raw)
        if args.write:
            FIXTURE.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
        elif json.loads(FIXTURE.read_text()) != output:
            raise SystemExit('Numeric fixture changed; inspect before regenerating.')
        print('Verified', {key: len(output[key]) for key in ['acceleration', 'friction', 'crouch', 'walk']})


if __name__ == '__main__':
    main()
