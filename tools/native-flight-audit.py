"""Static-only supplemental grenade audit; never loads or executes game code."""
import argparse
import bisect
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local-tools/analysis-python'))
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('mode', choices=['inventory', 'riprefs', 'range', 'unwind', 'verify'])
p.add_argument('addresses', type=lambda s: int(s, 0), nargs='*')
p.add_argument('--count', type=int, default=324)
a = p.parse_args()
game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
path = game / 'game/csgo/bin/win64/server.dll'
raw = path.read_bytes()
pe = pefile.PE(data=raw)
base = pe.OPTIONAL_HEADER.ImageBase
funcs = sorted((e.struct.BeginAddress, e.struct.EndAddress, e.struct.UnwindData) for e in pe.DIRECTORY_ENTRY_EXCEPTION)
starts = [f[0] for f in funcs]
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True
print(json.dumps({'file': str(path), 'sha256': hashlib.sha256(raw).hexdigest(),
                  'imageBase': hex(base), 'steamInf': (game / 'game/csgo/steam.inf').read_text(),
                  'command': sys.argv[1:]}))

def enclosing(rva):
    i = bisect.bisect_right(starts, rva) - 1
    return funcs[i] if i >= 0 and rva < funcs[i][1] else (rva, rva + 64, 0)

def listing(begin, end):
    decoded = False
    for ins in md.disasm(pe.get_data(begin, end - begin), base + begin):
        decoded = True
        notes = []
        for op in ins.operands:
            if op.type == CS_OP_MEM and ins.reg_name(op.mem.base) == 'rip':
                rva = ins.address + ins.size + op.mem.disp - base
                data = pe.get_data(rva, 96)
                if len(data) >= 4:
                    notes.append(f'[{rva:#x}] f32={struct.unpack_from("<f", data)[0]:.9g}')
                s = data.split(b'\0')[0]
                if s and all(32 <= b < 127 for b in s):
                    notes.append(repr(s.decode()))
        print(f'{ins.address-base:x} {ins.bytes.hex()} {ins.mnemonic} {ins.op_str} ' + '; '.join(notes))
    if not decoded:
        raise ValueError(f'No instruction decoded at {begin:#x}; use a verified instruction boundary')

if a.mode == 'range':
    if len(a.addresses) % 2:
        p.error('range requires begin/end pairs (exclusive ends)')
    for begin, end in zip(a.addresses[::2], a.addresses[1::2]):
        print('RANGE', hex(begin), hex(end))
        listing(begin, end)
elif a.mode == 'unwind':
    for rva in a.addresses:
        f = enclosing(rva)
        data = pe.get_data(f[2], 256) if f[2] else b''
        print(json.dumps({'rva': hex(rva), 'fragment': [hex(v) for v in f], 'unwindBytes': data.hex()}))
elif a.mode == 'inventory':
    for table in a.addresses:
        for slot in range(a.count):
            rva = struct.unpack('<Q', pe.get_data(table + 8 * slot, 8))[0] - base
            section = pe.get_section_by_rva(rva)
            if not section or not section.Characteristics & 0x20000000:
                print(json.dumps({'table': hex(table), 'slot': slot, 'nonCode': hex(rva)}))
                break
            f = enclosing(rva)
            print('METHOD', json.dumps({'table': hex(table), 'slot': slot, 'rva': hex(rva),
                                       'fragment': [hex(v) for v in f]}))
            listing(rva, f[1])
elif a.mode == 'riprefs':
    targets = set(a.addresses)
    seen = set()
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        code = section.get_data()
        for at in range(len(code) - 3):
            target = section.VirtualAddress + at + 4 + struct.unpack_from('<i', code, at)[0]
            if target not in targets:
                continue
            for start in range(max(0, at - 10), at):
                ins = next(md.disasm(code[start:at + 12], base + section.VirtualAddress + start, count=1), None)
                if not ins or ins.address in seen:
                    continue
                if any(op.type == CS_OP_MEM and ins.reg_name(op.mem.base) == 'rip'
                       and ins.address + ins.size + op.mem.disp == base + target for op in ins.operands):
                    seen.add(ins.address)
                    print(json.dumps({'target': hex(target), 'at': hex(ins.address-base),
                                      'fragment': [hex(v) for v in enclosing(ins.address-base)],
                                      'instruction': ins.mnemonic + ' ' + ins.op_str}))
