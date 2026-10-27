-- Runs once, when the PostgreSQL volume is created.
-- bfk_dev is created by POSTGRES_DB; add the test database and the
-- btree_gist extension (subscriptions non-overlap constraint, Phase 2).
CREATE DATABASE bfk_test OWNER bfk;
\connect bfk_dev
CREATE EXTENSION IF NOT EXISTS btree_gist;
\connect bfk_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
