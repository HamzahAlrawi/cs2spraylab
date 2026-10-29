"""Static client flash inspection; never loads DLLs or accesses game processes.

Inspection prints to stdout. Replay/fixture support is confined to known scalar
blocks; disassembly and schema matches alone do not establish renderer parity.
"""
import argparse
import bisect
import hashlib
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local-tools/analysis-python'))
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM

CLIENT_SHA = '08a741030c1e569d8b854c5886a87fcafc21d0d0e2f05dfd380e8a351171501d'
SERVER_SHA = '3788afaa2dbce98a7b2fa1e15b6b1a304759dd5b0f05802268952341b40777c4'
GAME = Path('C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive')


def replay(pe, raw, write):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
    from unicorn.x86_const import (UC_X86_REG_RSP, UC_X86_REG_RCX, UC_X86_REG_RDX,
                                  UC_X86_REG_R9, UC_X86_REG_XMM2, UC_X86_REG_RIP)
    import json
    base = pe.OPTIONAL_HEADER.ImageBase
    uc = Uc(UC_ARCH_X86, UC_MODE_64)
    uc.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
    for section in pe.sections:
        uc.mem_write(base + section.VirtualAddress, section.get_data())
    memory, stack, stop = 0x60000000, 0x70008008, 0x60001000
    uc.mem_map(memory, 0x2000)
    uc.mem_map(0x70000000, 0x10000)

    def f32(value):
        return struct.unpack('<f', struct.pack('<f', value))[0]

    def bits(value):
        return struct.unpack('<I', struct.pack('<f', value))[0]

    def run(start, now, duration, max_alpha, buildup):
        # Full native helper and all its pure callees execute unmodified. No
        # callbacks, clocks, arithmetic or time comparison functions are stubbed.
        uc.mem_write(stack, struct.pack('<Q', stop))
        uc.mem_write(stack + 0x28, struct.pack('<f', max_alpha))
        uc.mem_write(stack + 0x30, struct.pack('<QQ', memory, memory + 4))
        uc.mem_write(memory, bytes(8))
        uc.reg_write(UC_X86_REG_RSP, stack)
        uc.reg_write(UC_X86_REG_RCX, bits(start))
        uc.reg_write(UC_X86_REG_RDX, bits(now))
        uc.reg_write(UC_X86_REG_XMM2, bits(duration))
        uc.reg_write(UC_X86_REG_R9, int(buildup))
        uc.emu_start(base + 0x8d0780, stop, count=1000)
        assert uc.reg_read(UC_X86_REG_RIP) == stop, 'Native helper did not return'
        overlay, screenshot = struct.unpack('<ff', uc.mem_read(memory, 8))
        return {'overlayAlpha': overlay, 'screenshotAlpha': screenshot}

    buildup_seconds = struct.unpack('<f', pe.get_data(0x1c177cc, 4))[0]
    cases = []
    # Duration samples include the previously researched four server bands, but
    # fixture authority here is client arithmetic, not current server parity.
    durations = [f32(.001), f32(.25), f32(1.07142854), f32(2.14285707),
                 f32(3), f32(3.75), f32(5.35714293), f32(8)]
    for duration in durations:
        for start in [0, 10, 100000]:
            for elapsed in [-.01, 0, buildup_seconds / 2, buildup_seconds,
                            .1, .25, .5, duration / 2, duration, duration + .01]:
                for max_alpha in [0, 128, 255]:
                    for buildup in [False, True]:
                        now = f32(start + elapsed)
                        cases.append({'id': len(cases), 'startTime': start, 'time': now,
                                      'duration': duration, 'maxAlpha': max_alpha,
                                      'buildUp': buildup,
                                      'expected': run(start, now, duration, max_alpha, buildup)})
    fixture = {
        'source': {'build': 2000938, 'patch': '1.41.9.3', 'sourceRevision': 11181008,
                   'module': 'client.dll', 'sha256': CLIENT_SHA,
                   'helperRva': '0x8d0780', 'helperEndRvaExclusive': '0x8d08e6',
                   'callerRva': '0xc6a26d', 'buildupConstantRva': '0x1c177cc'},
        'method': 'Unmodified static x64 helper and pure callees in isolated Unicorn memory; no DLL loads, game process, clock stubs or renderer execution.',
        'constants': {'buildupSeconds': buildup_seconds, 'screenshotTailSeconds': 3, 'alphaDivisor': 255},
        'cases': cases,
    }
    output = ROOT / 'src/range/duel/native-flash-client-fixture.json'
    if write:
        output.write_text(json.dumps(fixture, indent=2) + '\n', encoding='utf-8')
    else:
        assert json.loads(output.read_text(encoding='utf-8')) == fixture, 'Fixture mismatch'
    print(f'PASS {len(cases)} native client cases ({"wrote" if write else "verified"} fixture)')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', type=Path, default=GAME)
    parser.add_argument('--module', choices=['client', 'server'], default='client')
    parser.add_argument('--strings')
    parser.add_argument('--rvas', nargs='*', type=lambda x: int(x, 0), default=[])
    parser.add_argument('--members', nargs='*', type=lambda x: int(x, 0), default=[])
    parser.add_argument('--refs', nargs='*', type=lambda x: int(x, 0), default=[])
    parser.add_argument('--calls', nargs='*', type=lambda x: int(x, 0), default=[])
    parser.add_argument('--data', nargs='*', type=lambda x: int(x, 0), default=[])
    parser.add_argument('--pointers', nargs='*', type=lambda x: int(x, 0), default=[])
    parser.add_argument('--size', type=lambda x: int(x, 0))
    parser.add_argument('--replay', action='store_true', help='Verify pinned client scalar fixture')
    parser.add_argument('--write', action='store_true', help='Regenerate pinned client scalar fixture')
    args = parser.parse_args()
    path = args.game / f'game/csgo/bin/win64/{args.module}.dll'
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != (CLIENT_SHA if args.module == 'client' else SERVER_SHA):
        raise SystemExit('Module does not match pinned build 2000938; refusing inspection')
    pe = pefile.PE(data=raw, fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']])
    base = pe.OPTIONAL_HEADER.ImageBase
    functions = sorted((x.struct.BeginAddress, x.struct.EndAddress) for x in pe.DIRECTORY_ENTRY_EXCEPTION)
    starts = [x[0] for x in functions]
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True
    print(f'{path} SHA256={sha} base={base:#x}')
    if args.replay or args.write:
        if args.module != 'client':
            parser.error('Replay supports client only')
        replay(pe, raw, args.write)
        return

    def enclosing(rva):
        i = bisect.bisect_right(starts, rva) - 1
        return functions[i] if i >= 0 and rva < functions[i][1] else (rva, rva + 64)

    for rva in args.rvas:
        begin, end = (rva, rva + args.size) if args.size else enclosing(rva)
        print(f'FUNCTION {begin:#x}:{end:#x}')
        for ins in md.disasm(pe.get_data(begin, end - begin), base + begin):
            notes = []
            for op in ins.operands:
                if op.type == CS_OP_MEM and ins.reg_name(op.mem.base) == 'rip':
                    target = ins.address + ins.size + op.mem.disp - base
                    data = pe.get_data(target, 100)
                    if len(data) >= 4:
                        notes.append(f'[{target:#x}] f32={struct.unpack_from("<f", data)[0]:.10g}')
                    string = data.split(b'\0')[0]
                    if string and all(32 <= x < 127 for x in string):
                        notes.append(repr(string.decode()))
            print(f'{ins.address-base:x} {ins.mnemonic} {ins.op_str} ' + '; '.join(notes))
    if args.strings:
        for match in re.finditer(rb'[ -~]{5,}', raw):
            value = match.group().decode()
            if re.search(args.strings, value, re.I):
                print(f'STRING {pe.get_rva_from_offset(match.start()):#x} {value}')
    for target in args.data:
        data = pe.get_data(target, 64)
        print(f'DATA {target:#x} hex={data.hex()} f32={struct.unpack("<16f", data)} u32={struct.unpack("<16I", data)}')
    for target in args.pointers:
        for match in re.finditer(re.escape(struct.pack('<Q', base + target)), raw):
            print(f'POINTER {pe.get_rva_from_offset(match.start()):#x} -> {target:#x}')
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        code = section.get_data()
        candidates = set()
        for member in args.members:
            for match in re.finditer(re.escape(struct.pack('<I', member)), code):
                candidates.add(enclosing(section.VirtualAddress + match.start()))
        if args.refs:
            targets = set(args.refs)
            for alignment in range(4):
                size = (len(code) - alignment) // 4 * 4
                for i, (disp,) in enumerate(struct.iter_unpack('<i', code[alignment:alignment+size])):
                    offset = alignment + i * 4
                    if section.VirtualAddress + offset + 4 + disp in targets:
                        candidates.add(enclosing(section.VirtualAddress + offset))
        for begin, end in sorted(candidates):
            for ins in md.disasm(pe.get_data(begin, end - begin), base + begin):
                for op in ins.operands:
                    if op.type != CS_OP_MEM:
                        continue
                    target = ins.address + ins.size + op.mem.disp - base if ins.reg_name(op.mem.base) == 'rip' else None
                    if target in args.refs or op.mem.disp in args.members:
                        print(f'REF {ins.address-base:#x} function={begin:#x}:{end:#x} {ins.mnemonic} {ins.op_str} target={target}')
        for match in re.finditer(rb'\xe8', code) if args.calls else []:
            i = match.start()
            if i + 5 > len(code):
                continue
            rva = section.VirtualAddress + i
            target = rva + 5 + struct.unpack_from('<i', code, i + 1)[0]
            if target in args.calls:
                print(f'CALL {rva:#x} -> {target:#x} function={enclosing(rva)}')


if __name__ == '__main__':
    main()
