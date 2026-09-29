"""Read VRF-exported DMX using Blender Source Tools' DMX 9 parser."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.local-tools'))
import datamodel

model = datamodel.load(sys.argv[1])
parents = {}
for element in model.elements:
    if element.type == 'DmeJoint':
        for child in element.get('children', []):
            parents[child.name] = element.name
channels = []
for element in model.elements:
    if element.type != 'DmeChannel' or element['toAttribute'] not in ('position', 'orientation'):
        continue
    bone = element['toElement'].name
    if not bone:
        continue
    layer = element['log']['layers'][0]
    keys = [(float(time), list(value)) for time, value in zip(layer['times'], layer['values']) if time >= 0]
    channels.append({'bone': bone, 'parent': parents.get(bone), 'path': element['toAttribute'],
                     'times': [time for time, _ in keys], 'values': [value for _, value in keys]})
print(json.dumps(channels))
