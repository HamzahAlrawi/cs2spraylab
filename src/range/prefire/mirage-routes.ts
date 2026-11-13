import dataset from './data/openprefire-mirage.json';
import authored from './data/mirage-authored-routes.json';
import retakes from './data/retakes-mirage.json';
import community from './data/community-retakes-mirage.json';
import pocketCoverage from './data/common-pocket-coverage.json';
import type {PrefireCatalog,PrefireRoute} from './schema';

export const mirageCatalog:PrefireCatalog={id:'de_mirage',name:'Mirage (Beta)',revision:authored.revision,
  routes:(authored.routes as unknown as readonly PrefireRoute[]).map(route=>({...route,
    coverageGroups:(pocketCoverage.maps as Record<string,Record<string,NonNullable<PrefireRoute['coverageGroups']>>>)['de_mirage']?.[route.id]??[]})),
  sources:[{id:'openprefire-mirage',repository:dataset.source,commit:dataset.commit,license:dataset.license,notice:dataset.licenseNotice,
    context:'Pinned coordinate candidates, filtered per approach against installed native collision. Player paths are trainer-authored. Uniform physical-family coverage, not measured encounter probabilities.'},
    {id:'retakes-mirage',repository:retakes.source,commit:retakes.commit,license:retakes.license,notice:retakes.licenseNotice,
      context:'Authored retake coordinates reused as angle-training holds. Team/phase, labels and movement are trainer adaptations, not measured holding frequencies.'},
    {id:'community-retakes-mirage',repository:community.source,commit:community.commit,license:community.license,notice:community.licenseNotice,context:community.context}]};
