"""Unified Analytics & ML CLI Tool.

Run individual analytics modules or the complete suite:
- AQI Calculation
- Sensor Anomaly Detection
- Machine Learning 24-Hour Forecasting
"""
import sys
import argparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from src.engines.station_analytics import get_all_stations_aqi, get_city_summary_aqi
from src.engines.anomaly import detect_sensor_anomalies
from src.engines.forecaster import run_batch_forecast_for_city


def show_aqi():
    print("\n" + "=" * 80)
    print("             1. REAL-TIME AIR QUALITY INDEX (CPCB STANDARDS)            ")
    print("=" * 80)

    summary = get_city_summary_aqi("Pune")
    print("\n[CITY SUMMARY] PUNE OVERALL AQI:")
    print(f"   * Active Stations   : {summary.get('stations_count', 0)}")
    print(f"   * Average City AQI  : {summary.get('city_avg_aqi', 'N/A')}")
    print(f"   * Peak Station AQI  : {summary.get('city_max_aqi', 'N/A')}")
    print(f"   * Health Category   : {summary.get('category', 'N/A')}")
    print(f"   * Dominant Cause    : {summary.get('primary_dominant_pollutant', 'N/A').upper()}")
    print(f"   * Health Advisory   : {summary.get('health_advisory', 'N/A')}\n")

    stations = get_all_stations_aqi()
    print("-" * 80)
    print(f"{'Station Name':<42} | {'City':<8} | {'AQI':<5} | {'Category':<12} | {'Dominant':<8}")
    print("-" * 80)
    for st in stations[:10]:
        name = st.station_name[:40]
        print(f"{name:<42} | {st.city:<8} | {st.overall_aqi:<5} | {st.category:<12} | {st.dominant_pollutant.upper():<8}")
    if len(stations) > 10:
        print(f"... and {len(stations) - 10} more stations.")
    print("-" * 80)


def show_anomalies():
    print("\n" + "=" * 80)
    print("                    2. SENSOR ANOMALY DETECTION REPORT                  ")
    print("=" * 80)

    alerts = detect_sensor_anomalies(hours=48)
    if not alerts:
        print("\n [ALL CLEAR] No sensor anomalies (flatlines or extreme spikes) detected.")
        print("=" * 80)
        return

    print(f"\n [ALERTS DETECTED] Found {len(alerts)} sensor anomalies in historical window:")
    print("-" * 80)
    for a in alerts[:8]:
        print(f"[{a.severity}] {a.anomaly_type} - {a.station_name} ({a.pollutant.upper()}):")
        print(f"   • Value: {a.value} | Expected: {a.expected_range}")
        print(f"   • Details: {a.message}")
        print()
    if len(alerts) > 8:
        print(f"... and {len(alerts) - 8} additional alerts.")
    print("-" * 80)


def show_forecast():
    print("\n" + "=" * 80)
    print("               3. MACHINE LEARNING 24-HOUR FORECASTING                 ")
    print("               Model: HistGradientBoostingRegressor                     ")
    print("=" * 80)

    cities = ["Pune", "Mumbai", "Delhi"]
    total_points = 0

    print(f"\nTraining ML time-series models and generating 24h forecasts for {', '.join(cities)}...")
    print("-" * 80)
    print(f"{'Station Name':<42} | {'Pollutant':<10} | {'Points':<8} | {'24h Avg Predicted'}")
    print("-" * 80)

    for city in cities:
        res = run_batch_forecast_for_city(city, limit_stations=None)
        total_points += res["total_forecast_points_saved"]
        for item in res["stations_forecasted"]:
            print(f"{item['station'][:40]:<42} | {item['pollutant'].upper():<10} | {item['predictions_count']:<8} | {item['24h_avg_predicted']} µg/m³")

    print("-" * 80)
    print(f"\n [SUCCESS] Generated and saved {total_points} total forecast points to database across {len(cities)} cities.")
    print(f"Destination: air_quality_readings (measurement_type='forecast', data_mode='modelled')\n")


def main():
    parser = argparse.ArgumentParser(description="Air Quality Analytics & ML CLI")
    parser.add_argument("--aqi", action="store_true", help="Run AQI calculation engine")
    parser.add_argument("--anomalies", action="store_true", help="Run sensor anomaly detection")
    parser.add_argument("--forecast", action="store_true", help="Run ML 24-hour forecasting")
    parser.add_argument("--all", action="store_true", help="Run all analytics modules")

    args = parser.parse_args()

    # Default to all if no specific flags
    if not any([args.aqi, args.anomalies, args.forecast]) or args.all:
        show_aqi()
        show_anomalies()
        show_forecast()
    else:
        if args.aqi:
            show_aqi()
        if args.anomalies:
            show_anomalies()
        if args.forecast:
            show_forecast()

    print("\nAnalytics run completed successfully.\n")


if __name__ == "__main__":
    main()
