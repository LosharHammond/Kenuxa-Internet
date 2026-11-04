# Cross-domain concept discovery (experimental)

This module compares **structured training relations** across different curriculum domains. When at least three distinct subject/object pairs align completely between two relations, it records an **alignment hypothesis**. It can attempt a cross-domain inference using the aligned relation, and evaluate that inference on separate withheld examples.

The mechanism is not limited to mathematics. It operates on symbolic subject/relation/object structures, regardless of domain labels. It uses no pretrained model or GPU.

## Boundaries

An alignment is a **hypothesis**, not proof of identical meaning. Shared pairs can be coincidental or reflect biased data. The current implementation deliberately requires exact matching entity IDs and complete agreement; it does not discover synonyms, analogies, language semantics, or causal mechanisms on its own. The inference method does not train on evaluation examples. To establish real cross-domain transfer, tests must include unseen entities and relations, adversarial confounds, and independent ground-truth checks.

`Mind.discoverCrossDomainConcepts()`, `Mind.inferCrossDomainRelation(query)`, and `Mind.evaluateCrossDomainTransfer(query)` expose the experimental module without publishing it as a chat-answering method.

Run `node --test tests/concept-discovery.test.mjs`. Tests were authored but not executed through the GitHub connector.
