"""Original modular industrial range architecture, authored in Blender metres."""
import bpy, math, os
from pathlib import Path
from mathutils import Vector
ROOT = Path(globals().get('SPRAYLAB_ROOT', os.getcwd()))
scene = bpy.data.scenes.new('SprayLab Range Architecture'); bpy.context.window.scene = scene
def mat(name, rgb, metal=0, rough=.6, emission=0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*rgb,1)
    p.inputs['Metallic'].default_value = metal; p.inputs['Roughness'].default_value = rough
    if emission: p.inputs['Emission Color'].default_value = (*rgb,1); p.inputs['Emission Strength'].default_value = emission
    return m
steel = mat('Powder coated graphite steel',(.12,.16,.17),.65,.45)
lightsteel = mat('Brushed aluminium',(.48,.54,.55),.8,.35)
red = mat('Safety vermilion',(.42,.085,.055),.15)
yellow = mat('Safety yellow',(.85,.65,.14),.15)
green = mat('Equipment green',(.1,.25,.22),.3)
rubber = mat('Acoustic rubber',(.075,.085,.083))
light = mat('Diffused LED',(.8,.96,1),0,.3,3)
def xyz(p): return Vector((p[0],-p[2],p[1]))
def box(name, size, pos, material, bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos)); o = bpy.context.object; o.name = name
    o.dimensions = (size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        mod = o.modifiers.new('Manufactured edge', 'BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o
def beam(name,a,b,width,material):
    start,end=xyz(a),xyz(b); mid=(start+end)/2
    bpy.ops.mesh.primitive_cube_add(size=1,location=mid); o=bpy.context.object; o.name=name
    o.dimensions=(width,width,(end-start).length); o.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(material)
    return o

for z in [-79,-88,-97,-106,-113]:
    for x in [-11.5,11.5]:
        box('Column web',(.12,5.5,.32),(x,2.75,z),steel)
        for dx in [-.13,.13]: box('Column flange',(.06,5.5,.42),(x+dx,2.75,z),steel)
        box('Bolted baseplate',(.65,.06,.65),(x,.03,z),lightsteel)
        box('Impact guard',(.45,.9,.5),(x,.49,z),yellow)
        for dy in [1.1,4.5]: box('Gusset plate',(.4,.3,.05),(x,dy,z+.24),lightsteel)
    for h in [5.25,6.05]: box('Truss chord',(23.4,.14,.2),(0,h,z),steel)
    for x in range(-11,11,2):
        beam('Truss diagonal',(x,5.25,z),(x+1,6.05,z),.08,lightsteel)
        beam('Truss diagonal',(x+1,6.05,z),(x+2,5.25,z),.08,lightsteel)
    for x in [-7,0,7]:
        box('Luminaire housing',(2.6,.1,.5),(x,5.08,z),steel)
        box('Luminaire diffuser',(2.4,.025,.32),(x,5.01,z),light)
for x in [-9,-5,0,5,9]: box('Roof longitudinal purlin',(.13,.17,35),(x,6.1,-96),steel)
for x in range(-10,11): box('Acoustic back wall fin',(.065,5.3,.4),(x,2.65,-103),rubber)
box('Target rail cover',(15,.08,.3),(0,.05,-100),steel)
for x in [-8.8,8.8]:
    box('Safety side panel',(.45,3.8,1.8),(x,1.9,-101.5),red)
    for h in [1,2,3]: box('Panel aluminium band',(.48,.04,1.85),(x,h,-101.5),lightsteel)
for x in [-10.5,10.5]:
    for z in [-84,-95,-108]:
        box('Equipment cabinet',(.9,1.65,.55),(x,.825,z),green,.035)
        box('Cabinet door',(.79,1.49,.03),(x,.85,z+.3),steel)
        box('Recessed handle',(.055,.2,.045),(x+.28,.95,z+.33),lightsteel)
        for h in range(8): box('Vent louver',(.52,.025,.035),(x,.25+h*.06,z+.33),lightsteel,.003)
    box('Service conduit',(.07,.07,25),(x,3.6,-96),lightsteel)
for x in [-6,6]:
    box('Overhead baffle frame',(5,1,.2),(x,4.5,-101),steel)
    for j in range(12):
        o=box('Baffle absorber',(4.8,.09,.28),(x,4.02+j*.085,-100.96),rubber,.005); o.rotation_euler.x=math.radians(20)
box('Upper fascia',(17,1.1,.4),(0,5.25,-103),steel)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/revamp/models/range-kit.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/spraylab-range.blend'))
print('Original range kit:',len(scene.objects),'components')
