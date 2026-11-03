// Curated knowledge packs: small sets of claims that were checked against the cited source by a person
// (or, for KENUXA itself, against its own implementation). Every claim names its sources and its status:
//   source-checked  — the cited page says this (as of `accessed`)
//   check-current   — said by the source but likely to change (fees, thresholds, rates) or secondary-sourced
//   derived         — KENUXA's own reasoning from source-checked claims (marked as such in answers)
// Packs are loaded as atoms (claims → 'sentence' atoms, options → 'concept' atoms) so they are preserved,
// shared and versioned like all other knowledge. Nothing here is an answer template: composers select claims.
export const PACKS = [
  {
    id: 'gh-solar-business', title: 'Starting a solar business in Ghana', kind: 'business-startup', version: 1, accessed: '2026-11-03',
    match: { all: [['solar', 'pv', 'photovoltaic'], ['company', 'business', 'startup', 'start', 'enterprise', 'firm', 'licence', 'license', 'licences', 'licenses', 'install', 'installer', 'installation']], location: ['ghana', 'accra', 'kumasi', 'tamale', 'takoradi'] },
    sources: {
      ec: { title: 'Energy Commission — Licensing in the renewable energy sector', publisher: 'Energy Commission of Ghana', url: 'https://energycom.gov.gh/licensing/licensing-renewable-energy-sector' },
      notice: { title: 'Energy Commission — Public notice: licensing of all renewable energy service providers', publisher: 'Energy Commission of Ghana', url: 'https://energycom.gov.gh/public-notices/74-licensing-of-all-renewable-energy-service-providers' },
      guide: { title: 'Energy Commission — Licence application guidelines: installation & maintenance (June 2023)', publisher: 'Energy Commission of Ghana', url: 'https://www.energycom.gov.gh/index.php/licensing/electricity-renewables?download=220%3Ainstallation-and-maintenance-licence-solar-pv-water-pump-service-providers' },
      orc: { title: 'GNA — How to register your business in Ghana (Aug 2023)', publisher: 'Ghana News Agency', url: 'https://gna.org.gh/2023/08/how-to-register-your-business-in-ghana/' },
      pulse: { title: 'Pulse Ghana — Business registration guide (Feb 2026)', publisher: 'Pulse Ghana', url: 'https://www.pulse.com.gh/story/business-registration-ghana-guide-2026-2026020312461840367' },
      act: { title: 'Renewable Energy Act, 2011 (Act 832)', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Renewable_Energy_Act,_2011' },
    },
    options: [
      { id: 'referral', label: 'Sales agent or referral partner for a licensed installer', capital: 'very low', needsTechnician: false, licence: 'licensed-partner', what: 'You find and qualify customers; a company that already holds an Energy Commission licence designs and installs, and pays you a commission.' },
      { id: 'install', label: 'Installation and maintenance', capital: 'low to medium', needsTechnician: true, licence: 'install', what: 'You install and service home, shop and office systems. Customers usually buy the equipment through you or directly.' },
      { id: 'design', label: 'System design and project coordination', capital: 'low', needsTechnician: true, licence: 'verify', what: 'You size systems, prepare quotes and coordinate licensed installers and suppliers.' },
      { id: 'retail', label: 'Equipment retail or distribution', capital: 'medium to high', needsTechnician: false, licence: 'sale-import', what: 'You stock and sell panels, inverters and batteries; importing them yourself is a separately licensed activity.' },
      { id: 'assembly', label: 'Assembly or manufacturing of solar products', capital: 'high', needsTechnician: true, licence: 'manufacture', what: 'You assemble or manufacture renewable-energy products.' },
      { id: 'power', label: 'Selling electricity (mini-grid or generation)', capital: 'very high', needsTechnician: true, licence: 'power', what: 'You own generation and sell the electricity itself — a different business from installing systems for customers.' },
    ],
    claims: [
      { id: 'licence-required', text: 'Anyone carrying out a commercial renewable-energy activity in Ghana — including installation and maintenance of solar facilities, importation, and distribution or sale — must first obtain a licence from the Energy Commission under the Renewable Energy Act, 2011 (Act 832).', sources: ['ec', 'notice'], appliesTo: ['install', 'design', 'retail', 'assembly', 'power'], tags: ['licence', 'regulation', 'start'], status: 'source-checked' },
      { id: 'offence', text: 'Operating such an activity without the licence is an offence under section 8(4) of Act 832 (a fine of up to 2,000 penalty units, up to five years’ imprisonment, or both).', sources: ['notice'], appliesTo: ['install', 'design', 'retail', 'assembly', 'power'], tags: ['licence', 'risk'], status: 'source-checked' },
      { id: 'licence-types', text: 'The Energy Commission’s licence types include Installation & Maintenance of Renewable Energy Products, Importation of Renewable Energy Products, Manufacturing or Assembling of Renewable Energy Products, Electricity Sales from a renewable source, Mini-Grid Operation and Wholesale Electricity Supply.', sources: ['guide'], appliesTo: ['all'], tags: ['licence', 'options'], status: 'source-checked' },
      { id: 'install-requirements', text: 'An Installation & Maintenance licence application includes proof of business registration with the Office of the Registrar of Companies, a company profile, details of principal officers, local-content plans (L.I. 2354) and professional certificates — for solar PV installation, a Certified Electrical Wiring Professional (CEWP) certificate.', sources: ['guide'], appliesTo: ['install', 'design'], tags: ['licence', 'requirements', 'technician'], status: 'source-checked' },
      { id: 'install-fees', text: 'The June 2023 guideline lists an application fee of GH₵5,000, an initial licence fee of GH₵500 and an annual operating fee of GH₵5,000, for a one-year term.', sources: ['guide'], appliesTo: ['install', 'design'], tags: ['licence', 'cost', 'money'], status: 'check-current' },
      { id: 'no-power-sales', text: 'An installation & maintenance licence does not allow selling electricity from the systems you install; selling power is covered by separate licences (electricity sales, mini-grid or wholesale supply).', sources: ['guide'], appliesTo: ['install', 'power'], tags: ['licence', 'options'], status: 'source-checked' },
      { id: 'registration', text: 'Businesses register with the Office of the Registrar of Companies (Companies Act, 2019, Act 992): a business name (sole proprietorship) is for Ghanaians, while companies limited by shares are open to Ghanaians and foreigners; registration needs a TIN and a Ghana Card (or a passport for foreigners).', sources: ['orc'], appliesTo: ['all'], tags: ['registration', 'start', 'requirements'], status: 'source-checked' },
      { id: 'registration-fees', text: 'A business-name registration was reported at about GH₵100 (2023) to GH₵120 (2026).', sources: ['orc', 'pulse'], appliesTo: ['all'], tags: ['registration', 'cost', 'money'], status: 'check-current' },
      { id: 'tax', text: 'Business principals need a TIN from the Ghana Revenue Authority; VAT registration becomes compulsory above the GRA turnover threshold, and social-security registration is needed once you hire employees.', sources: ['pulse'], appliesTo: ['all'], tags: ['tax', 'registration', 'requirements'], status: 'check-current' },
      { id: 'amendment', text: 'Act 832 has since been amended, notably by the Renewable Energy (Amendment) Act, 2020 (Act 1045).', sources: ['act'], appliesTo: ['all'], tags: ['regulation'], status: 'check-current' },
      { id: 'partner-route', text: 'Working under a company that already holds the Energy Commission licence (as an agent, apprentice or subcontractor) lets you learn and earn before paying your own licence fees; confirm with the Energy Commission whether your specific role itself needs a licence.', sources: ['ec', 'guide'], appliesTo: ['referral', 'design'], tags: ['money', 'start', 'options', 'licence'], status: 'derived' },
    ],
    ask: ['How much money can you put in at the start?', 'Do you (or a partner) hold an electrical qualification such as CEWP?', 'Who would your first customers be — homes, shops, farms or offices?'],
  },
  {
    id: 'kenuxa-preservation', title: 'How KENUXA keeps atoms when nodes fail', kind: 'explanation', version: 1, accessed: '2026-11-03',
    match: { all: [['atom', 'atoms', 'knowledge', 'data', 'segment', 'segments', 'fragments', 'kenuxa'], ['node', 'nodes', 'failure', 'fail', 'fails', 'disappear', 'disappears', 'survive', 'survives', 'recover', 'recovery', 'lost', 'loss', 'die', 'dies', 'offline', 'crash']] },
    sources: { doc: { title: 'KENUXA atomic architecture (docs/ATOMIC-ARCHITECTURE.md)', publisher: 'KENUXA project', url: 'https://github.com/LosharHammond/Kenuxa-Internet/blob/main/docs/ATOMIC-ARCHITECTURE.md' } },
    options: [],
    claims: [
      { id: 'segments', text: 'Atoms are batched into content-addressed segments; a segment is spread over several nodes, so no atom depends on the node that created it.', sources: ['doc'], appliesTo: ['all'], tags: ['survive', 'how', 'storage'], status: 'source-checked' },
      { id: 'rs', text: 'On networks of 6–11 nodes a segment is erasure-coded into 6 fragments on different hosts, any 4 of which rebuild it — so any 2 of those nodes can disappear without losing it.', sources: ['doc'], appliesTo: ['all'], tags: ['survive', 'two', 'loss', 'how'], status: 'source-checked' },
      { id: 'rs-wide', text: 'From 12 nodes, segments use 12 fragments (any 8 rebuild it), tolerating 4 lost nodes at the same 1.5× storage cost.', sources: ['doc'], appliesTo: ['all'], tags: ['survive', 'loss', 'two'], status: 'source-checked' },
      { id: 'replicas', text: 'On smaller networks a segment is kept as up to 3 full copies, so it survives while at least one copy remains.', sources: ['doc'], appliesTo: ['all'], tags: ['survive', 'small', 'two', 'loss'], status: 'source-checked' },
      { id: 'commit', text: 'An atom is only reported COMMITTED after enough fragments or copies are stored; until then it is PENDING_DURABILITY and could be lost with its node.', sources: ['doc'], appliesTo: ['all'], tags: ['commit', 'loss', 'honest'], status: 'source-checked' },
      { id: 'detect', text: 'A node silent for 15 seconds is suspected and after 60 seconds treated as dead; repair then rebuilds the missing fragments from survivors onto other hosts, most-endangered segments first.', sources: ['doc'], appliesTo: ['all'], tags: ['repair', 'two', 'how', 'disappear'], status: 'source-checked' },
      { id: 'beyond', text: 'If more nodes disappear at once than the code tolerates (3 of the 6 fragment holders, say) before repair finishes, that segment cannot be rebuilt and is reported LOST — no finite system can promise survival of every combination of failures.', sources: ['doc'], appliesTo: ['all'], tags: ['two', 'loss', 'limits', 'disappear'], status: 'source-checked' },
      { id: 'metadata', text: 'The index that says where each atom lives is itself replicated on 3 nodes with quorum reads and writes, and is repaired the same way.', sources: ['doc'], appliesTo: ['all'], tags: ['metadata', 'how', 'repair'], status: 'source-checked' },
    ],
    ask: [],
  },
];

const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
export function matchPack(text, { location = null, packId = null } = {}) {
  if (packId) { const p = PACKS.find(x => x.id === packId); if (p) return p; }
  const w = new Set(words(text + ' ' + (location || '')));
  return PACKS.find(p => p.match.all.every(group => group.some(t => w.has(t))) && (!p.match.location || p.match.location.some(l => w.has(l)))) || null;
}

// Load a pack as atoms (idempotent). Claims carry their evidence; options are concepts.
export function loadPack(registry, pack, { node = 'genesis' } = {}) {
  const AT = `${pack.accessed}T00:00:00.000Z`; let added = 0;
  for (const c of pack.claims) {
    const id = `fact:${pack.id}:${c.id}`; if (registry.has(id)) continue;
    registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'sentence', canonical: c.text, language: 'en', normalized: c.text.toLowerCase(), createdAt: AT, originNode: node, schemaVersion: 1, knowledgeVersion: pack.version, validation: c.status === 'source-checked' ? 'verified' : 'provisional', provenance: [{ source: `pack:${pack.id}@${pack.version}` }] },
      linguistic: {}, semantic: { senses: [], claim: c.text, pack: pack.id, tags: c.tags, appliesTo: c.appliesTo, status: c.status }, functional: {}, relational: c.appliesTo.filter(a => a !== 'all').map(a => ({ type: 'REFERS_TO', target: `concept:en:${pack.id}-${a}`, confidence: 1 })),
      epistemic: { evidence: c.sources.map(s => ({ source: pack.sources[s].url, title: pack.sources[s].title, accessed: pack.accessed, reliability: c.status === 'source-checked' ? 0.85 : 0.6 })), verification: c.status === 'source-checked' ? 'verified' : 'unverified', confidence: c.status === 'source-checked' ? 0.85 : c.status === 'derived' ? 0.6 : 0.55, contradictions: [], uncertainty: c.status === 'check-current' ? ['may have changed since ' + pack.accessed] : c.status === 'derived' ? ['KENUXA’s own inference from the cited sources'] : [], lastValidated: AT, limitations: [] } }, { node, reason: 'knowledge-pack' });
    added++;
  }
  for (const o of pack.options) { const id = `concept:en:${pack.id}-${o.id}`; if (registry.has(id)) continue; registry.ensure({ schema: 'kenuxa-atomic-dna/1', identity: { id, type: 'concept', canonical: o.label, language: 'en', normalized: o.label.toLowerCase(), createdAt: AT, originNode: node, schemaVersion: 1, knowledgeVersion: pack.version, validation: 'verified', provenance: [{ source: `pack:${pack.id}@${pack.version}` }] }, linguistic: {}, semantic: { senses: [], label: o.label, capital: o.capital, needsTechnician: o.needsTechnician, licence: o.licence, description: o.what }, functional: {}, relational: [], epistemic: { evidence: [], verification: 'verified', confidence: 0.8, contradictions: [], uncertainty: [], lastValidated: AT, limitations: ['option list is not exhaustive'] } }, { node, reason: 'knowledge-pack' }); added++; }
  return added;
}
