# Domain-general developmental curriculum (experimental)

This milestone adds a **shared learning and evaluation interface** for language relations, object properties, causal transitions, action outcomes, social relations, sequences, spatial relations, and numeric relations. It is not a set of eight independently capable reasoning engines. All domains currently use the same structured subject/relation/object observation mechanism.

## How it works

- `Mind.curriculumRecord(experience)` accepts a bounded structured relation with a domain and explicit train/evaluation split.
- `Mind.curriculumPredict(query)` retrieves a unique relation from training evidence only; contradictions return unknown.
- `Mind.curriculumEvaluate(domain)` scores held-out examples without learning from them.
- `Mind.curriculumNextLesson()` ranks domain coverage gaps and low measured accuracy.
- State is attached to `Mind.S.developmentalCurriculum`; persistence beyond a Mind instance depends on the existing node state-saving lifecycle.
- No external model, GPU, teacher service, background job, or HTTP exposure.

## Important limitations

This milestone is a **curriculum scaffold**, not general intelligence. The domain labels provide coverage categories, not demonstrated competence in natural language, social reasoning, causal inference, or spatial reasoning. Predictions currently retrieve exact subject/relation matches; the learner cannot yet transfer arbitrary relations to novel entities. Held-out examples sharing exact triples with training are rejected, but semantic leakage and authenticity of evidence are not yet controlled. The scheduler **recommends** the next domain; it does not independently invent experiments. Before enabling autonomous learning, build trusted domain-specific environments, new-entity transfer tests, richer representations, and controlled budgets.

Run `node --test tests/developmental-curriculum.test.mjs` and the full repository suite. Tests have not been executed by the GitHub connector.
