import dataset from './data/openprefire-mirage.json';
import authored from './data/mirage-authored-routes.json';
import type {PrefireCatalog,PrefireRoute} from './schema';

export const mirageCatalog:PrefireCatalog={id:'de_mirage',name:'Mirage (Beta)',revision:authored.revision,
  routes:authored.routes as unknown as readonly PrefireRoute[],
  sources:[{id:'openprefire-mirage',repository:dataset.source,commit:dataset.commit,license:dataset.license,notice:dataset.licenseNotice,
    context:'Pinned coordinate candidates, filtered per approach against installed native collision. Player paths are trainer-authored. Uniform physical-family coverage, not measured encounter probabilities.'}]};
