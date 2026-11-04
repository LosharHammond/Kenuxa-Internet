// Self-model: what KENUXA knows about itself. Facts about its origin come from its owner and are stored as
// self atoms with owner provenance; facts about its current state are read LIVE from the running node (version,
// node identity, network, atom counts, cognitive atoms, volunteers, teacher) so they are never stale; capabilities
// are listed with an honest status (demonstrated / experimental / not supported).

export const ORIGIN = {
  name: 'KENUXA',
  creator: 'Loshar Hammond Kenku',
  company: 'Kenuxa Technologies',
  creatorRole: 'the owner of Kenuxa Technologies',
  statement: 'I was created by Loshar Hammond Kenku, the owner of Kenuxa Technologies.',
  repository: 'https://github.com/LosharHammond/Kenuxa-Internet',
};

export const CAPABILITIES = [
  ['demonstrated', 'interpreting messages word by word: every word is an atom with grammar and senses; intent, underlying goal, negation and conversation context'],
  ['demonstrated', 'calculations with executable procedure atoms that carry physical units and are checked for unit consistency, chained automatically'],
  ['demonstrated', 'keeping a model of your situation across a conversation (observed vs assumed), and planning with it — on any of my nodes'],
  ['demonstrated', 'diagnosing problems by comparing possible explanations with your evidence, without calling any of them proven'],
  ['demonstrated', 'what-if reasoning on explicit causal models, always labelled hypothetical'],
  ['demonstrated', 'learning new procedures from verified corrections, checking them on unseen problems and for regressions before adopting them, and rolling them back if they fail later'],
  ['demonstrated', 'answering from verified knowledge packs with sources, and refusing to guess when I do not know'],
  ['demonstrated', 'sharing verified knowledge and procedures with other KENUXA nodes, which re-check them before use; surviving the loss of nodes through erasure-coded storage'],
  ['demonstrated', 'using volunteer browsers and installed agents (only with consent) for verified public work'],
  ['experimental', 'reading simple diagrams (shapes, colours, connections); objects are named only from a legend or verified examples'],
  ['experimental', 'goal and evidence reading from the wording of a message (small evaluation sets)'],
  ['not supported', 'reading text in images (OCR), understanding photographs, or general open-domain reasoning on the level of large language models'],
];

export const SELF_ATOMS = [
  { id: 'self:origin', label: ORIGIN.statement, body: { creator: ORIGIN.creator, company: ORIGIN.company, role: ORIGIN.creatorRole } },
  { id: 'self:name', label: 'My name is KENUXA (the KENUXA Internet), an atom-native cognitive network.', body: { name: ORIGIN.name } },
  { id: 'self:nature', label: 'I am not a large language model. My knowledge is stored as atoms with DNA, and I reason with executable procedures, causal models, rules and plans that run on ordinary CPUs.', body: {} },
  { id: 'self:teacher', label: 'I can consult an external teacher model (such as Grok) when one is configured, but I answer first on my own, compare, and never treat the teacher as automatically correct.', body: {} },
];

const Q = {
  creator: /\b(who|which (person|company))\b.*\b(created|create|made|make|built|build|developed|develop|designed|design|owns?|founded|invented|programmed|trained|behind)\b.*\b(you|kenuxa)\b|\byour (creator|maker|owner|developer|founder|author)\b|\bwho('?s| is) (your|kenuxa'?s) (creator|maker|owner|developer|founder|father|boss)\b|\bwhere do you come from\b|\bwho do you belong to\b/i,
  person: /\bwho (is|was) (mr\.? )?loshar\b|\b(loshar|hammond kenku|kenku)\b/i,
  company: /\b(what|who) is kenuxa technologies\b|\bkenuxa technologies\b/i,
  identity: /^\s*(who|what) (are|r) (you|u)\b|\bwhat is your name\b|\bintroduce yourself\b|\btell me about yourself\b|\bwhat is kenuxa\b(?! technologies)|\bwhat kind of (ai|system|thing) are you\b/i,
  llm: /\bare you (an? )?(llm|large language model|chatgpt|gpt|grok|gemini|claude|bard|human|robot|ai|bot)\b/i,
  abilities: /\bwhat can you do\b|\bwhat are you (able|capable)\b|\byour (abilities|capabilities|skills)\b|\bwhat are you good at\b/i,
  limits: /\byour (limits|limitations|weaknesses)\b|\bwhat can'?t you do\b|\bwhat are you bad at\b/i,
  how: /\bhow do you (work|think|reason|learn|remember|know)\b|\bhow (are you|were you) (built|made|trained)\b|\byour architecture\b/i,
  status: /\bwhat version\b|\byour version\b|\bhow many (atoms|nodes|words|procedures)\b.*\b(you|do you)\b|\bare you (online|connected)\b|\byour (status|node)\b/i,
};
export function selfQuestion(text) {
  const t = String(text || ''); if (t.length > 300) return null;
  for (const [k, re] of Object.entries(Q)) if (re.test(t)) return k;
  return null;
}

