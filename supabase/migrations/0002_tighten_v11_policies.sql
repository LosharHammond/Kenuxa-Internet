-- OPTIONAL but recommended. The original v1.1 schema created "public_write_*" policies with
-- USING (true), which lets ANYONE holding the project's public anon key insert, change or delete
-- graph rows. KENUXA nodes use the server-side service-role/secret key, which bypasses RLS, so
-- removing public writes does not affect them. Public reads are kept.
drop policy if exists "public_write_entities"     on entities;
drop policy if exists "public_write_rels"         on relationships;
drop policy if exists "public_write_attachments"  on attachments;
drop policy if exists "public_write_capabilities" on capabilities;
drop policy if exists "public_write_embeddings"   on embeddings;
drop policy if exists "public_write_resolutions"  on resolutions;
