import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMapEntities} from '../native-map-entities.mjs';

test('parses native entity identities, typed model resources and linked break outputs', () => {
  const entities = parseMapEntities('====0====\r\nclassname "prop_dynamic"\r\nmodel resource_name:"models/cover.vmdl"\r\nhealth 1\r\n' +
    'origin [ 1.0, 2.0, 3.0 ]\r\nstartdisabled false\r\nhammeruniqueid "2:7:9"\r\n@OnBreak Enable [PR#]remainder\r\n' +
    '====1====\r\nclassname "prop_dynamic"\r\nstartdisabled true\r\ntargetname "[PR#]remainder"\r\n');
  assert.equal(entities.length, 2);
  assert.equal(entities[0].model, 'models/cover.vmdl'); assert.deepEqual(entities[0].origin, [1, 2, 3]);
  assert.equal(entities[0].health, 1); assert.equal(entities[0].hammeruniqueid, '2:7:9');
  assert.deepEqual(entities[0].enableOnBreak, ['[PR#]remainder']); assert.equal(entities[1].startdisabled, true);
});
