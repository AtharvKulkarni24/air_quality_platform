CREATE TABLE IF NOT EXISTS locations (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(30) NOT NULL,
    external_location_id TEXT NOT NULL,
    name TEXT NOT NULL,
    city TEXT,
    state TEXT,
    country_code CHAR(2) DEFAULT 'IN',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    timezone TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, external_location_id)
);

CREATE TABLE IF NOT EXISTS sensors (
    id BIGSERIAL PRIMARY KEY,
    location_id BIGINT NOT NULL REFERENCES locations(id),
    source VARCHAR(30) NOT NULL,
    external_sensor_id TEXT NOT NULL,
    parameter TEXT NOT NULL,
    unit TEXT NOT NULL,
    UNIQUE (source, external_sensor_id)
);

CREATE TABLE IF NOT EXISTS air_quality_readings (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    sensor_id BIGINT NOT NULL REFERENCES sensors(id),
    observed_at TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit TEXT NOT NULL,
    source VARCHAR(30) NOT NULL,
    measurement_type VARCHAR(20) NOT NULL DEFAULT 'observed'
        CHECK (measurement_type IN ('observed', 'forecast')),
    data_mode TEXT NOT NULL DEFAULT 'observed'
        CHECK (data_mode IN ('observed', 'simulated', 'modelled')),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        value > '-Infinity'::float8
        AND value < 'Infinity'::float8
    )
);

CREATE INDEX IF NOT EXISTS idx_readings_sensor_time
ON air_quality_readings (sensor_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_readings_time
ON air_quality_readings (observed_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
    source VARCHAR(30) NOT NULL,
    stream_key TEXT NOT NULL,
    last_success_at TIMESTAMPTZ,
    last_cursor TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, stream_key)
);
