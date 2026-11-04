# Native-format atoms and evidence quarantine

KENUXA atoms are **not restricted to words**. The new `NativeAtomMemory` supports bounded machine-native structured payloads in graph, vector, binary-envelope, event, relation, procedure, perception, symbol and structured formats. It is attached to `Mind.S.nativeAtoms` and survives reconstruction when the parent state persists.

**Untrusted chat is not knowledge.** A candidate created from chat remains quarantined and is not available from normal validated lookup. This is a first step toward safely learning from conversations: collecting *proposals*, not asserting that everything said is true.

**Security limitation:** the current `verify()` API checks the format of verifier identifiers and requires two different names, but does **not authenticate those identities or verify evidence cryptographically**. Therefore it must remain an internal research interface and MUST NOT be exposed to HTTP, chat users, untrusted plugins or volunteer nodes. No automatic chat ingestion or production promotion is enabled. Real promotion requires server-side trusted evidence verification, independent sources, owner-approved policies and regression testing.

**Not achieved:** unrestricted atom types, representation discovery, autonomous reliable verification of arbitrary facts, automatic chat learning, or general understanding across all domains. The supported formats are extensible in code, but the format registry is not yet a dynamically learned schema. A bounded JSON payload is not itself a learned meaning.

Run `node --test tests/native-atoms.test.mjs`. Existing CI coverage and Render compatibility must be verified before deployment.
