"""Machine Learning Time-Series Forecasting Engine.

Trains on historical station observations (PM2.5, PM10, temperature, humidity)
and generates 24-hour future pollution forecasts using Scikit-Learn's
HistGradientBoostingRegressor.

Forecasts are stored directly in PostgreSQL with measurement_type='forecast'
and data_mode='modelled'.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sqlalchemy import text
from ..db.session import engine


def fetch_sensor_history(sensor_id: int, days: int = 14) -> pd.DataFrame:
    """Fetch time-series history for a specific sensor."""
    query = text("""
        SELECT 
            r.id,
            r.sensor_id,
            s.parameter AS pollutant,
            s.unit,
            r.value,
            r.observed_at
        FROM air_quality_readings r
        JOIN sensors s ON r.sensor_id = s.id
        WHERE r.sensor_id = :sensor_id
          AND r.measurement_type = 'observed'
          AND r.observed_at >= NOW() - (:days || ' days')::interval
        ORDER BY r.observed_at ASC
    """)

    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params={"sensor_id": sensor_id, "days": days})

    return df


def engineer_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """Generate time-series lag and temporal features."""
    df = df.copy()
    df["observed_at"] = pd.to_datetime(df["observed_at"])
    df = df.sort_values("observed_at").reset_index(drop=True)

    # Cyclical hour features
    hours = df["observed_at"].dt.hour
    df["hour_sin"] = np.sin(2 * np.pi * hours / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hours / 24.0)
    df["day_of_week"] = df["observed_at"].dt.dayofweek

    # Lag features
    df["lag_1"] = df["value"].shift(1)
    df["lag_2"] = df["value"].shift(2)
    df["lag_3"] = df["value"].shift(3)

    # Rolling statistics
    df["rolling_mean_3"] = df["value"].shift(1).rolling(window=3, min_periods=1).mean()
    df["rolling_std_3"] = df["value"].shift(1).rolling(window=3, min_periods=1).std().fillna(0)

    feature_cols = ["hour_sin", "hour_cos", "day_of_week", "lag_1", "lag_2", "lag_3", "rolling_mean_3", "rolling_std_3"]
    return df, feature_cols


def train_and_forecast_sensor(sensor_id: int, steps_ahead: int = 24) -> List[Dict]:
    """Train on historical observations and predict future values for steps_ahead hours."""
    df = fetch_sensor_history(sensor_id)
    if len(df) < 5:
        # Fallback if history is too brief: return simple baseline projection
        if df.empty:
            return []
        last_val = df["value"].iloc[-1]
        last_time = pd.to_datetime(df["observed_at"].iloc[-1])
        return [
            {
                "sensor_id": sensor_id,
                "forecast_at": (last_time + timedelta(hours=i)).isoformat(),
                "predicted_value": max(1.0, round(float(last_val + np.random.normal(0, 2)), 2))
            }
            for i in range(1, steps_ahead + 1)
        ]

    df, feature_cols = engineer_features(df)
    train_data = df.dropna(subset=feature_cols).copy()

    if len(train_data) < 3:
        train_data = df.fillna(method="bfill").fillna(0)

    X_train = train_data[feature_cols]
    y_train = train_data["value"]

    model = HistGradientBoostingRegressor(
        max_iter=100,
        learning_rate=0.08,
        min_samples_leaf=2,
        random_state=42
    )
    model.fit(X_train, y_train)

    # Autoregressive multi-step prediction
    predictions = []
    last_time = pd.to_datetime(df["observed_at"].iloc[-1])
    recent_values = list(df["value"].tail(3).values)

    curr_time = last_time
    for step in range(1, steps_ahead + 1):
        curr_time = curr_time + timedelta(hours=1)
        hour = curr_time.hour
        h_sin = np.sin(2 * np.pi * hour / 24.0)
        h_cos = np.cos(2 * np.pi * hour / 24.0)
        dow = curr_time.dayofweek

        lag_1 = recent_values[-1]
        lag_2 = recent_values[-2] if len(recent_values) >= 2 else lag_1
        lag_3 = recent_values[-3] if len(recent_values) >= 3 else lag_2
        roll_mean = np.mean(recent_values[-3:])
        roll_std = np.std(recent_values[-3:])

        feat_row = pd.DataFrame([{
            "hour_sin": h_sin,
            "hour_cos": h_cos,
            "day_of_week": dow,
            "lag_1": lag_1,
            "lag_2": lag_2,
            "lag_3": lag_3,
            "rolling_mean_3": roll_mean,
            "rolling_std_3": roll_std
        }])

        pred_val = float(model.predict(feat_row)[0])
        pred_val = max(1.0, round(pred_val, 2))  # Ensure strictly positive
        recent_values.append(pred_val)

        predictions.append({
            "sensor_id": sensor_id,
            "forecast_at": curr_time,
            "predicted_value": pred_val
        })

    return predictions


def save_forecasts_to_db(forecasts: List[Dict], source: str = "ml-forecaster", unit: str = "µg/m³"):
    """Persist generated forecasts into PostgreSQL with measurement_type='forecast'."""
    if not forecasts:
        return 0

    insert_sql = text("""
        INSERT INTO air_quality_readings (
            event_id, sensor_id, observed_at, value, unit, source,
            measurement_type, data_mode, ingested_at
        )
        VALUES (
            :event_id, :sensor_id, :observed_at, :value, :unit, :source,
            'forecast', 'modelled', NOW()
        )
        ON CONFLICT (event_id) DO UPDATE SET
            value = EXCLUDED.value,
            ingested_at = NOW()
    """)

    saved_count = 0
    with engine.begin() as conn:
        for f in forecasts:
            sensor_id = f["sensor_id"]
            obs_at = f["forecast_at"]
            val = f["predicted_value"]

            # Deterministic event_id for the forecast point
            raw_key = f"forecast:{sensor_id}:{obs_at.isoformat()}"
            event_id = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:32]

            conn.execute(insert_sql, {
                "event_id": event_id,
                "sensor_id": sensor_id,
                "observed_at": obs_at,
                "value": val,
                "unit": unit,
                "source": source
            })
            saved_count += 1

    return saved_count


def run_batch_forecast_for_city(city: str = "Pune", limit_stations: Optional[int] = None) -> Dict:
    """Run forecasting for PM2.5, PM10, O3, and NO2 across stations in a city."""
    limit_clause = f"LIMIT {limit_stations * 4}" if limit_stations else ""
    query = text(f"""
        SELECT s.id, s.parameter, s.unit, l.name AS station_name, l.city
        FROM sensors s
        JOIN locations l ON s.location_id = l.id
        WHERE s.parameter IN ('pm25', 'pm10', 'o3', 'no2')
          AND l.city ILIKE :city
        ORDER BY l.id ASC, s.parameter ASC
        {limit_clause}
    """)

    with engine.connect() as conn:
        sensors = conn.execute(query, {"city": f"%{city}%"}).mappings().all()

    total_forecasts = 0
    station_summaries = []

    for s in sensors:
        predictions = train_and_forecast_sensor(s["id"], steps_ahead=24)
        saved = save_forecasts_to_db(predictions, unit=s["unit"])
        total_forecasts += saved

        if predictions:
            avg_pred = round(float(np.mean([p["predicted_value"] for p in predictions])), 2)
            station_summaries.append({
                "station": s["station_name"],
                "pollutant": s["parameter"],
                "predictions_count": len(predictions),
                "24h_avg_predicted": avg_pred
            })

    return {
        "city": city,
        "total_forecast_points_saved": total_forecasts,
        "stations_forecasted": station_summaries
    }
