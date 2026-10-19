"""Sensor Anomaly Detection Engine.

Detects common environmental sensor failures and unusual spikes:
1. Flatline / Freeze: Sensor reporting identical floating-point values repeatedly.
2. Statistical Spikes: Outliers exceeding 3.5 standard deviations (|Z| > 3.5).
3. Physical Bounds: Readings defying physical atmosphere limits.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional
import pandas as pd
import numpy as np
from sqlalchemy import text
from ..db.session import engine


@dataclass
class AnomalyAlert:
    sensor_id: int
    external_sensor_id: str
    station_name: str
    pollutant: str
    anomaly_type: str  # 'SPIKE', 'FLATLINE', 'OUT_OF_BOUNDS'
    severity: str      # 'CRITICAL', 'WARNING'
    value: float
    expected_range: str
    timestamp: datetime
    message: str


def detect_sensor_anomalies(hours: int = 48) -> List[AnomalyAlert]:
    """Analyze the last N hours of sensor history to detect anomalies across all stations."""
    query = text("""
        SELECT 
            s.id AS sensor_id,
            s.external_sensor_id,
            l.name AS station_name,
            s.parameter AS pollutant,
            r.value,
            r.unit,
            r.observed_at
        FROM air_quality_readings r
        JOIN sensors s ON r.sensor_id = s.id
        JOIN locations l ON s.location_id = l.id
        WHERE r.observed_at >= NOW() - (:hours || ' hours')::interval
          AND r.measurement_type = 'observed'
        ORDER BY s.id, r.observed_at ASC
    """)

    with engine.connect() as conn:
        df = pd.read_sql(query, conn, params={"hours": hours})

    if df.empty:
        return []

    alerts: List[AnomalyAlert] = []

    # Group by sensor and evaluate time-series
    for sensor_id, group in df.groupby("sensor_id"):
        if len(group) < 3:
            continue

        group = group.sort_values("observed_at").reset_index(drop=True)
        values = group["value"].values
        pollutant = group["pollutant"].iloc[0]
        station_name = group["station_name"].iloc[0]
        ext_id = group["external_sensor_id"].iloc[0]
        latest_row = group.iloc[-1]
        latest_val = latest_row["value"]
        latest_time = latest_row["observed_at"]

        # 1. Flatline Check: Last 5 consecutive values identical
        if len(values) >= 5:
            last_5 = values[-5:]
            if np.all(last_5 == last_5[0]) and last_5[0] > 0:
                alerts.append(AnomalyAlert(
                    sensor_id=sensor_id,
                    external_sensor_id=ext_id,
                    station_name=station_name,
                    pollutant=pollutant,
                    anomaly_type="FLATLINE",
                    severity="WARNING",
                    value=latest_val,
                    expected_range="Varying natural atmospheric measurements",
                    timestamp=latest_time,
                    message=f"Sensor reported identical value {latest_val} for 5 consecutive readings."
                ))

        # 2. Statistical Spike Check: Rolling Z-score against history
        if len(values) >= 5:
            mean = np.mean(values[:-1])
            std = np.std(values[:-1])

            if std > 0:
                z_score = (latest_val - mean) / std
                if abs(z_score) > 3.5:
                    severity = "CRITICAL" if abs(z_score) > 5.0 else "WARNING"
                    alerts.append(AnomalyAlert(
                        sensor_id=sensor_id,
                        external_sensor_id=ext_id,
                        station_name=station_name,
                        pollutant=pollutant,
                        anomaly_type="SPIKE",
                        severity=severity,
                        value=latest_val,
                        expected_range=f"[{max(0, mean - 2*std):.1f} - {mean + 2*std:.1f}]",
                        timestamp=latest_time,
                        message=f"Unusual spike of {latest_val} (|Z| = {abs(z_score):.1f}, mean = {mean:.1f}, std = {std:.1f})."
                    ))

        # 3. Extreme Physical Boundary Check
        extreme_limits = {
            "pm25": 1200.0,
            "pm10": 2000.0,
            "o3": 800.0,
            "no2": 600.0,
            "temperature": 55.0
        }
        if pollutant in extreme_limits and latest_val > extreme_limits[pollutant]:
            alerts.append(AnomalyAlert(
                sensor_id=sensor_id,
                external_sensor_id=ext_id,
                station_name=station_name,
                pollutant=pollutant,
                anomaly_type="OUT_OF_BOUNDS",
                severity="CRITICAL",
                value=latest_val,
                expected_range=f"<= {extreme_limits[pollutant]}",
                timestamp=latest_time,
                message=f"Value {latest_val} exceeds realistic atmospheric physical limit of {extreme_limits[pollutant]}."
            ))

    return alerts
