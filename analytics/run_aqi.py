"""CLI Runner to compute and display live AQI across all stations."""
import sys

# Configure UTF-8 for Windows consoles if needed
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from src.engines.station_analytics import get_all_stations_aqi, get_city_summary_aqi


def main():
    print("=" * 80)
    print("        AIR QUALITY INDEX (AQI) - REAL-TIME ANALYTICS ENGINE        ")
    print("        Standard: Indian National AQI (CPCB) Guidelines             ")
    print("=" * 80)
    print()

    # 1. City Summary for Pune
    pune_summary = get_city_summary_aqi("Pune")
    print("[CITY SUMMARY] PUNE OVERALL AQI:")
    print(f"   * Active Stations   : {pune_summary.get('stations_count', 0)}")
    print(f"   * Average City AQI  : {pune_summary.get('city_avg_aqi', 'N/A')}")
    print(f"   * Peak Station AQI  : {pune_summary.get('city_max_aqi', 'N/A')}")
    print(f"   * Health Category   : {pune_summary.get('category', 'N/A')}")
    print(f"   * Dominant Cause    : {pune_summary.get('primary_dominant_pollutant', 'N/A').upper()}")
    print(f"   * Health Advisory   : {pune_summary.get('health_advisory', 'N/A')}\n")

    # 2. Individual Station Breakdown
    stations = get_all_stations_aqi()
    print("-" * 80)
    print(f"{'Station Name':<42} | {'City':<8} | {'AQI':<5} | {'Category':<12} | {'Dominant':<8}")
    print("-" * 80)

    for st in stations:
        name = st.station_name[:40]
        print(f"{name:<42} | {st.city:<8} | {st.overall_aqi:<5} | {st.category:<12} | {st.dominant_pollutant.upper():<8}")

    print("-" * 80)
    print("\n[DETAILED BREAKDOWN] Sub-Indices for Top 3 Stations:")
    for st in stations[:3]:
        print(f"\n>> {st.station_name} ({st.city}) - Overall AQI: {st.overall_aqi} [{st.category}]")
        for pollutant, sub_idx in st.sub_indices.items():
            raw = st.raw_pollutants.get(pollutant, {})
            val = raw.get("value", "N/A")
            unit = raw.get("unit", "")
            is_dom = " <-- [DOMINANT POLLUTANT]" if pollutant == st.dominant_pollutant else ""
            print(f"   * {pollutant.upper():<6}: Sub-Index = {sub_idx:<4} (Measured: {val} {unit}){is_dom}")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    main()