elif a.mode == 'verify':
    assert hashlib.sha256(raw).hexdigest() == '2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c'
    checks = [
        (0x9d4385, 'movss', 'xmm0, dword ptr [rdi + 0x3f8]'),
        (0x9d44a9, 'mulss', 'xmm0, xmm6'),
        (0xe94650, 'mulss', 'xmm4, dword ptr [rsp + 0x40]'),
        (0x9d4771, 'jbe', '0x1809d47a1'),
        (0x9bd763, 'jle', '0x1809bd777'),
        (0x9da0cc, 'call', '0x1802134f0'),
        (0x9da0e1, 'jb', '0x1809da11d'),
        (0x9da109, 'jb', '0x1809da11d'),
        (0x3f1f0c, 'cvttss2si', 'edi, xmm0'),
        (0x9d1b53, 'call', '0x180e95b30'),
        (0x9d1bfe, 'call', '0x180e95b30'),
        (0xe92c58, 'jmp', 'qword ptr [rax + 0x518]'),
    ]
    for rva, mnemonic, operands in checks:
        ins = next(md.disasm(pe.get_data(rva, 16), base + rva, count=1))
        assert (ins.mnemonic, ins.op_str) == (mnemonic, operands), hex(rva)
        print('PASS instruction', hex(rva), ins.bytes.hex(), mnemonic, operands)

    for table in [0x17ccec0, 0x17cd908, 0x17ce4c8, 0x18ee818]:
        assert struct.unpack('<Q', pe.get_data(table + 163 * 8, 8))[0] - base == 0x9d3e60
        assert struct.unpack('<Q', pe.get_data(table + 319 * 8, 8))[0] - base == 0x9bd730
    for table in [0x17ccec0, 0x18ee818]:
        value = struct.unpack('<Q', pe.get_data(table + 324 * 8, 8))[0] - base
        assert not pe.get_section_by_rva(value).Characteristics & 0x20000000
    print('PASS contact/timer slots for base, flash, HE, smoke; primary base/smoke boundary at 324')

    f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]
    constants = {0x17cf12c: .45, 0x1795d78: .9, 0x17b84c0: 400,
                 0x18ef870: 96000, 0x178adf0: .03125, 0x18ef818: 1.188,
                 0x1795d58: .1, 0x178adf8: .2, 0x178ae14: 64, 0x178657c: .5,
                 0x17ea444: 128, 0x17a0860: 1 / 128, 0x17b84d0: 800,
                 0x1795d70: .4}
    for rva, value in constants.items():
        actual = struct.unpack('<f', pe.get_data(rva, 4))[0]
        assert actual == f32(value), hex(rva)
        print('PASS constant', hex(rva), repr(actual))

    def requested_tick(t):
        return int(f32(f32(f32(t) * 64) + .5))

    examples = []
    for first_delay in [0, 1]:
        spawn = f32(1000)
        deadline = f32(spawn + 1.5)
        tick = requested_tick(spawn) + first_delay
        checks_at = []
        while True:
            now = f32(tick / 64)
            checks_at.append(now - spawn)
            if now > deadline:
                break
            tick = requested_tick(f32(now + f32(.2)))
        assert checks_at[-1] == (104 + first_delay) / 64
        examples.append({'assumption': 'tick-aligned time; first check delayed by this many ticks',
                         'firstCheckDelayTicks': first_delay, 'checksAfterSpawn': checks_at})
    assert not f32(76 / 64) >= f32(1.188)
    assert f32(77 / 64) >= f32(1.188)
    print(json.dumps({'arithmeticOnlyNotRuntimeMeasurement': True, 'HEFlashExamples': examples,
                      'smokeTickAlignedEarliestAge': 77 / 64,
                      'smokeSpeedGate': f32(.1), 'strictStopSpeed': math.sqrt(400)}))
    for rva in [0x1ec1c30, 0x1ec1c58, 0x1f0a490]:
        print('RTTI', hex(rva), pe.get_data(rva + 16, 120).split(b'\0')[0].decode(errors='replace'))
    print('PASS all static assertions and conditional arithmetic examples')
