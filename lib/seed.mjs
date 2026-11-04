import {loadCore} from './foundation/data.mjs';
const baseline=loadCore('seeds.json');
export function seeds(){return structuredClone(baseline);}