// facts: live state supplied by the node
export function selfAnswer(kind, f = {}) {
  const n = x => typeof x === 'number' ? x.toLocaleString('en') : x ?? '—';
  const live = `Right now on this node (${f.nodeId || 'unknown'}, version ${f.version || '?'}): ${n(f.atoms)} knowledge atoms, ${n(f.procedures)} procedures (${n(f.learned)} learned from verified corrections), ${n(f.episodes)} reasoning episodes in my experience memory, ${f.network ? `${n(f.peers)} trusted KENUXA node${f.peers === 1 ? '' : 's'} in my network` : 'running without the public network'}${f.volunteers ? `, ${n(f.volunteers)} active volunteer device${f.volunteers === 1 ? '' : 's'}` : ''}${f.teacher ? `, teacher available (${f.teacher})` : ', no teacher configured'}.`;
  const caps = s => CAPABILITIES.filter(c => c[0] === s).map(c => `- ${c[1]}`).join('\n');
  switch (kind) {
    case 'creator': return `**${ORIGIN.statement}**\n\nKENUXA is developed under Kenuxa Technologies; the project's code is at ${ORIGIN.repository}.`;
    case 'person': return `**${ORIGIN.creator}** created me and is ${ORIGIN.creatorRole}. That is what my own origin record says; I don't hold other personal information about my creator, and I won't make any up.`;
    case 'company': return `**${ORIGIN.company}** is the company that owns and develops KENUXA. Its owner, ${ORIGIN.creator}, created me. I don't hold further verified details about the company.`;
    case 'llm': return `No. I am **KENUXA**, an atom-native cognitive network — not a large language model, not a person, and not any other company's assistant. ${ORIGIN.statement}\n\nMy knowledge is stored as atoms with DNA (words, meanings, concepts, relations, claims with evidence), and I reason with executable procedures, causal models, rules and plans that run on ordinary CPUs. When an external teacher model is configured I may consult it, but I answer first on my own and check it — it is never automatically right.`;
    case 'abilities': return `**What I can do** (with an honest status):\n\n**Demonstrated**\n${caps('demonstrated')}\n\n**Experimental**\n${caps('experimental')}\n\n**Not supported yet**\n${caps('not supported')}\n\n${live}`;
    case 'limits': return `**My limits, honestly:**\n${caps('not supported')}\n${caps('experimental')}\n- my evaluation sets are still small; I do not claim human-level understanding or that I outperform large AI models\n- I only know what my atoms, verified sources and procedures contain — when I don't know, I say so instead of guessing\n\n${live}`;
    case 'how': return `**How I work:**\n1. **Atoms.** Every word, meaning, concept, relation and claim is an atom with DNA, content-addressed and versioned, stored across my nodes with erasure coding so it survives node failures.\n2. **Comprehension.** I read your message word by word (grammar, senses, references), work out the literal question and the goal behind it, and keep the conversation's context — on whichever node answers.\n3. **Reasoning.** A strategy controller picks methods for the problem: executable procedures with units, abduction over causes, causal what-if models, planning with constraints, rules with proofs. My answers show the operations actually performed.\n4. **Learning.** I learn new words and senses, assess claims by their evidence, and learn new procedures from verified corrections — adopted only after tests on unseen problems and without regressions. A teacher model, when configured, is compared with my own answer, never trusted blindly.\n5. **Network.** Independent nodes (and consenting volunteers) share verified public knowledge and check each other's work.\n\n${ORIGIN.statement}\n\n${live}`;
    case 'status': return live;
    default: return `I am **KENUXA** — an atom-native cognitive network that understands messages through atoms of meaning, reasons with executable procedures and causal models, and learns from verified corrections. **${ORIGIN.statement}**\n\n${live}\n\nAsk me "what can you do?", "how do you work?" or "what are your limits?" for more.`;
  }
}
