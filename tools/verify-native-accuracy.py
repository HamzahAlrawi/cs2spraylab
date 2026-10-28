"""Read-only CS2 accuracy audit; never loads a DLL or accesses a game process.

Disassembly may inspect a changed build. Emulation must reject changed hashes.
Requires pefile, capstone and (for numeric fixtures) unicorn.
"""
import argparse
import bisect
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import tempfile
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(os.environ.get('CS2_PATH', 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'))
CLIENT = GAME / 'game/csgo/bin/win64/client.dll'
CLIENT_SHA = '44af2aa0d2c64f90d273444cb393b8b679094f0b02136dbdb89d4ec82a560008'


def weapon_stats():
    """Fresh resource export to an automatically cleaned temporary directory."""
    with tempfile.TemporaryDirectory(prefix='spraylab-accuracy-') as temporary:
        output = Path(temporary) / 'weapons.vdata'
        cli = ROOT / '.local-tools/vrf/Source2Viewer-CLI.exe'
        subprocess.run([str(cli), '-i', str(GAME / 'game/csgo/pak01_dir.vpk'),
                        '-f', 'scripts/weapons.vdata_c', '-d', '-o', str(output)],
                       check=True, capture_output=True)
        source = output.read_text(encoding='utf-8')
        script = """
import fs from 'node:fs';
import {parseKv3} from './tools/kv3.mjs';
const native=parseKv3(fs.readFileSync(process.argv[1],'utf8'));
const runtime=JSON.parse(fs.readFileSync('src/range/game-data.json','utf8'));
const aliases={m4a4:'m4a1',m4a1s:'m4a1_silencer',galil:'galilar',sg553:'sg556',usp:'usp_silencer',zeus:'taser'};
const fields={damage:'m_nDamage',penetration:'m_flPenetration',armorRatio:'m_flArmorRatio',headshotMultiplier:'m_flHeadshotMultiplier',
range:'m_flRange',rangeModifier:'m_flRangeModifier',magazine:'m_iMaxClip1',cycle:'m_flCycleTime',speed:'m_flMaxSpeed',
spread:'m_flSpread',stand:'m_flInaccuracyStand',crouch:'m_flInaccuracyCrouch',move:'m_flInaccuracyMove',fire:'m_flInaccuracyFire',
jump:'m_flInaccuracyJump',jumpInitial:'m_flInaccuracyJumpInitial',jumpApex:'m_flInaccuracyJumpApex',land:'m_flInaccuracyLand',
recovery:'m_flRecoveryTimeStand',recoveryFinal:'m_flRecoveryTimeStandFinal',recoveryCrouch:'m_flRecoveryTimeCrouch',
recoveryCrouchFinal:'m_flRecoveryTimeCrouchFinal',recoveryStart:'m_nRecoveryTransitionStartBullet',recoveryEnd:'m_nRecoveryTransitionEndBullet',
recoilSeed:'m_nRecoilSeed',recoilAngle:'m_flRecoilAngle',recoilVariance:'m_flRecoilAngleVariance',recoilMagnitude:'m_flRecoilMagnitude',recoilMagnitudeVariance:'m_flRecoilMagnitudeVariance'};
const differences=[];let comparisons=0;
for(const [id,weapon] of Object.entries(runtime.weapons)){
 const row=native[`weapon_${aliases[id]||id}`]; if(!row)throw Error(`Missing ${id}`);
 for(const [mode,index] of [['primary',['usp','m4a1s'].includes(id)?1:0],['alternate',1]]){
  const stored=mode==='primary'?weapon:weapon.alternate;
  for(const [key,field] of Object.entries(fields)){
   const value=Array.isArray(row[field])?row[field][index]:row[field];comparisons++;
   if(value!==stored[key])differences.push({id,mode,key,stored:stored[key],native:value});
  }
 }
}
console.log(JSON.stringify({runtimeBuild:runtime.build,weaponCount:Object.keys(runtime.weapons).length,comparisons,differences}));
"""
        report = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script, str(output)], cwd=ROOT, text=True))
        report['exportSha256'] = hashlib.sha256(source.encode()).hexdigest()
        report['installedBuild'] = re.search(r'ClientVersion=(\d+)', (GAME / 'game/csgo/steam.inf').read_text()).group(1)
        return report


