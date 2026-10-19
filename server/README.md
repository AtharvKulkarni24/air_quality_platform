# Server database migrations

The `migrations/` directory is the source of truth for database schema changes.
`src/db/schema.sql` describes the current normalized schema for reference; do not
apply it over an existing database. For a new database, migrations create the schema.

## New database

From the `server` directory, configure `DATABASE_URL` in `.env`, then run:

```sh
npm run migrate:up
```

`node-pg-migrate` records applied migrations in the `pgmigrations` table. It
applies each migration only once. Keep migration files in version control and
do not edit migrations that have already been applied in a shared database;
create a new migration for each subsequent schema change.

Create a migration with:

```sh
npm run migrate:create -- add-measurement-column
```

Apply pending migrations with `npm run migrate:up`. Revert the latest migration
with `npm run migrate:down`.

## Existing database

The initial migration has already been baselined in the existing database.
Migration `20261017180555_add_normalized_air_quality_schema` converts the old
readings table to normalized locations, sensors, and readings while copying
existing readings. It uses text external IDs so simulator IDs such as
`SIM-PUN-01` are supported.

Stop the simulator, validator, and sink before applying schema migrations, then
run `npm run migrate:up`. Start the services only after the migration succeeds.

The sink writes location, sensor, and measurement rows in one transaction. Kafka
offsets are committed after the database transaction, so replayed messages are
safe through the unique `event_id`.

## OpenAQ continuous producer

Set `OPENAQ_API_KEY` in `.env`, then run the continuous ingestion poller from `server`:

```sh
npm run produce:openaq
```

To run a single fetch and exit immediately, run:

```sh
npm run produce:openaq:once
```

### Configuration & Cadence (`.env`):
- `OPENAQ_POLL_INTERVAL_SECONDS`: Polling frequency in seconds (default: `300` / 5 minutes).
- `OPENAQ_REQUEST_DELAY_MS`: Delay between location API requests to prevent HTTP 429 rate limits (default: `150` ms).
- `OPENAQ_STREAM_KEY`: Stream key identifier stored in `ingestion_checkpoints` (default: `pune-region`).
- `OPENAQ_COORDINATES`: Latitude and longitude center point (default: `18.5204,73.8567`).
- `OPENAQ_RADIUS_METERS`: Search radius around coordinates (default: `25000`).
- `OPENAQ_CITY`: Fallback city name (default: `Pune`).

The producer tracks timestamps in PostgreSQL's `ingestion_checkpoints` and an in-memory cache, skipping duplicate readings that have not changed since the last poll.

## Rollbacks and data safety

Back up the database before applying migrations. The normalized-schema migration
copies existing readings forward; its rollback converts readings back to the
legacy format, but refuses if sensor parameters or duplicate timestamps cannot
be represented by the old schema. Always verify the migration and backup before
rolling back.
