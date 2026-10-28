"""Read-only inspection of installed CS2 files. Never loads a DLL or attaches to a process."""
import argparse
import bisect
import hashlib
import json
import os
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local-tools/analysis-python'))
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--module', choices=['client', 'server'], default='client')
parser.add_argument('--strings')
parser.add_argument('--classes', action='store_true')
parser.add_argument('--class-filter',default='Grenade|Inferno|Flashbang|Molotov|Decoy')
parser.add_argument('--refs-rva',type=lambda value:int(value,0),nargs='+')
parser.add_argument('--members',type=lambda value:int(value,0),nargs='+')
parser.add_argument('--rva', type=lambda value: int(value, 0))
parser.add_argument('--size', type=lambda value: int(value, 0))
parser.add_argument('--rvas',type=lambda value:int(value,0),nargs='+')
parser.add_argument('--constants', type=float, nargs='+')
parser.add_argument('--immediates', type=lambda value:int(value,0), nargs='+')
parser.add_argument('--table', type=lambda value:int(value,0))
parser.add_argument('--count',type=int,default=460)
parser.add_argument('--callers',type=lambda value:int(value,0),nargs='+')
args = parser.parse_args()
game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
path = game / f'game/csgo/bin/win64/{args.module}.dll'
raw = path.read_bytes()
pe = pefile.PE(data=raw)
base = pe.OPTIONAL_HEADER.ImageBase
functions = sorted((entry.struct.BeginAddress, entry.struct.EndAddress) for entry in pe.DIRECTORY_ENTRY_EXCEPTION)
starts = [begin for begin, _ in functions]
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True
print(json.dumps({'file': path.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'imageBase': hex(base)}))

def enclosing(rva):
    index = bisect.bisect_right(starts, rva) - 1
    return functions[index] if index >= 0 and rva < functions[index][1] else (rva, rva + 64)

def listing(begin, end):
    for ins in md.disasm(pe.get_data(begin, end - begin), base + begin):
        notes = []
        for operand in ins.operands:
            if operand.type == CS_OP_MEM and ins.reg_name(operand.mem.base) == 'rip':
                rva = ins.address + ins.size + operand.mem.disp - base
                data = pe.get_data(rva, 96)
                if len(data) >= 4:
                    notes.append(f'[{rva:#x}] f32={struct.unpack_from("<f", data)[0]:.9g}')
                text = data.split(b'\0')[0]
                if text and all(32 <= b < 127 for b in text):
                    notes.append(repr(text.decode()))
        print(f'{ins.address-base:x} {ins.mnemonic} {ins.op_str} {"; ".join(notes)}')

if args.rva is not None:
    listing(*(enclosing(args.rva) if args.size is None else (args.rva, args.rva + args.size)))
if args.rvas:
    for rva in args.rvas:
        begin,end=enclosing(rva)
        print('FUNCTION',hex(begin),hex(end))
        listing(begin,end)
if args.table is not None:
    for index in range(args.count):
        rva=struct.unpack('<Q',pe.get_data(args.table+index*8,8))[0]-base
        print(index,hex(rva))
if args.callers:
    targets=set(args.callers)
    for section in pe.sections:
        if not section.Characteristics&0x20000000:continue
        code=section.get_data()
        for match in re.finditer(rb'\xe8',code):
            at=match.start()
            if at+5>len(code):continue
            rva=section.VirtualAddress+at
            target=rva+5+struct.unpack_from('<i',code,at+1)[0]
            if target in targets:print(json.dumps({'call':hex(rva),'target':hex(target),'function':[hex(x)for x in enclosing(rva)]}))
if args.immediates:
    for value in args.immediates:
        for section in pe.sections:
            if not section.Characteristics & 0x20000000:continue
            for match in re.finditer(re.escape(struct.pack('<I',value)),section.get_data()):
                rva=section.VirtualAddress+match.start()
                print(json.dumps({'immediate':hex(value),'at':hex(rva),'function':[hex(x)for x in enclosing(rva)]}))
if args.strings:
    pattern = re.compile(args.strings, re.I)
    for match in re.finditer(rb'[ -~]{5,}', raw):
        text = match.group().decode()
        if pattern.search(text):
            print(hex(pe.get_rva_from_offset(match.start())), text)
if args.classes:
    for match in re.finditer(rb'\.\?AV[^\x00]{1,120}@@\x00', raw):
        name = match.group()[:-1].decode(errors='replace')
        if not re.search(args.class_filter, name, re.I):
            continue
        descriptor = pe.get_rva_from_offset(match.start()) - 16
        tables = []
        for reference in re.finditer(re.escape(struct.pack('<I', descriptor)), raw):
            offset = reference.start() - 12
            if offset < 0 or offset + 24 > len(raw):
                continue
            sig, adjustment, ctor, _, hierarchy, self_rva = struct.unpack_from('<6I', raw, offset)
            if sig != 1 or pe.get_rva_from_offset(offset) != self_rva:
                continue
            for ptr in re.finditer(re.escape(struct.pack('<Q', base + self_rva)), raw):
                table = pe.get_rva_from_offset(ptr.start() + 8)
                entries = []
                for i in range(400):
                    value = struct.unpack('<Q', pe.get_data(table + i * 8, 8))[0] - base
                    section = pe.get_section_by_rva(value)
                    if not section or not section.Characteristics & 0x20000000:
                        break
                    entries.append(hex(value))
                tables.append({'rva': hex(table), 'adjustment': adjustment, 'functions': entries})
        print(json.dumps({'class': name, 'tables': tables}))
if args.refs_rva:
    for target in args.refs_rva:
        for ref in re.finditer(re.escape(struct.pack('<Q',base+target)),raw):
            at=ref.start();print(json.dumps({'target':hex(target),'pointer':hex(pe.get_rva_from_offset(at)),
                'words':[hex(x)for x in struct.unpack('<16I',raw[max(0,at-16):at+48])]}))
if args.members:
    seen=set()
    for section in pe.sections:
        if not section.Characteristics&0x20000000:continue
        code=section.get_data()
        for member in args.members:
            for match in re.finditer(re.escape(struct.pack('<I',member)),code):
                at=match.start()
                for start in range(max(0,at-8),at):
                    ins=next(md.disasm(code[start:at+5],base+section.VirtualAddress+start,count=1),None)
                    if not ins or ins.address-base in seen:continue
                    if any(op.type==CS_OP_MEM and op.mem.disp==member for op in ins.operands):
                        rva=ins.address-base;seen.add(rva)
                        print(json.dumps({'member':hex(member),'at':hex(rva),'function':[hex(x)for x in enclosing(rva)],'instruction':ins.mnemonic+' '+ins.op_str}))
if args.constants:
    addresses = {}
    for value in args.constants:
        for match in re.finditer(re.escape(struct.pack('<f', value)), raw):
            try:
                addresses[base + pe.get_rva_from_offset(match.start())] = value
            except pefile.PEFormatError:
                pass
    found = {}
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        code, at = section.get_data(), base + section.VirtualAddress
        pattern = rb'\xf3[\x40-\x4f]?\x0f[\x10\x58\x59\x5c\x5e\x5d\x5f][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]'
        for match in re.finditer(pattern, code):
            offset, size = match.start(), len(match.group())
            address = at + offset + size + 4 + struct.unpack_from('<i', code, offset + size)[0]
            if address in addresses:
                rva = at + offset - base
                found.setdefault(enclosing(rva), []).append((hex(rva), addresses[address]))
    for (begin, end), refs in sorted(found.items()):
        print(json.dumps({'function': hex(begin), 'end': hex(end), 'refs': refs}))
