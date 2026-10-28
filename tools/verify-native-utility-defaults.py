"""Verify build-pinned numerical registrations from CS2 files, without execution."""
import argparse
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local-tools/analysis-python'))
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_IMM, CS_OP_MEM

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--write', action='store_true', help='Regenerate the pinned native utility defaults')
a = p.parse_args()
game = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw = (game/'game/csgo/bin/win64/server.dll').read_bytes()
sha = hashlib.sha256(raw).hexdigest()
assert sha == '2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c', 'Server changed: repeat static audit'
pe = pefile.PE(data=raw, fast_load=True)
base = pe.OPTIONAL_HEADER.ImageBase
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True

def instructions(rva, size=0xb8):
    return list(md.disasm(pe.get_data(rva,size),base+rva))

def rip_target(ins, op):
    assert op.type == CS_OP_MEM and ins.reg_name(op.mem.base) == 'rip'
    return ins.address+ins.size+op.mem.disp-base

def string(rva):
    return pe.get_data(rva,128).split(b'\0')[0].decode('ascii')

# The float wrapper explicitly sets type 7 and copies XMM2 into default +7.
wrapper = instructions(0x17ba40,0x73)
assert any(i.mnemonic == 'mov' and i.op_str == 'r8d, 7' for i in wrapper)
assert any(i.mnemonic == 'movss' and i.op_str == 'dword ptr [rax + 7], xmm6' for i in wrapper)
assert any(i.mnemonic == 'mov' and i.op_str == 'byte ptr [rax + 4], 1' for i in wrapper)

records = []
float_initializers = [
    ('inferno_damage',0x5a790,40), ('inferno_damage_ct',0x5a830,40),
    ('inferno_damage_timer',0x5c070,.2), ('inferno_flame_lifetime',0x5a980,7),
    ('inferno_flame_lifetime_incendiary',0x5aa20,5.5),
    ('inferno_max_range',0x5adf0,150), ('inferno_max_range_ct',0x5ae90,110),
    ('molotov_throw_detonate_time',0xb2ca0,2), ('weapon_molotov_maxdetonateslope',0xb49e0,30),
    ('cl_smoke_origin_height',0xb1360,68), ('cl_smoke_torus_ring_radius',0xb1400,61),
    ('cl_smoke_torus_ring_subradius',0xb14a0,88), ('cl_smoke_edge_feather',0xb1220,21),
    ('cl_smoke_lower_speed',0xb12c0,1),
    ('inferno_per_flame_spawn_duration',0x5af30,3),
    ('inferno_initial_spawn_interval',0x5ac00,.02),
    ('inferno_child_spawn_interval_multiplier',0x5a590,.1),
    ('inferno_max_child_spawn_interval',0x5aca0,.5),
    ('inferno_spread_speed_mult',0x5b070,1),('inferno_spread_speed_mult_ct',0x5b110,10),
    ('inferno_flame_spacing',0x5aac0,42),('inferno_spawn_angle',0x5afd0,45),
    ('inferno_surface_offset',0x5b1b0,15),('inferno_forward_reduction_factor',0x5c110,.9),
]
for name, begin, expected in float_initializers:
    insns = instructions(begin)
    call = next(i for i in insns if i.mnemonic == 'call' and i.operands[0].type == CS_OP_IMM and i.operands[0].imm == base+0x17ba40)
    before = [i for i in insns if i.address < call.address]
    name_load = next(i for i in before if i.mnemonic == 'lea' and i.reg_name(i.operands[0].reg) == 'rdx')
    name_rva = rip_target(name_load,name_load.operands[1])
    assert string(name_rva) == name
    load = next(i for i in before if i.mnemonic == 'movss' and i.reg_name(i.operands[0].reg) == 'xmm2')
    data_rva = rip_target(load,load.operands[1])
    data = pe.get_data(data_rva,4)
    value = struct.unpack('<f',data)[0]
    assert data == struct.pack('<f',expected)
    records.append({'name':name,'engineDefault':value,'type':'float32','initializerRva':hex(begin),
        'nameRva':hex(name_rva),'loadRva':hex(load.address-base),'constantRva':hex(data_rva),
        'constantBytesLE':data.hex(),'registrationCallRva':hex(call.address-base),
        'registrationHelperRva':'0x17ba40','confidence':'verified-registration-default'})

for name, begin, expected, width in [('inferno_max_flames',0x5ad40,16,4),('inferno_ct_experiment',0x5a6e0,1,1),
    ('inferno_child_spawn_max_depth',0x5a630,4,4),('inferno_max_trace_per_tick',0x5c1b0,16,4)]:
    insns = instructions(begin)
    name_load = next(i for i in insns if i.mnemonic == 'lea' and i.reg_name(i.operands[0].reg) == 'rdx')
    name_rva = rip_target(name_load,name_load.operands[1])
    assert string(name_rva) == name
    store = next(i for i in insns if i.mnemonic == 'mov' and i.operands[0].type == CS_OP_MEM
        and i.reg_name(i.operands[0].mem.base) == 'rsp' and i.operands[0].mem.disp == 0x37
        and i.operands[1].type == CS_OP_IMM)
    assert store.operands[0].size == width and store.operands[1].imm == expected
    assert any(i.mnemonic == 'mov' and i.op_str == 'byte ptr [rsp + 0x34], 1' for i in insns)
    call = next(i for i in insns if i.mnemonic == 'call' and i.operands[0].type == CS_OP_IMM and i.operands[0].imm == base+0x16a4a30)
    records.append({'name':name,'engineDefault':bool(expected) if width == 1 else expected,
        'type':'bool' if width == 1 else 'int32','initializerRva':hex(begin),'nameRva':hex(name_rva),
        'defaultStoreRva':hex(store.address-base),'defaultStoreBytes':store.bytes.hex(),
        'registrationCallRva':hex(call.address-base),'registrationHelperRva':'0x16a4a30',
        'confidence':'verified-registration-default'})

report = {'build':'2000935','serverSha256':sha,
    'steamInfSha256':hashlib.sha256((game/'game/csgo/steam.inf').read_bytes()).hexdigest(),
    'method':'Static file parsing and disassembly only; no DLL execution, game process, runtime values or older convar snapshot.',
    'caveat':'Registration defaults, not effective map/server configuration; geometry names are not proof of deployment semantics.',
    'convars':records}
text = json.dumps(report,indent=2)+'\n'
output = ROOT/'src/range/duel/native-utility-defaults.json'
if a.write:
    with output.open('w',encoding='utf-8',newline='\n') as f:
        f.write(text)
else:
    assert json.loads(output.read_text(encoding='utf-8')) == report
print(text)