def emulate(raw):
    """Emulate inspected SSE slices, with math imports/owner lookup stubbed only."""
    if hashlib.sha256(raw).hexdigest() != CLIENT_SHA:
        raise SystemExit('Client build changed: re-inspect offsets before emulation.')
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
    from unicorn.x86_const import (UC_X86_REG_RSP, UC_X86_REG_RCX, UC_X86_REG_RAX,
                                  UC_X86_REG_RDI, UC_X86_REG_RBX, UC_X86_REG_R14,
                                  UC_X86_REG_RIP, UC_X86_REG_XMM0, UC_X86_REG_XMM1,
                                  UC_X86_REG_XMM2,
                                  UC_X86_REG_XMM6, UC_X86_REG_XMM8, UC_X86_REG_XMM9,
                                  UC_X86_REG_XMM11)
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    machine = Uc(UC_ARCH_X86, UC_MODE_64)
    machine.mem_map(base, (pe.OPTIONAL_HEADER.SizeOfImage + 4095) & ~4095)
    machine.mem_write(base, pe.get_memory_mapped_image())
    heap, stack = 0x10000000, 0x20000000
    machine.mem_map(heap, 0x20000)
    machine.mem_map(stack, 0x10000)
    weapon, owner, definition = heap, heap + 0x3000, heap + 0x6000
    sentinel, pow_stub, log_stub, exp_stub = [heap + 0x10000 + n * 0x100 for n in range(4)]
    pointer = lambda address, value: machine.mem_write(address, struct.pack('<Q', value))
    scalar = lambda address, value: machine.mem_write(address, struct.pack('<f', value))
    read = lambda address: struct.unpack('<f', machine.mem_read(address, 4))[0]

    def xmm(register, value):
        machine.reg_write(register, struct.unpack('<I', struct.pack('<f', value))[0])

    def value(register):
        return struct.unpack('<f', struct.pack('<I', machine.reg_read(register) & 0xffffffff))[0]

    pointer(weapon + 0x388, definition)
    pointer(base + 0x1aa7520, pow_stub)
    pointer(base + 0x1aa6768, log_stub)
    pointer(base + 0x1aa6760, exp_stub)
    allowed = [(0x80b9a5, 0x80b9ed), (0x280040, 0x280091), (0x80c5d0, 0x80c6bc),
               (0x8274ab, 0x827522), (0x81f370, 0x81f398), (0x803553, 0x803566)]
    native_inputs = {}

    def hook(uc, address, _size, _data):
        if address == base + 0x80b9c5:
            native_inputs.update(speed=value(UC_X86_REG_XMM0), low=value(UC_X86_REG_XMM1), high=value(UC_X86_REG_XMM2))
            return
        elif address == base + 0x80b9ca:
            native_inputs['remapped'] = value(UC_X86_REG_XMM0)
            return
        elif address == pow_stub:
            xmm(UC_X86_REG_XMM0, math.pow(value(UC_X86_REG_XMM0), value(UC_X86_REG_XMM1)))
        elif address == log_stub:
            xmm(UC_X86_REG_XMM0, math.log(value(UC_X86_REG_XMM0)))
        elif address == exp_stub:
            xmm(UC_X86_REG_XMM0, math.exp(value(UC_X86_REG_XMM0)))
        elif address == base + 0x9410e0:
            uc.reg_write(UC_X86_REG_RAX, owner)
        elif address == base + 0x21c660:
            uc.reg_write(UC_X86_REG_RAX, 0)  # Ordinary movement, not ladder (9).
        else:
            if any(base + start <= address < base + end for start, end in allowed):
                return
            raise RuntimeError(f'Unverified execution path at RVA {address - base:#x}')
        sp = uc.reg_read(UC_X86_REG_RSP)
        uc.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', uc.mem_read(sp, 8))[0])
        uc.reg_write(UC_X86_REG_RSP, sp + 8)

    machine.hook_add(UC_HOOK_CODE, hook)

    def run(start, end):
        machine.emu_start(base + start, end, count=500)
        if machine.reg_read(UC_X86_REG_RIP) != end:
            raise RuntimeError('Arithmetic instruction budget exceeded')

    def setup():
        machine.reg_write(UC_X86_REG_RSP, stack + 0x8008)
        pointer(stack + 0x8008, sentinel)
        machine.reg_write(UC_X86_REG_RCX, weapon)
        machine.reg_write(UC_X86_REG_RDI, weapon)

    data = json.loads((ROOT / 'src/range/game-data.json').read_text())['weapons']
    recovery_cases, movement_cases, penalty_cases, landing_cases, firing_cases = [], [], [], [], []
    for id in ['ak47', 'm4a4', 'usp', 'awp', 'mp9']:
        stats = data[id]
        for ratio in [0, .3399, .34, .3400000000000001, .340000000001, .3401, .35, .52, .65, .9499, .95, 1, 1.2]:
            for walking in [False, True]:
                setup()
                xmm(UC_X86_REG_XMM0, stats['speed'] * ratio)
                xmm(UC_X86_REG_XMM6, stats['speed'])
                xmm(UC_X86_REG_XMM8, 0)
                xmm(UC_X86_REG_XMM9, stats['move'])
                xmm(UC_X86_REG_XMM11, 1)
                machine.reg_write(UC_X86_REG_R14, int(walking))
                run(0x80b9a5, base + 0x80b9ed)
                movement_cases.append({'weapon': id, 'speedRatio': ratio, 'walking': walking,
                                       'nativeInputs': dict(native_inputs, cap=stats['speed']),
                                       'result': value(UC_X86_REG_XMM0)})
        for crouch, airborne in [(False, False), (True, False), (False, True)]:
            flags = 0 if airborne else 3 if crouch else 1
            machine.mem_write(owner + 0x3f4, struct.pack('<I', flags))
            for offset, key in [(0x840, 'recoveryCrouch'), (0x844, 'recovery'),
                                (0x848, 'recoveryCrouchFinal'), (0x84c, 'recoveryFinal')]:
                scalar(definition + offset, stats[key])
            for offset, key in [(0x850, 'recoveryStart'), (0x854, 'recoveryEnd')]:
                machine.mem_write(definition + offset, struct.pack('<I', stats[key]))
            for index in [0, 2, 2.99, 3, 4, 5, 8]:
                scalar(weapon + 0x1a28, index)
                setup()
                run(0x80c5d0, sentinel)
                duration = value(UC_X86_REG_XMM0)
                recovery_cases.append({'weapon': id, 'index': index, 'crouch': crouch, 'airborne': airborne, 'result': duration})
            # The baseline is an explicit input; entity/weapon vtable lookups are excluded.
            baseline = stats['stand'] + stats['jump'] if airborne else stats['crouch'] if crouch else stats['stand']
            scalar(weapon + 0x1a28, 1)
            for before in sorted(set([0, stats['stand'], stats['crouch'], baseline, baseline + stats['fire'], baseline + 4 * stats['fire']])):
                setup()
                scalar(weapon + 0x1a18, before)
                xmm(UC_X86_REG_XMM8, baseline)
                run(0x8274ab, base + 0x827522)
                penalty_cases.append({'weapon': id, 'index': 1, 'crouch': crouch, 'airborne': airborne,
                                      'baseline': baseline, 'before': before, 'dt': 1 / 64,
                                      'result': read(weapon + 0x1a18)})
        for before in [0, stats['stand'], stats['stand'] + 4 * stats['fire']]:
            setup()
            from unicorn.x86_const import UC_X86_REG_RSI
            machine.reg_write(UC_X86_REG_RSI, weapon)
            scalar(weapon + 0x1a18, before)
            xmm(UC_X86_REG_XMM0, stats['fire'])
            run(0x803553, base + 0x803566)
            firing_cases.append({'weapon': id, 'before': before, 'fire': stats['fire'], 'result': value(UC_X86_REG_XMM0)})
        for impact in [0, 100, 200, 301.993, 500]:
            setup()
            machine.reg_write(UC_X86_REG_RBX, weapon)
            scalar(weapon + 0x1a18, stats['stand'])
            xmm(UC_X86_REG_XMM0, stats['land'])
            xmm(UC_X86_REG_XMM6, impact)
            run(0x81f370, base + 0x81f398)
            landing_cases.append({'weapon': id, 'input': impact, 'coefficient': stats['land'],
                                  'before': stats['stand'], 'result': read(weapon + 0x1a18)})
    return {'build': '2000930', 'clientSha256': CLIENT_SHA,
            'instructionRanges': {'movement': '80b9a5..80b9ed', 'remap': '280040..280091',
                                  'recoveryTime': '80c5d0..80c6bc', 'penalty': '8274ab..827522', 'landing': '81f370..81f398',
                                  'firing': '803553..803566'},
            'limitations': ['Only isolated inspected SSE arithmetic; no DLL loading or game process.',
                            'Owner/MoveType lookup stubbed; ordinary movement flags and weapon stats supplied explicitly.',
                            'powf/logf/expf imports use Python math rounded to float32, not native CRT implementations.',
                            'Penalty baseline is supplied, not captured from the complete native entity state machine.',
                            'Native penalty slice advances one 64 Hz tick; browser fixed-step integration is not subtick parity.',
                            'Landing fixture verifies coefficient multiplication/addition only; caller input meaning is not verified.',
                            'No spread command seed, end-to-end firing, hitboxes, rendered camera or stance-transition timing parity.'],
            'movement': movement_cases, 'recoveryTime': recovery_cases, 'penalty': penalty_cases, 'landing': landing_cases,
            'firing': firing_cases}


