/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE air_quality_readings
      RENAME TO air_quality_readings_legacy;

    CREATE TABLE locations (
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

    INSERT INTO locations (
      source, external_location_id, name, city, state, country_code
    )
    SELECT DISTINCT ON (source, location_id)
      source, location_id, location_name, city, state, country_code
    FROM air_quality_readings_legacy
    ORDER BY source, location_id, observed_at DESC;

    CREATE TABLE sensors (
      id BIGSERIAL PRIMARY KEY,
      location_id BIGINT NOT NULL REFERENCES locations(id),
      source VARCHAR(30) NOT NULL,
      external_sensor_id TEXT NOT NULL,
      parameter TEXT NOT NULL,
      unit TEXT NOT NULL,
      UNIQUE (source, external_sensor_id)
    );

    INSERT INTO sensors (
      location_id, source, external_sensor_id, parameter, unit
    )
    SELECT DISTINCT ON (legacy.source, legacy.location_id, legacy.pollutant)
      locations.id,
      legacy.source,
      legacy.location_id || ':' || legacy.pollutant,
      legacy.pollutant,
      legacy.unit
    FROM air_quality_readings_legacy AS legacy
    JOIN locations
      ON locations.source = legacy.source
      AND locations.external_location_id = legacy.location_id
    ORDER BY
      legacy.source,
      legacy.location_id,
      legacy.pollutant,
      legacy.observed_at DESC;

    CREATE TABLE air_quality_readings (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      sensor_id BIGINT NOT NULL REFERENCES sensors(id),
      observed_at TIMESTAMPTZ NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      unit TEXT NOT NULL,
      source VARCHAR(30) NOT NULL,
      measurement_type VARCHAR(20) NOT NULL DEFAULT 'observed',
      data_mode TEXT NOT NULL DEFAULT 'observed',
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (measurement_type IN ('observed', 'forecast')),
      CHECK (data_mode IN ('observed', 'simulated', 'modelled')),
      CHECK (
        value > '-Infinity'::float8
        AND value < 'Infinity'::float8
      )
    );

    CREATE INDEX idx_readings_sensor_time
      ON air_quality_readings (sensor_id, observed_at DESC);

    CREATE INDEX idx_readings_time
      ON air_quality_readings (observed_at DESC);

    INSERT INTO air_quality_readings (
      event_id, sensor_id, observed_at, value, unit, source,
      measurement_type, data_mode, ingested_at
    )
    SELECT
      legacy.event_id,
      sensors.id,
      legacy.observed_at,
      legacy.value,
      legacy.unit,
      legacy.source,
      'observed',
      legacy.data_mode,
      legacy.ingested_at
    FROM air_quality_readings_legacy AS legacy
    JOIN sensors
      ON sensors.source = legacy.source
      AND sensors.external_sensor_id =
        legacy.location_id || ':' || legacy.pollutant;

    DROP TABLE air_quality_readings_legacy;

    CREATE TABLE ingestion_checkpoints (
      source VARCHAR(30) NOT NULL,
      stream_key TEXT NOT NULL,
      last_success_at TIMESTAMPTZ,
      last_cursor TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      error_message TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source, stream_key)
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM sensors
        WHERE parameter NOT IN ('pm25', 'pm10')
      ) THEN
        RAISE EXCEPTION
          'Cannot revert: sensor parameters outside pm25/pm10 cannot be represented by the legacy schema';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM air_quality_readings AS readings
        JOIN sensors ON sensors.id = readings.sensor_id
        JOIN locations ON locations.id = sensors.location_id
        GROUP BY
          locations.external_location_id,
          sensors.parameter,
          readings.observed_at
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION
          'Cannot revert: readings conflict with the legacy location/pollutant/timestamp uniqueness constraint';
      END IF;
    END;
    $$;

    CREATE TABLE air_quality_readings_legacy (
      event_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      location_id TEXT NOT NULL,
      location_name TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT,
      country_code CHAR(2) NOT NULL,
      pollutant TEXT NOT NULL
        CHECK (pollutant IN ('pm25', 'pm10')),
      value DOUBLE PRECISION NOT NULL
        CHECK (value >= 0),
      unit TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data_mode TEXT NOT NULL
        CHECK (data_mode IN ('observed', 'simulated', 'modelled')),
      CONSTRAINT uq_location_pollutant_time
        UNIQUE (location_id, pollutant, observed_at)
    );

    INSERT INTO air_quality_readings_legacy (
      event_id, source, location_id, location_name, city, state,
      country_code, pollutant, value, unit, observed_at, ingested_at,
      data_mode
    )
    SELECT
      readings.event_id,
      readings.source,
      locations.external_location_id,
      locations.name,
      COALESCE(locations.city, ''),
      locations.state,
      COALESCE(locations.country_code, 'IN'),
      sensors.parameter,
      readings.value,
      readings.unit,
      readings.observed_at,
      readings.ingested_at,
      CASE
        WHEN readings.measurement_type = 'forecast' THEN 'modelled'
        ELSE readings.data_mode
      END
    FROM air_quality_readings AS readings
    JOIN sensors ON sensors.id = readings.sensor_id
    JOIN locations ON locations.id = sensors.location_id;

    DROP TABLE ingestion_checkpoints;
    DROP TABLE air_quality_readings;
    DROP TABLE sensors;
    DROP TABLE locations;

    ALTER TABLE air_quality_readings_legacy
      RENAME TO air_quality_readings;

    CREATE INDEX idx_air_quality_city_time
      ON air_quality_readings (city, pollutant, observed_at DESC);
  `);
};
