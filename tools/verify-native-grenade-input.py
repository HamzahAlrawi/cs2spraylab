"""Offline arithmetic fixtures from pinned static CS2 files; never loads a game DLL."""
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.local-tools/analysis-python'))
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn import x86_const as reg

GAME=Path(os.environ.get('CS2_PATH','C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
SHA='ccaf4e4926babc052994502b19ec61198a11008a39dce712921b93dd993be9f5'
raw=(GAME/'game/csgo/bin/win64/client.dll').read_bytes()
if hashlib.sha256(raw).hexdigest()!=SHA:raise SystemExit('Installed client changed: re-audit before regenerating input fixtures')
pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
machine=Uc(UC_ARCH_X86,UC_MODE_64)
machine.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095)
machine.mem_write(base,pe.get_memory_mapped_image())
heap,stack=0x10000000,0x20000000
machine.mem_map(heap,0x10000);machine.mem_map(stack,0x10000)
sentinel=heap+0xf000
f32=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
pointer=lambda at,n:machine.mem_write(at,struct.pack('<Q',n))
scalar=lambda at,n:machine.mem_write(at,struct.pack('<f',n))
read=lambda at:struct.unpack('<f',machine.mem_read(at,4))[0]
floatreg=lambda r:struct.unpack('<f',struct.pack('<I',machine.reg_read(r)&0xffffffff))[0]
setfloat=lambda r,n:machine.reg_write(r,struct.unpack('<I',struct.pack('<f',n))[0])
now=0

def hook(uc,address,_size,_data):
    rva=address-base
    if address==sentinel or rva==0x7df31d:uc.emu_stop();return
    if rva in (0x75e050,0x15c5d0):
        # Clock/timestamp plumbing is explicit input, not emulated gameplay.
        out=uc.reg_read(reg.UC_X86_REG_RCX)
        value=now if rva==0x75e050 else f32(read(uc.reg_read(reg.UC_X86_REG_RDX))+floatreg(reg.UC_X86_REG_XMM2))
        scalar(out,value);uc.reg_write(reg.UC_X86_REG_RAX,out)
        sp=uc.reg_read(reg.UC_X86_REG_RSP)
        uc.reg_write(reg.UC_X86_REG_RIP,struct.unpack('<Q',uc.mem_read(sp,8))[0]);uc.reg_write(reg.UC_X86_REG_RSP,sp+8)
        return
    if not (0x3a5c70<=rva<0x3a5ca2 or 0x7df2c0<=rva<0x7df31d):raise RuntimeError(f'Unexpected path {rva:#x}')

machine.hook_add(UC_HOOK_CODE,hook)
step=struct.unpack('<f',pe.get_data(0x1bd5db8,4))[0]
delay=struct.unpack('<f',pe.get_data(0x1adc29c,4))[0]
approach=[]
for current,target in [(1,0),(0,1),(.5,1),(.5,0),(.49,.5),(.51,.5),(.5,.5)]:
    sp=stack+0x8000;pointer(sp,sentinel);machine.reg_write(reg.UC_X86_REG_RSP,sp)
    for r,n in [(reg.UC_X86_REG_XMM0,target),(reg.UC_X86_REG_XMM1,current),(reg.UC_X86_REG_XMM2,step)]:setfloat(r,n)
    machine.emu_start(base+0x3a5c70,sentinel,count=100)
    approach.append({'current':current,'target':target,'step':step,'result':floatreg(reg.UC_X86_REG_XMM0)})
release=[]
pointer(heap+0x10,heap+0x3000)
for now in [0,.125,3.1,60,600]:
    sp=stack+0x8000;pointer(sp,sentinel);machine.reg_write(reg.UC_X86_REG_RSP,sp)
    machine.reg_write(reg.UC_X86_REG_RCX,heap);scalar(heap+0x1f28,-1)
    machine.emu_start(base+0x7df2c0,sentinel,count=100)
    release.append({'releasedAt':f32(now),'throwAt':read(heap+0x1f28)})
report={'build':'2000935','clientSha256':SHA,
    'source':'Isolated native Approach arithmetic and release-scheduler prefix; static file mapped into Unicorn, not loaded as a DLL.',
    'approachRva':'0x3a5c70..0x3a5ca2','releaseRva':'0x7df2c0..0x7df31d',
    'inputPath':'0x903673 -> virtual0xc98 -> 0x7d7730; release at0x7d7bf3 -> 0x7df2c0; no animation-age guard in that input path.',
    'excluded':'Clock/timestamp helpers are explicit inputs. No animation graph, entity system, world tracing or running game is executed.',
    'constants':{'strengthStepPer64Tick':step,'releaseDelay':delay,'middleStrength':.5,'middleSnapTolerance':f32(.1)},
    'approachCases':approach,'releaseCases':release}
path=ROOT/'src/range/duel/native-grenade-input-fixture.json'
if '--write' in sys.argv:path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
elif json.loads(path.read_text())!=report:raise SystemExit('Native input fixture mismatch')
print(json.dumps(report,indent=2))
