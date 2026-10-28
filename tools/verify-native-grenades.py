"""Emulate isolated installed grenade launch arithmetic; no DLL loading or game-process access."""
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
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn import x86_const as reg

GAME=Path(os.environ.get('CS2_PATH','C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
SHA='ccaf4e4926babc052994502b19ec61198a11008a39dce712921b93dd993be9f5'
raw=(GAME/'game/csgo/bin/win64/client.dll').read_bytes()
if hashlib.sha256(raw).hexdigest()!=SHA:raise SystemExit('Native client changed: re-inspect before regenerating grenade fixtures')
pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
machine=Uc(UC_ARCH_X86,UC_MODE_64)
machine.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095)
machine.mem_write(base,pe.get_memory_mapped_image())
heap,stack=0x10000000,0x20000000
machine.mem_map(heap,0x10000);machine.mem_map(stack,0x10000)
angles,eye,velocity,out_origin,out_velocity= [heap+n*0x100 for n in range(5)]
sentinel=heap+0xf000
pointer=lambda at,value:machine.mem_write(at,struct.pack('<Q',value))
scalar=lambda at,value:machine.mem_write(at,struct.pack('<f',value))
vector=lambda at: list(struct.unpack('<3f',machine.mem_read(at,12)))
def xmm(register,value):machine.reg_write(register,struct.unpack('<I',struct.pack('<f',value))[0])
def xmm_float(register):return struct.unpack('<f',struct.pack('<I',machine.reg_read(register)&0xffffffff))[0]
pointer(base+0x24c8f78,heap+0x1000)
machine.mem_write(heap+0x1058,b'\0')
trace_fraction=1
trace_source=[]
trace_forward=[]

def hook(uc,address,_size,_data):
    global trace_source,trace_forward
    rva=address-base
    if address==sentinel:uc.emu_stop();return
    if rva==0x1742b70:
        # External AngleVectors math is isolated; it does not decide gameplay.
        p,y,_=vector(angles);p,y=math.radians(p),math.radians(y)
        forward=[f32(math.cos(p)*math.cos(y)),f32(math.cos(p)*math.sin(y)),f32(-math.sin(p))]
        uc.mem_write(uc.reg_read(reg.UC_X86_REG_RDX),struct.pack('<3f',*forward))
        sp=uc.reg_read(reg.UC_X86_REG_RSP)
        uc.reg_write(reg.UC_X86_REG_RIP,struct.unpack('<Q',uc.mem_read(sp,8))[0]);uc.reg_write(reg.UC_X86_REG_RSP,sp+8)
        return
    if rva==0x7c7c6d:
        # Only world tracing is stubbed. The native code's own +16u sweep end
        # and +/-2.02u hull are separately audited from instructions/constants.
        sp=uc.reg_read(reg.UC_X86_REG_RSP)
        trace_source=vector(eye);trace_forward=vector(sp+0x30)
        end=[f32(a+f32(b*16*trace_fraction)) for a,b in zip(trace_source,trace_forward)]
        uc.reg_write(reg.UC_X86_REG_XMM0,int.from_bytes(struct.pack('<2f',*end[:2]),'little'))
        uc.reg_write(reg.UC_X86_REG_RAX,struct.unpack('<I',struct.pack('<f',end[2]))[0])
        uc.reg_write(reg.UC_X86_REG_RIP,base+0x7c7e7e)
        return
    if not (0x7c7b10<=rva<0x7c7c6d or 0x7c7e7e<=rva<0x7c7f1a):
        raise RuntimeError(f'Unverified native path {rva:#x}')

machine.hook_add(UC_HOOK_CODE,hook)
fixtures=[]
for pitch,strength,speed,motion,fraction in [
    (0,1,750,[0,0,0],1),(0,.5,750,[0,0,0],1),(0,0,750,[0,0,0],1),
    (45,1,750,[100,-200,301],1),(-45,0,750,[-55,25,-120],1),
    (89,1,750,[0,0,0],.25),(-89,1,750,[0,0,0],1),
    (0,-1,750,[0,0,0],1),(0,2,750,[0,0,0],1),
    (0,1,1,[0,0,0],1),(0,1,1000,[0,0,0],1),
]:
    initial_eye=[0,0,64];trace_fraction=fraction
    for at,values in [(angles,[-pitch,90,0]),(eye,initial_eye),(velocity,motion)]:machine.mem_write(at,struct.pack('<3f',*values))
    sp=stack+0x8000;pointer(sp,sentinel)
    pointer(sp+0x28,velocity);scalar(sp+0x30,speed);scalar(sp+0x38,strength)
    pointer(sp+0x40,out_origin);pointer(sp+0x48,out_velocity)
    for register,value in [(reg.UC_X86_REG_RSP,sp),(reg.UC_X86_REG_RCX,heap+0x2000),
        (reg.UC_X86_REG_RDX,angles),(reg.UC_X86_REG_R8,eye),(reg.UC_X86_REG_R9,heap+0x3000)]:machine.reg_write(register,value)
    machine.emu_start(base+0x7c7b10,sentinel,count=10000)
    fixtures.append({'pitchUpDegrees':pitch,'yawDegrees':90,'strength':strength,'throwVelocity':speed,
        'eye':initial_eye,'actorVelocity':motion,'traceFraction':fraction,'traceSource':trace_source,
        'adjustedPitchDownDegrees':vector(angles)[0],'forward':trace_forward,
        'origin':vector(out_origin),'velocity':vector(out_velocity)})
report={'build':'2000935','clientSha256':SHA,'source':'Isolated installed client arithmetic, static file mapped into Unicorn, not loaded into a game.',
    'launchRva':'0x7c7b10..0x7c7f1a','excluded':'AngleVectors trigonometry and world hull tracing supplied as explicit fixture inputs; no entity or game logic executed.',
    'constants':{'forwardSweep':16,'hullRadius':2.02,'strengthHeight':12,'minimumSpeed':15,'maximumSpeed':750,
        'velocityScale':f32(.9),'strengthScale':f32(.7),'strengthBase':f32(.3),'velocityInheritance':1.25},'cases':fixtures}
path=ROOT/'src/range/duel/native-grenade-launch-fixture.json'
if '--write' in sys.argv:path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
elif json.loads(path.read_text())!=report:raise SystemExit('Native launch fixture mismatch')
print(json.dumps(report,indent=2))
