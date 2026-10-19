export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE air_quality_readings (
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

    CREATE INDEX idx_air_quality_city_time
      ON air_quality_readings (city, pollutant, observed_at DESC);
  `);
};

export const down = (pgm) => {
  pgm.sql("DROP TABLE air_quality_readings;");
};
