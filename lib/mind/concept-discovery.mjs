// Conservative cross-domain relation alignment from structured observations.
// Shared subject/object identities are explicit evidence; no claim of semantic understanding.
const valid = x => typeof x === 'string' && x.length > 0 && x.length <= 120;
const id = (d,r) => JSON.stringify([d,r]);
export class ConceptDiscovery {
  constructor({ curriculum, minPairs = 3 } = {}) {
    if (!curriculum?.S?.examples) throw new TypeError('curriculum required');
    this.curriculum = curriculum;
    this.minPairs = Math.max(3, Math.min(20,minPairs));
  }
  discover() {
    const train = this.curriculum.S.examples.filter(e => e.split === 'train');
    const groups = new Map();
    for (const e of train) {
      const k=id(e.domain,e.relation);
      if (!groups.has(k)) groups.set(k,{domain:e.domain,relation:e.relation,pairs:new Map()});
      const g=groups.get(k), pair=JSON.stringify([e.subject,e.object]);
      g.pairs.set(pair,(g.pairs.get(pair)||0)+1);
    }
    const list=[...groups.values()], candidates=[];
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++) {
      const a=list[i],b=list[j];
      if(a.domain===b.domain) continue;
      const common=[...a.pairs.keys()].filter(k=>b.pairs.has(k));
      // Require enough shared observations and no disagreement on shared subjects.
      // Extra pairs in either domain are allowed so transfer to unobserved target pairs is possible.
      if(common.length<this.minPairs) continue;
      const aBySubject=new Map(), bBySubject=new Map();
      for(const p of a.pairs.keys()){const [s,o]=JSON.parse(p);if(!aBySubject.has(s))aBySubject.set(s,new Set());aBySubject.get(s).add(o);}
      for(const p of b.pairs.keys()){const [s,o]=JSON.parse(p);if(!bBySubject.has(s))bBySubject.set(s,new Set());bBySubject.get(s).add(o);}
      const shared=[...aBySubject.keys()].filter(s=>bBySubject.has(s));
      if(shared.some(s=>JSON.stringify([...aBySubject.get(s)].sort())!==JSON.stringify([...bBySubject.get(s)].sort())))continue;
      candidates.push({left:{domain:a.domain,relation:a.relation},right:{domain:b.domain,relation:b.relation},support:common.length,status:'hypothesis'});
    }
    return candidates;
  }
  // Only return a cross-domain inference when exactly one aligned source relation
  // gives an answer. This does not modify the curriculum or train on evaluation data.
  infer({domain,subject,relation}) {
    if(![domain,subject,relation].every(valid)) return {ok:false,reason:'invalid query'};
    const matches=this.discover().filter(h=>(h.left.domain===domain&&h.left.relation===relation)||(h.right.domain===domain&&h.right.relation===relation));
    const answers=[];
    for(const h of matches) {
      const source=h.left.domain===domain&&h.left.relation===relation?h.right:h.left;
      const result=this.curriculum.predict({...source,subject});
      if(result.ok) answers.push({object:result.object,source,hypothesis:h});
    }
    const unique=[...new Set(answers.map(a=>a.object))];
    return unique.length===1 ? {ok:true,object:unique[0],kind:'cross-domain-hypothesis',evidence:answers} : {ok:false,reason:unique.length?'conflicting hypotheses':'no supported cross-domain inference'};
  }
  evaluate({domain,relation}) {
    const held=this.curriculum.S.examples.filter(e=>e.split==='evaluation'&&e.domain===domain&&e.relation===relation);
    if(!held.length) return {ok:false,reason:'no held-out cases'};
    const predictions=held.map(e=>this.infer(e));
    const passed=predictions.filter((p,i)=>p.ok&&p.object===held[i].object).length;
    return {ok:true,passed,total:held.length,accuracy:passed/held.length,kind:'cross-domain-transfer'};
  }
}
