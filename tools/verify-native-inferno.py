"""Offline isolated inferno arithmetic fixture; never loads or calls a native DLL."""
import argparse
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

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--write',action='store_true')
p.add_argument('--timers',action='store_true')
p.add_argument('--health',action='store_true')
a=p.parse_args()
game=Path(os.environ.get('CS2_PATH','C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
raw=(game/'game/csgo/bin/win64/server.dll').read_bytes()
sha=hashlib.sha256(raw).hexdigest()
assert sha=='2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c'
pe=pefile.PE(data=raw,fast_load=True)
base=pe.OPTIONAL_HEADER.ImageBase
u=Uc(UC_ARCH_X86,UC_MODE_64)
u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095)
u.mem_write(base,pe.get_memory_mapped_image())
heap,stack=0x10000000,0x20000000
u.mem_map(heap,0x10000)
u.mem_map(stack,0x10000)
f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
def scalar(at,x):u.mem_write(at,struct.pack('<f',x))
def xmm(r,x):u.reg_write(r,struct.unpack('<I',struct.pack('<f',x))[0])
def value(r):return struct.unpack('<f',struct.pack('<I',u.reg_read(r)&0xffffffff))[0]
def return_from_call():
    sp=u.reg_read(reg.UC_X86_REG_RSP)
    dest=struct.unpack('<Q',u.mem_read(sp,8))[0]
    u.reg_write(reg.UC_X86_REG_RSP,sp+8)
    u.reg_write(reg.UC_X86_REG_RIP,dest)

clock=0
interval=f32(.2)
sentinel=heap+0xf000
def hook(uc,address,size,data):
    rva=address-base
    if address==sentinel or (not a.timers and not a.health and rva==0x350783) or (a.health and rva==0x3f4100):
        uc.emu_stop()
        return
    if a.timers and rva in (0x280ae0,0x282cb0):
        return_from_call()
        return
    if a.timers and rva==0x92db00:
        out=uc.reg_read(reg.UC_X86_REG_RCX)
        scalar(out,clock)
        uc.reg_write(reg.UC_X86_REG_RAX,out)
        return_from_call()
        return
    if rva==0x187760:
        xmm(reg.UC_X86_REG_XMM0,interval)
        return_from_call()
        return
    if rva==0xcbad30:
        out=uc.reg_read(reg.UC_X86_REG_RDX)
        scalar(out,clock)
        uc.reg_write(reg.UC_X86_REG_RAX,out)
        return_from_call()
        return
    allowed=[(0x3506bb,0x350783),(0x17e2c0,0x17e2fd),(0x1f8150,0x1f8159),(0x17b8c0,0x17b8db)]
    if a.timers:allowed=[(0xcbd110,0xcbd20f),(0x291440,0x2914e5),(0x17e2c0,0x17e2fd),(0x17dc60,0x17dc6c)]
    if a.health:allowed=[(0x3f40bc,0x3f4100),(0x16c9c64,0x16c9ce0)]
    if not any(b<=rva<e for b,e in allowed):
        raise RuntimeError(f'Unexpected instruction outside isolated arithmetic: {rva:#x}')
u.hook_add(UC_HOOK_CODE,hook)

cases=[]
ramp_inputs=[] if a.timers or a.health else [(0,2),(.1,2),(.2,2),(.4,2),(.6,2),(.8,2),(1,2),(1.2,2),(1.4,2),(1.6,2),(1.8,2),(2,2),(3,2),(.5,1),(.5,0)]
for age,duration in ramp_inputs:
    clock=f32(age)
    expiry=f32(duration)
    scalar(heap+0x13e0,duration)
    scalar(heap+0x13e4,expiry)
    for r,v in [(reg.UC_X86_REG_RSP,stack+0x8000),(reg.UC_X86_REG_RBP,stack+0x9000),(reg.UC_X86_REG_R12,heap)]:u.reg_write(r,v)
    xmm(reg.UC_X86_REG_XMM7,40)
    xmm(reg.UC_X86_REG_XMM0,40)
    xmm(reg.UC_X86_REG_XMM8,0)
    xmm(reg.UC_X86_REG_XMM10,1)
    u.emu_start(base+0x3506bb,base+0x350783,count=2000)
    actual=value(reg.UC_X86_REG_XMM7)
    factor=1 if clock>=expiry or duration==0 else max(0,min(1,f32(f32(f32(clock-expiry)+duration)/duration)))
    expected=f32(f32(40*interval)*factor)
    assert actual==expected,(age,duration,actual,expected)
    cases.append({'age':clock,'rampDuration':duration,'rampExpiry':expiry,'dps':40,'interval':interval,
        'nativeRawDamage':actual,'referenceRawDamage':expected})
report={'build':'2000935','serverSha256':sha,'codeRva':'0x3506bb..0x350783',
    'method':'Offline x64 instruction emulation in Unicorn, not native DLL execution.',
    'inputStubs':['0x187760 convar interval getter returns explicit fixture interval','0xcbad30 clock getter returns explicit fixture time'],
    'nativeHelpers':['0x17e2c0 float comparison','0x1f8150 float subtraction','0x17b8c0 clamp'],
    'excluded':'No world/entity logic, health loss, armor, team scaling, scheduler or gameplay execution. Timer duration/expiry are explicit fixture inputs.',
    'cases':cases}
out=ROOT/'src/range/duel/native-inferno-arithmetic-fixture.json'
if a.timers:
    timer=heap+0x100
    scalar(timer+8,0)
    scalar(timer+0xc,-1)
    scalar(timer+0x10,1)
    u.mem_write(timer+0x14,struct.pack('<I',0))
    expiry=-1
    duration=0
    for now in [0,.1,.2,.2,.65,.65,.65,.81,.81]:
        clock=f32(now)
        sp=stack+0x8000
        u.mem_write(sp,struct.pack('<Q',sentinel))
        u.reg_write(reg.UC_X86_REG_RSP,sp)
        u.reg_write(reg.UC_X86_REG_RCX,timer)
        xmm(reg.UC_X86_REG_XMM1,interval)
        u.emu_start(base+0xcbd110,sentinel,count=2000)
        actual=bool(u.reg_read(reg.UC_X86_REG_RAX)&0xff)
        new_expiry=struct.unpack('<f',u.mem_read(timer+0xc,4))[0]
        expected=expiry>=0 and clock>=expiry
        expected_expiry=f32(expiry+interval) if expected else (f32(clock+interval) if expiry<0 else expiry)
        assert (actual,new_expiry)==(expected,expected_expiry),(clock,actual,new_expiry,expected,expected_expiry)
        cases.append({'now':clock,'previousExpiry':expiry,'nativeDue':actual,'nativeNextExpiry':new_expiry})
        expiry=new_expiry
    report={'build':'2000935','serverSha256':sha,'codeRva':'0xcbd110..0xcbd20f',
        'method':'Offline isolated x64 timer arithmetic; clock and network-dirty bookkeeping are stubbed.',
        'excluded':'No inferno/entity/world scheduler executed; caller loop and contact tests separately audited statically.',
        'cases':cases}
    out=ROOT/'src/range/duel/native-inferno-timer-fixture.json'
if a.health:
    import math
    ramp=json.loads((ROOT/'src/range/duel/native-inferno-arithmetic-fixture.json').read_text())
    inputs=[c['nativeRawDamage'] for c in ramp['cases'] if c['rampDuration']==2 and .19<c['age']<=2]
    accumulator=0
    for raw_damage in inputs:
        scalar(heap+0x120,raw_damage)
        scalar(heap+0x7dc,accumulator)
        u.reg_write(reg.UC_X86_REG_RSP,stack+0x8000)
        u.reg_write(reg.UC_X86_REG_RBX,heap+0x100)
        u.reg_write(reg.UC_X86_REG_RSI,heap+0x500)
        u.emu_start(base+0x3f40bc,base+0x3f4100,count=2000)
        integer=value(reg.UC_X86_REG_XMM0)
        fraction=value(reg.UC_X86_REG_XMM1)
        expected_integer=math.floor(raw_damage)
        expected_fraction=f32(f32(raw_damage-expected_integer)+accumulator)
        if expected_fraction>=1:
            expected_integer+=1
            expected_fraction=f32(expected_fraction-1)
        assert (integer,fraction)==(expected_integer,expected_fraction)
        cases.append({'postModifierDamageInput':raw_damage,'previousAccumulator':accumulator,
            'nativeIntegerComponent':integer,'nativeNewAccumulator':fraction})
        accumulator=fraction
    report={'build':'2000935','serverSha256':sha,'codeRva':'0x3f40bc..0x3f4100',
        'method':'Offline isolated native floor/fraction-carry arithmetic, including native floor helper 0x16c9c64.',
        'excluded':'Conditional arithmetic only. Inputs assume upstream damage modifiers leave the ramp amount unchanged. Does not execute player modifiers, health commit or flags after 0x3f4100.',
        'cases':cases}
    out=ROOT/'src/range/duel/native-inferno-health-arithmetic-fixture.json'
text=json.dumps(report,indent=2)+'\n'
if a.write:
    with out.open('x',encoding='utf-8',newline='\n') as f:f.write(text)
else:assert json.loads(out.read_text(encoding='utf-8'))==report
print(text)
