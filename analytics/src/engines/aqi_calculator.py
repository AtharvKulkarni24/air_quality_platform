"""Air Quality Index (AQI) Calculation Engine.

Implements the official Indian National Air Quality Index (CPCB) standards
with support for US EPA standards and automatic unit conversions
(e.g., ppb to µg/m³ and µg/m³ to mg/m³).
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class AQICategory:
    name: str
    min_score: int
    max_score: int
    color: str
    health_advisory: str


CPCB_CATEGORIES = [
    AQICategory("Good", 0, 50, "#00E400", "Air quality is good. Minimal health impact."),
    AQICategory("Satisfactory", 51, 100, "#92D050", "Minor breathing discomfort to sensitive people."),
    AQICategory("Moderate", 101, 200, "#FFFF00", "Breathing discomfort for people with asthma and heart conditions."),
    AQICategory("Poor", 201, 300, "#FF7E00", "Breathing discomfort to most people on prolonged exposure."),
    AQICategory("Very Poor", 301, 400, "#FF0000", "Respiratory illness on prolonged exposure."),
    AQICategory("Severe", 401, 500, "#7E0023", "Affects healthy people and seriously impacts those with existing diseases."),
]

# Breakpoints: (B_lo, B_hi, I_lo, I_hi)
# Values for PM2.5, PM10, NO2, SO2, O3 are in µg/m³; CO is in mg/m³.
CPCB_BREAKPOINTS: Dict[str, List[Tuple[float, float, int, int]]] = {
    "pm25": [
        (0.0, 30.0, 0, 50),
        (31.0, 60.0, 51, 100),
        (61.0, 90.0, 101, 200),
        (91.0, 120.0, 201, 300),
        (121.0, 250.0, 301, 400),
        (251.0, 500.0, 401, 500),
    ],
    "pm10": [
        (0.0, 50.0, 0, 50),
        (51.0, 100.0, 51, 100),
        (101.0, 250.0, 101, 200),
        (251.0, 350.0, 201, 300),
        (351.0, 430.0, 301, 400),
        (431.0, 600.0, 401, 500),
    ],
    "no2": [
        (0.0, 40.0, 0, 50),
        (41.0, 80.0, 51, 100),
        (81.0, 180.0, 101, 200),
        (181.0, 280.0, 201, 300),
        (281.0, 400.0, 301, 400),
        (401.0, 500.0, 401, 500),
    ],
    "so2": [
        (0.0, 40.0, 0, 50),
        (41.0, 80.0, 51, 100),
        (81.0, 380.0, 101, 200),
        (381.0, 800.0, 201, 300),
        (801.0, 1600.0, 301, 400),
        (1601.0, 2000.0, 401, 500),
    ],
    "co": [
        (0.0, 1.0, 0, 50),
        (1.1, 2.0, 51, 100),
        (2.1, 10.0, 101, 200),
        (10.1, 17.0, 201, 300),
        (17.1, 34.0, 301, 400),
        (34.1, 50.0, 401, 500),
    ],
    "o3": [
        (0.0, 50.0, 0, 50),
        (51.0, 100.0, 51, 100),
        (101.0, 168.0, 101, 200),
        (169.0, 208.0, 201, 300),
        (209.0, 748.0, 301, 400),
        (749.0, 1000.0, 401, 500),
    ],
}


def normalize_pollutant_unit(pollutant: str, value: float, unit: str) -> Tuple[float, str]:
    """Convert input pollutant units to standard AQI reference units.
    
    Standard target units:
    - PM2.5, PM10, NO2, SO2, O3 -> µg/m³
    - CO -> mg/m³
    """
    clean_unit = unit.strip().lower()
    pollutant = pollutant.strip().lower()

    if pollutant in ("pm25", "pm10", "bc"):
        return value, "µg/m³"

    # Conversion factors at STP (25 °C, 1 atm)
    if pollutant == "no2":
        if clean_unit == "ppb":
            return value * 1.88, "µg/m³"
        if clean_unit == "ppm":
            return value * 1880.0, "µg/m³"
        return value, "µg/m³"

    if pollutant == "so2":
        if clean_unit == "ppb":
            return value * 2.62, "µg/m³"
        if clean_unit == "ppm":
            return value * 2620.0, "µg/m³"
        return value, "µg/m³"

    if pollutant == "o3":
        if clean_unit == "ppb":
            return value * 1.96, "µg/m³"
        if clean_unit == "ppm":
            return value * 1960.0, "µg/m³"
        return value, "µg/m³"

    if pollutant == "co":
        if clean_unit in ("µg/m³", "ug/m3"):
            return value / 1000.0, "mg/m³"
        if clean_unit == "ppb":
            return (value * 1.15) / 1000.0, "mg/m³"
        if clean_unit == "ppm":
            return value * 1.15, "mg/m³"
        return value, "mg/m³"

    return value, unit


def calculate_sub_index(pollutant: str, concentration: float, unit: str = "µg/m³") -> Optional[int]:
    """Calculate the individual pollutant sub-index using piece-wise linear interpolation.

    Formula:
        I_p = [ (I_hi - I_lo) / (B_hi - B_lo) ] * (C_p - B_lo) + I_lo
    """
    norm_val, _ = normalize_pollutant_unit(pollutant, concentration, unit)
    pollutant_key = pollutant.lower().strip()

    if pollutant_key not in CPCB_BREAKPOINTS:
        return None

    if norm_val < 0:
        return None

    breakpoints = CPCB_BREAKPOINTS[pollutant_key]

    for b_lo, b_hi, i_lo, i_hi in breakpoints:
        if b_lo <= norm_val <= b_hi:
            sub_index = ((i_hi - i_lo) / (b_hi - b_lo)) * (norm_val - b_lo) + i_lo
            return int(round(sub_index))

    # If concentration exceeds the highest breakpoint, cap at 500 (Severe)
    max_b = breakpoints[-1]
    if norm_val > max_b[1]:
        return 500

    return None


def get_aqi_category(aqi: int) -> AQICategory:
    """Return the CPCB health category, color, and advisory for a given AQI score."""
    for category in CPCB_CATEGORIES:
        if category.min_score <= aqi <= category.max_score:
            return category
    if aqi > 500:
        return CPCB_CATEGORIES[-1]
    return CPCB_CATEGORIES[0]


@dataclass
class StationAQIResult:
    station_id: int
    station_name: str
    city: str
    overall_aqi: int
    dominant_pollutant: str
    category: str
    color: str
    health_advisory: str
    sub_indices: Dict[str, int]
    raw_pollutants: Dict[str, Dict[str, any]]


def compute_station_aqi(
    station_id: int,
    station_name: str,
    city: str,
    readings: List[Dict[str, any]]
) -> Optional[StationAQIResult]:
    """Compute overall AQI for a station from its list of current pollutant readings.
    
    Each item in `readings` should have:
    - 'pollutant': str (e.g., 'pm25', 'pm10', 'no2')
    - 'value': float
    - 'unit': str (e.g., 'µg/m³', 'ppb')
    """
    sub_indices: Dict[str, int] = {}
    raw_pollutants: Dict[str, Dict[str, any]] = {}

    for r in readings:
        p = r.get("pollutant", "").lower().strip()
        val = r.get("value")
        unit = r.get("unit", "µg/m³")

        if val is None or p not in CPCB_BREAKPOINTS:
            continue

        raw_pollutants[p] = {"value": val, "unit": unit}
        sub_idx = calculate_sub_index(p, val, unit)
        if sub_idx is not None:
            sub_indices[p] = sub_idx

    if not sub_indices:
        return None

    # CPCB rule: Overall AQI is the maximum of the individual sub-indices
    dominant_pollutant = max(sub_indices, key=sub_indices.get)
    overall_aqi = sub_indices[dominant_pollutant]
    category = get_aqi_category(overall_aqi)

    return StationAQIResult(
        station_id=station_id,
        station_name=station_name,
        city=city,
        overall_aqi=overall_aqi,
        dominant_pollutant=dominant_pollutant,
        category=category.name,
        color=category.color,
        health_advisory=category.health_advisory,
        sub_indices=sub_indices,
        raw_pollutants=raw_pollutants,
    )
