// KENUXA Answer Model v1: sparse bag-of-words multiclass softmax, trained by SGD.
// This is a real small supervised model, not a pretrained generative LLM.
const STOP = new Set('a an the is are was were what who how do does can could please tell me about of in to for and it my you your'.split(' '));
export function features(text) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words.filter(w => !STOP.has(w)))].slice(0, 100);
}
export class AnswerModel {
  constructor(atoms) {
    this.atoms = atoms; this.weights = atoms.map(() => new Map());
    this.vocab = new Set(); this.epochs = 100; this.loss = 0;
    const examples = atoms.flatMap((a, i) => [a.title, ...a.questions].map(q => [features(q), i]));
    for (const [x] of examples) for (const t of x) this.vocab.add(t);
    // Deterministic training makes independent restarts reproducible.
    for (let epoch = 0; epoch < this.epochs && atoms.length; epoch++) {
      let loss = 0;
      for (const [x, label] of examples) {
        const p = this.probabilities(x); loss -= Math.log(Math.max(p[label], 1e-12));
        for (let j = 0; j < atoms.length; j++) {
          const gradient = ((j === label ? 1 : 0) - p[j]) * 0.35;
          for (const t of x) this.weights[j].set(t, (this.weights[j].get(t) || 0) + gradient / Math.sqrt(x.length || 1));
        }
      }
      this.loss = loss / (examples.length || 1);
    }
    this.examples = examples.length;
  }
  probabilities(x) {
    const scores = this.weights.map(w => x.reduce((s, t) => s + (w.get(t) || 0), 0) / Math.sqrt(x.length || 1));
    const max = Math.max(...scores); const exps = scores.map(s => Math.exp(s - max));
    const sum = exps.reduce((a,b) => a+b, 0); return exps.map(x => x/sum);
  }
  predict(question) {
    const tokens = features(question); const known = tokens.filter(t => this.vocab.has(t));
    if (!known.length || !this.atoms.length) return null;
    const probs = this.probabilities(tokens);
    const ranked = probs.map((score,i) => ({score, atom:this.atoms[i]})).sort((a,b)=>b.score-a.score);
    const best = ranked[0];
    // Abstain on unsupported topics even if a softmax class happens to win.
    const exemplarOverlap = Math.max(...[best.atom.title, ...best.atom.questions].map(q => {
      const f = new Set(features(q)); return tokens.filter(t=>f.has(t)).length / Math.max(tokens.length,1);
    }));
    if (best.score < 0.5 || exemplarOverlap < 0.5) return null;
    return {...best, coverage:known.length/tokens.length};
  }
  snapshot() { return { architecture:'sparse-softmax-v1', epochs:this.epochs, examples:this.examples, loss:this.loss, vocabulary:this.vocab.size, weights:this.weights.map(w=>Object.fromEntries(w)) }; }
}
