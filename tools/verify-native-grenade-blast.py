"""Offline fixtures for the installed HE arithmetic, without loading or running CS2."""
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.local-tools/analysis-python'))
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn import x86_const as reg

game=Path(os.environ.get('CS2_PATH','C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
sha='2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c'
raw=(game/'game/csgo/bin/win64/server.dll').read_bytes()
if hashlib.sha256(raw).hexdigest()!=sha:raise SystemExit('Native server changed: repeat HE audit')
pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095)
u.mem_write(base,pe.get_memory_mapped_image())
heap,stack=0x10000000,0x20000000
u.mem_map(heap,0x10000);u.mem_map(stack,0x10000)
f=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
scalar=lambda at,n:u.mem_write(at,struct.pack('<f',n))
bits=lambda r,n:u.reg_write(r,struct.unpack('<I',struct.pack('<f',n))[0])
readreg=lambda r:struct.unpack('<f',struct.pack('<I',u.reg_read(r)&0xffffffff))[0]
exp_stub=heap+0xf000
u.mem_write(base+0x1770e80,struct.pack('<Q',exp_stub))

def hook(machine,at,_size,_data):
    rva=at-base
    if at==exp_stub:
        # This import is explicitly substituted, not claimed bit-exact V_expf.
        bits(reg.UC_X86_REG_XMM0,math.exp(readreg(reg.UC_X86_REG_XMM0)))
        sp=machine.reg_read(reg.UC_X86_REG_RSP)
        machine.reg_write(reg.UC_X86_REG_RIP,struct.unpack('<Q',machine.mem_read(sp,8))[0]);machine.reg_write(reg.UC_X86_REG_RSP,sp+8)
    elif not (0x95b6b1<=rva<0x95b6ef or 0xa8e69f<=rva<0xa8e71a):raise RuntimeError(f'Unexpected native path {rva:#x}')

u.hook_add(UC_HOOK_CODE,hook)
curve=[]
for distance,exposure in [(0,1),(50,1),(100,1),(200,1),(300,1),(350,1),(400,1),(100,.4),(100,.6),(100,0)]:
    u.reg_write(reg.UC_X86_REG_RSP,stack+0x8000);u.reg_write(reg.UC_X86_REG_RBP,heap+0x2000);u.reg_write(reg.UC_X86_REG_RDI,heap+0x1000)
    scalar(heap+0x2000-0x68,350);scalar(heap+0x1000+0x44,99)
    for r,n in [(reg.UC_X86_REG_XMM9,distance),(reg.UC_X86_REG_XMM11,exposure),(reg.UC_X86_REG_XMM15,-0.0)]:bits(r,n)
    u.emu_start(base+0x95b6b1,base+0x95b6ef,count=100)
    curve.append({'distanceUnits':distance,'exposure':exposure,'damage':readreg(reg.UC_X86_REG_XMM10)})
armor=[]
for damage,available in [(99,100),(99,39),(10,3),(2,1),(50,20),(12.5,5),(1,100)]:
    u.reg_write(reg.UC_X86_REG_RSP,stack+0x8000);u.reg_write(reg.UC_X86_REG_RBX,heap+0x3000)
    u.reg_write(reg.UC_X86_REG_RAX,heap+0x4000);u.reg_write(reg.UC_X86_REG_ESI,available)
    scalar(heap+0x3000+0x44,damage);u.mem_write(heap+0x3000+0x4c,struct.pack('<I',0x40));scalar(heap+0x4000+0x828,1.2)
    bits(reg.UC_X86_REG_XMM6,.5);bits(reg.UC_X86_REG_XMM9,1)
    u.emu_start(base+0xa8e69f,base+0xa8e71a,count=100)
    armor.append({'damage':damage,'armor':available,'healthDamage':readreg(reg.UC_X86_REG_XMM1),
        'armorDamage':available-u.reg_read(reg.UC_X86_REG_ESI)})
report={'build':'2000935','serverSha256':sha,'curveRva':'0x95b6b1..0x95b6ef','armorRva':'0xa8e69f..0xa8e71a',
    'source':'Isolated native float32 arithmetic from static server bytes; no DLL loading, process access or game execution.',
    'excluded':'Entity selection, BodyTarget RNG, obstruction/alternate-source solver, damage eligibility and final health rounding. V_expf import substituted with float32(math.exp); not bit-exact native exponential.',
    'constants':{'damage':99,'radius':350,'sigmaDivisor':3,'armorRatio':f(1.2),'blastArmorCost':1,'sourceLiftUnits':1,
        'exposureWeights':[f(.4),f(.2),f(.2),f(.1),f(.1)]},'curveCases':curve,'armorCases':armor}
path=ROOT/'src/range/duel/native-grenade-blast-fixture.json'
if '--write' in sys.argv:path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
elif json.loads(path.read_text())!=report:raise SystemExit('Native HE arithmetic fixture mismatch')
print(json.dumps(report,indent=2))