def inspect(raw, start=None, size=None):
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True
    functions = sorted((e.struct.BeginAddress, e.struct.EndAddress) for e in pe.DIRECTORY_ENTRY_EXCEPTION)
    starts = [s for s, _ in functions]

    def listing(begin, end):
        for ins in md.disasm(pe.get_data(begin, end - begin), base + begin):
            notes = []
            for operand in ins.operands:
                if operand.type == CS_OP_MEM and ins.reg_name(operand.mem.base) == 'rip':
                    address = ins.address + ins.size + operand.mem.disp - base
                    data = pe.get_data(address, 8)
                    if len(data) >= 4:
                        notes.append(f'[{address:#x}] f32={struct.unpack_from("<f", data)[0]:.10g}')
            print(f'{ins.address - base:x} {ins.mnemonic} {ins.op_str} {"; ".join(notes)}')

    if start is not None:
        begin, end = functions[bisect.bisect_right(starts, start) - 1]
        if size is not None:
            begin, end = start, start + size
        listing(begin, end)
        return
    constants = {}
    for value in [.34, .95, .25, -2.302585092994, 2.302585092994]:
        for match in re.finditer(re.escape(struct.pack('<f', value)), raw):
            try:
                constants[base + pe.get_rva_from_offset(match.start())] = value
            except pefile.PEFormatError:
                pass
    matches = {}
    for section in pe.sections:
        if not section.Characteristics & 0x20000000:
            continue
        code, section_start = section.get_data(), base + section.VirtualAddress
        pattern = rb'\xf3[\x40-\x4f]?\x0f[\x10\x58\x59\x5c\x5e\x5d\x5f][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]'
        for match in re.finditer(pattern, code):
            offset, length = match.start(), len(match.group())
            address = section_start + offset + length + 4 + struct.unpack_from('<i', code, offset + length)[0]
            if address not in constants:
                continue
            rva = section_start + offset - base
            function = functions[bisect.bisect_right(starts, rva) - 1]
            matches.setdefault(function, []).append((hex(rva), constants[address]))
    for function, refs in sorted(matches.items()):
        values = {v for _, v in refs}
        if (.34 in values and .95 in values) or any(abs(v) > 2 for v in values):
            print('FUNCTION', hex(function[0]), hex(function[1]), refs)
            listing(*function)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--rva', type=lambda value: int(value, 0))
    parser.add_argument('--size', type=lambda value: int(value, 0))
    parser.add_argument('--stats', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    raw = CLIENT.read_bytes()
    print('clientSha256', hashlib.sha256(raw).hexdigest())
    if args.stats:
        print(json.dumps(weapon_stats(), indent=2))
    elif args.inspect or args.rva is not None:
        inspect(raw, args.rva, args.size)
    else:
        output = emulate(raw)
        output['weaponStatAudit'] = weapon_stats()
        path = ROOT / 'src/range/native-accuracy-fixture.json'
        if args.write:
            path.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8', newline='\n')
        elif json.loads(path.read_text()) != output:
            raise SystemExit('Numeric fixture changed; re-inspect before regeneration.')
        print('Verified', {key: len(output[key]) for key in ['movement', 'recoveryTime', 'penalty', 'landing', 'firing']})
        print('Weapon resource comparison', output['weaponStatAudit'])


if __name__ == '__main__':
    main()
