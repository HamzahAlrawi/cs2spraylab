"""Read-only PE inspection for weapon audits; never loads or executes a DLL."""
import argparse
import bisect
import re
import struct
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('dll')
parser.add_argument('mode', choices=['list', 'refs', 'member', 'pointers'])
parser.add_argument('values', nargs='+', type=lambda x: int(x, 0))
args = parser.parse_args()
pe = pefile.PE(args.dll, fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']])
base = pe.OPTIONAL_HEADER.ImageBase
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True
functions = sorted((base + e.struct.BeginAddress, base + e.struct.EndAddress) for e in pe.DIRECTORY_ENTRY_EXCEPTION)
starts = [s for s, _ in functions]


def listing(start, size):
    for ins in md.disasm(pe.get_data(start - base, size), start):
        notes = []
        for op in ins.operands:
            if op.type == CS_OP_MEM and ins.reg_name(op.mem.base) == 'rip':
                address = ins.address + ins.size + op.mem.disp
                raw = pe.get_data(address - base, 100)
                if ins.mnemonic.endswith('ss') and len(raw) >= 4:
                    notes.append(str(struct.unpack('<f', raw[:4])[0]))
                string = raw.split(b'\0')[0]
                if len(string) > 3 and all(32 <= c < 127 for c in string):
                    notes.append(repr(string.decode()))
        print(hex(ins.address - base), ins.mnemonic, ins.op_str, ' '.join(notes))


if args.mode == 'list':
    listing(base + args.values[0], args.values[1])
elif args.mode == 'pointers':
    for i in range(args.values[1]):
        value = struct.unpack('<Q', pe.get_data(args.values[0] + i * 8, 8))[0]
        print(hex(i * 8), hex(value - base))
else:
    found = set()
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        code = section.get_data()
        start = base + section.VirtualAddress
        for value in args.values:
            pattern = re.escape(struct.pack('<I', value)) if args.mode == 'member' else rb'[\x48\x4c][\x8d\x8b][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]'
            for match in re.finditer(pattern, code):
                address = start + match.start()
                if args.mode == 'refs' and address + 7 + struct.unpack_from('<i', code, match.start() + 3)[0] != base + value:
                    continue
                index = bisect.bisect_right(starts, address) - 1
                if index >= 0 and functions[index][1] > address:
                    found.add(functions[index])
    for start, end in sorted(found):
        instructions = list(md.disasm(pe.get_data(start - base, end - start), start))
        matches = [i for i, ins in enumerate(instructions) if args.mode == 'refs' or any(op.type == CS_OP_MEM and op.mem.disp in args.values for op in ins.operands)]
        if not matches:
            continue
        print('FUNCTION', hex(start - base), 'size', end - start)
        if args.mode == 'refs':
            listing(start, min(end - start, 400))
        else:
            indices = set()
            for i in matches:
                indices.update(range(max(0, i - 8), min(len(instructions), i + 12)))
            for i in sorted(indices):
                listing(instructions[i].address, instructions[i].size)
