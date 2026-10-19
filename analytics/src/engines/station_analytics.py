"""Station Analytics Module.

Pulls latest sensor readings from PostgreSQL and calculates station-level
and city-level AQI using the aqi_calculator engine.
"""
from typing import Dict, List, Optional
from sqlalchemy import text
from ..db.session import engine
from .aqi_calculator import compute_station_aqi, StationAQIResult, get_aqi_category


def fetch_latest_station_readings(city: Optional[str] = None) -> List[Dict]:
    """Fetch the latest observed reading for each sensor from PostgreSQL.
    
    Uses DISTINCT ON to ensure only the single newest reading per sensor is retrieved.
    """
    city_filter = "AND l.city ILIKE :city" if city else ""
    query = text(f"""
        SELECT DISTINCT ON (s.id)
            l.id AS station_id,
            l.name AS station_name,
            l.city,
            l.latitude,
            l.longitude,
            s.id AS sensor_id,
            s.parameter AS pollutant,
            s.unit,
            r.value,
            r.observed_at
        FROM locations l
        JOIN sensors s ON s.location_id = l.id
        JOIN air_quality_readings r ON r.sensor_id = s.id
        WHERE r.measurement_type = 'observed'
          {city_filter}
        ORDER BY s.id, r.observed_at DESC
    """)

    params = {"city": f"%{city}%"} if city else {}

    with engine.connect() as conn:
        rows = conn.execute(query, params).mappings().all()

    # Group readings by station
    stations_map: Dict[int, Dict] = {}
    for row in rows:
        st_id = row["station_id"]
        if st_id not in stations_map:
            stations_map[st_id] = {
                "station_id": st_id,
                "station_name": row["station_name"],
                "city": row["city"] or "Unknown",
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "readings": [],
                "latest_observed_at": row["observed_at"]
            }

        stations_map[st_id]["readings"].append({
            "pollutant": row["pollutant"],
            "value": row["value"],
            "unit": row["unit"]
        })

    return list(stations_map.values())


def get_all_stations_aqi(city: Optional[str] = None) -> List[StationAQIResult]:
    """Calculate the AQI for all active stations."""
    stations = fetch_latest_station_readings(city=city)
    results: List[StationAQIResult] = []

    for st in stations:
        aqi_res = compute_station_aqi(
            station_id=st["station_id"],
            station_name=st["station_name"],
            city=st["city"],
            readings=st["readings"]
        )
        if aqi_res:
            results.append(aqi_res)

    # Sort stations by AQI descending (highest pollution first)
    results.sort(key=lambda x: x.overall_aqi, reverse=True)
    return results


def get_city_summary_aqi(city: str = "Pune") -> Dict:
    """Calculate the overall city-wide AQI summary."""
    stations_aqi = get_all_stations_aqi(city=city)
    if not stations_aqi:
        return {"city": city, "status": "No active stations found"}

    aqi_values = [s.overall_aqi for s in stations_aqi]
    avg_aqi = int(round(sum(aqi_values) / len(aqi_values)))
    max_aqi = max(aqi_values)
    cat = get_aqi_category(avg_aqi)

    # Count occurrences of dominant pollutants
    dominant_counts: Dict[str, int] = {}
    for s in stations_aqi:
        dominant_counts[s.dominant_pollutant] = dominant_counts.get(s.dominant_pollutant, 0) + 1
    primary_dominant = max(dominant_counts, key=dominant_counts.get)

    return {
        "city": city,
        "stations_count": len(stations_aqi),
        "city_avg_aqi": avg_aqi,
        "city_max_aqi": max_aqi,
        "category": cat.name,
        "color": cat.color,
        "health_advisory": cat.health_advisory,
        "primary_dominant_pollutant": primary_dominant,
        "stations": [
            {
                "id": s.station_id,
                "name": s.station_name,
                "aqi": s.overall_aqi,
                "category": s.category,
                "color": s.color,
                "dominant_pollutant": s.dominant_pollutant,
                "sub_indices": s.sub_indices
            }
            for s in stations_aqi
        ]
    }
