"""Offline native clip fixtures and conditional think-clock examples, not a live-game test."""
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.local-tools/analysis-python'))
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64
from unicorn import x86_const as reg

game=Path(os.environ.get('CS2_PATH','C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
sha='2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c'
raw=(game/'game/csgo/bin/win64/server.dll').read_bytes()
if hashlib.sha256(raw).hexdigest()!=sha:raise SystemExit('Installed server changed: repeat flight audit')
pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image())
heap,stack=0x10000000,0x20000000
u.mem_map(heap,0x10000);u.mem_map(stack,0x10000)
f=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
cases=[]
for velocity,normal in [([100,0,-200],[0,0,1]),([100,50,0],[-1,0,0]),([0,0,20],[0,0,1]),
    ([0,0,0],[0,0,1]),([300,-200,-900],[0,0,1]),([300,40,-500],[.6,0,.8]),([20,-40,55],[0,-.8,.6])]:
    u.mem_write(heap,struct.pack('<3f',*velocity));u.mem_write(heap+0x100,struct.pack('<3f',*normal))
    sp=stack+0x8000;u.reg_write(reg.UC_X86_REG_RSP,sp);u.mem_write(sp+0x28,struct.pack('<f',2))
    for register,value in [(reg.UC_X86_REG_RDX,heap),(reg.UC_X86_REG_R8,heap+0x100),(reg.UC_X86_REG_R9,heap+0x200)]:u.reg_write(register,value)
    u.emu_start(base+0xe94610,base+0xe94699,count=100)
    cases.append({'velocitySourceUnits':velocity,'normalSource':normal,'clippedSourceUnits':list(struct.unpack('<3f',u.mem_read(heap+0x200,12)))})
constants={name:{'rva':hex(at),'value':struct.unpack('<f',pe.get_data(at,4))[0]}for name,at in
    [('elasticity',0x17cf12c),('maximumElasticity',0x1795d78),('normalBias',0x178adf0),('stopSpeedSquared',0x17b84c0),
     ('highSpeedSquared',0x18ef870),('smokeMinimumAge',0x18ef818),('smokeDetonateSpeed',0x1795d58),('timerInterval',0x178adf8)]}
tick=lambda requested:int(f(f(f(requested)*64)+.5))
clock_cases=[{'requested':t,'tick':tick(t)}for t in [0,.2,.4,1,1.5,1000.2]]
report={'build':'2000935','serverSha256':sha,'clipRva':'0xe94610..0xe94699',
    'source':'Isolated native clipping arithmetic from static bytes; no DLL loading or process access.',
    'excluded':'Full contact dispatcher, support predicates, moving surfaces, breakables and engine first-think ordering. Think examples reproduce audited float32 arithmetic, not runtime measurements.',
    'constants':constants,'clipCases':cases,'thinkCases':clock_cases}
path=ROOT/'src/range/duel/native-grenade-flight-fixture.json'
if '--write' in sys.argv:path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
elif json.loads(path.read_text())!=report:raise SystemExit('Native flight fixture mismatch')
print(f'PASS {len(cases)} native clip fixtures and {len(clock_cases)} conditional think examples')
