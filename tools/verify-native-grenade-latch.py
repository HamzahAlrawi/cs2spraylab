"""Isolated installed throw-cache gate/copy; no game process or DLL loading."""
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

game=Path(os.environ.get('CS2_PATH','C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw=(game/'game/csgo/bin/win64/client.dll').read_bytes()
sha='9279421852772522121be2f13409dd37436e8c809ff48898c8c3d41b09e77844'
if hashlib.sha256(raw).hexdigest()!=sha:raise SystemExit('Installed client changed: re-audit throw latch first')
pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image())
heap,stack=0x10000000,0x20000000
u.mem_map(heap,0x10000);u.mem_map(stack,0x10000)
f=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
scalar=lambda at,n:u.mem_write(at,struct.pack('<f',n))
pointer=lambda at,n:u.mem_write(at,struct.pack('<Q',n))
vector=lambda at:list(struct.unpack('<3f',u.mem_read(at,12)))
used=False
def hook(machine,address,_size,_data):
    global used
    if address==base+0x8ceb4c:used=False;machine.emu_stop()
    elif address==base+0x8cec80:used=True;machine.emu_stop()
    elif not base+0x8cea9c<=address<base+0x8ceb4c:raise RuntimeError(f'Unexpected native path {address-base:#x}')
u.hook_add(UC_HOOK_CODE,hook)
cases=[]
for elapsed in [-.2,-.000001,0,.000001,.015625,.1,.199999,.2,.200001,.3]:
    u.mem_write(heap,bytes(0x4000));u.mem_write(stack,bytes(0x10000))
    for offset,values in [(0x1f28,[-42,173,0]),(0x1f34,[1200,-352,64]),(0x1f40,[1200,-352,36]),(0x1f4c,[120,40,220])]:
        u.mem_write(heap+offset,struct.pack('<3f',*values))
    sp=stack+0x8000;pointer(sp+0x80,heap+0x3300)
    for r,value in [(reg.UC_X86_REG_RDI,heap),(reg.UC_X86_REG_RBP,heap+0x3000),
        (reg.UC_X86_REG_R15,heap+0x3100),(reg.UC_X86_REG_R14,heap+0x3200),(reg.UC_X86_REG_RSP,sp)]:u.reg_write(r,value)
    u.reg_write(reg.UC_X86_REG_XMM0,struct.unpack('<I',struct.pack('<f',elapsed))[0]);u.reg_write(reg.UC_X86_REG_XMM6,0)
    u.emu_start(base+0x8cea9c,base+0x8cec81,count=200)
    cases.append({'elapsed':f(elapsed),'usedCache':used,'eye':vector(heap+0x3100),'velocity':vector(heap+0x3300),'angles':vector(heap+0x3000)})
report={'build':'2000942','clientSha256':sha,'gateAndCopyRva':'0x8cea9c..0x8ceb4c',
    'jumpScheduleRva':'0x8e9b32..0x8e9b7a','captureRva':'0x8e7760..0x8e78c4','earlyDeferralRva':'0x7d7d33..0x7d7d9d',
    'fields':{'m_fStashGrenadeParameterWhen':'movement+0x684','m_grenadeParameterStashTime':'pawn+0x1f20',
        'm_bGrenadeParametersStashed':'pawn+0x1f24','m_angStashedShootAngles':'pawn+0x1f28',
        'm_vecStashedGrenadeThrowPosition':'pawn+0x1f34','m_vecStashedVelocity':'pawn+0x1f4c'},
    'constants':{'delay':struct.unpack('<f',pe.get_data(0x1adf28c,4))[0],'window':struct.unpack('<f',pe.get_data(0x1acff20,4))[0]},
    'excluded':'Elapsed clock and cached vectors are explicit inputs. No movement, world trace, command backlog, capture scheduling or live entity system executed.',
    'cases':cases}
out=ROOT/'src/range/duel/native-grenade-latch-fixture.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8',newline='\n')
elif json.loads(out.read_text())!=report:raise SystemExit('Native latch fixture mismatch')
print(f'PASS {len(cases)} installed native throw-cache gate/copy cases')
