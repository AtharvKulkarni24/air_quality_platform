/**
 * AEROPULSE - AIR QUALITY PLATFORM CLIENT APPLICATION
 * Interactive Leaflet Map, Real-time AQI Analytics, and ML Forecast Charts
 */

// Global State
const STATE = {
  city: "Pune",
  selectedStationId: null,
  selectedPollutant: "pm25",
  stationsAQI: [],
  stationsMetadata: [],
  map: null,
  markers: new Map(),
  chart: null,
};

const API_BASE = "/api";

// CPCB Category Color Helpers
function getCategoryColor(aqi) {
  if (aqi <= 50) return "#10b981"; // Good
  if (aqi <= 100) return "#84cc16"; // Satisfactory
  if (aqi <= 200) return "#f59e0b"; // Moderate
  if (aqi <= 300) return "#f97316"; // Poor
  if (aqi <= 400) return "#ef4444"; // Very Poor
  return "#991b1b"; // Severe
}

// --------------------------------------------------------------------------
// 1. Initial Setup & Event Listeners
// --------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initChart();
  setupEventListeners();
  await loadDashboardData();

  // Auto-refresh data every 60 seconds
  setInterval(loadDashboardData, 60000);
});

function setupEventListeners() {
  // City Selector
  const citySelect = document.getElementById("city-select");
  if (citySelect) {
    citySelect.addEventListener("change", async (e) => {
      STATE.city = e.target.value;
      STATE.selectedStationId = null;
      await loadDashboardData();
    });
  }

  // Refresh Button
  const btnRefresh = document.getElementById("btn-refresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", async () => {
      btnRefresh.classList.add("spinning");
      await loadDashboardData();
      setTimeout(() => btnRefresh.classList.remove("spinning"), 600);
    });
  }

  // Search filter
  const searchInput = document.getElementById("search-stations");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      filterStationList(e.target.value);
    });
  }

  // Pollutant tabs for chart
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      STATE.selectedPollutant = tab.dataset.pollutant;
      if (STATE.selectedStationId) {
        updateChart(STATE.selectedStationId, STATE.selectedPollutant);
      }
    });
  });
}

// --------------------------------------------------------------------------
// 2. Data Loading & Orchestration
// --------------------------------------------------------------------------

async function loadDashboardData() {
  try {
    const [summaryRes, statusRes, stationsRes, anomaliesRes] = await Promise.all([
      fetch(`${API_BASE}/aqi/summary?city=${encodeURIComponent(STATE.city)}`).then((r) => r.json()),
      fetch(`${API_BASE}/status`).then((r) => r.json()),
      fetch(`${API_BASE}/stations?city=${encodeURIComponent(STATE.city)}`).then((r) => r.json()),
      fetch(`${API_BASE}/anomalies`).then((r) => r.json()).catch(() => ({ status: "nominal", activeAnomalies: 0 })),
    ]);

    STATE.stationsAQI = summaryRes.stations || [];
    STATE.stationsMetadata = stationsRes || [];

    // Render Hero Cards
    renderHeroCards(summaryRes, statusRes);

    // Render Anomaly & Sensor Health Badge
    renderAnomalyBadge(anomaliesRes);

    // Render Station Leaderboard
    renderStationList(STATE.stationsAQI);

    // Render Markers on Map
    renderMapMarkers(STATE.stationsAQI, STATE.stationsMetadata);

    // Default select highest risk station if none selected
    if (!STATE.selectedStationId && STATE.stationsAQI.length > 0) {
      selectStation(STATE.stationsAQI[0].id);
    } else if (STATE.selectedStationId) {
      updateChart(STATE.selectedStationId, STATE.selectedPollutant);
      updateEnvironmentalDrawer(STATE.selectedStationId);
    }
  } catch (err) {
    console.error("[Dashboard] Error loading data:", err);
  }
}

function renderAnomalyBadge(anomalies) {
  const badge = document.getElementById("sensor-health-badge");
  const text = document.getElementById("sensor-health-text");
  if (!badge || !text) return;

  if (anomalies.activeAnomalies > 0) {
    badge.style.background = "rgba(239, 68, 68, 0.15)";
    badge.style.borderColor = "rgba(239, 68, 68, 0.4)";
    badge.style.color = "#ef4444";
    text.textContent = `Sensors: ${anomalies.activeAnomalies} Alert${anomalies.activeAnomalies > 1 ? "s" : ""}`;
  } else {
    badge.style.background = "rgba(56, 189, 248, 0.1)";
    badge.style.borderColor = "rgba(56, 189, 248, 0.3)";
    badge.style.color = "var(--text-accent)";
    text.textContent = "Sensors: 100% Nominal";
  }
}

// --------------------------------------------------------------------------
// 3. Hero Cards & Summary Render
// --------------------------------------------------------------------------

function renderHeroCards(summary, status) {
  // 1. City AQI Card
  const aqiScore = document.getElementById("hero-aqi-score");
  const aqiPill = document.getElementById("hero-aqi-pill");
  const aqiDesc = document.getElementById("hero-aqi-desc");

  if (aqiScore) {
    const score = summary.averageAQI || "--";
    aqiScore.textContent = score;
    aqiScore.style.color = summary.color || "#fff";

    if (aqiPill) {
      aqiPill.textContent = summary.category || "Unknown";
      aqiPill.style.backgroundColor = `${summary.color}25`;
      aqiPill.style.color = summary.color || "#fff";
      aqiPill.style.border = `1px solid ${summary.color}60`;
    }

    if (aqiDesc) {
      aqiDesc.textContent = summary.healthAdvisory || "Real-time air telemetry active.";
    }
  }

  // 2. Dominant Pollutant Card
  const domPollutant = document.getElementById("hero-dominant-pollutant");
  const domDetail = document.getElementById("hero-dominant-detail");
  if (domPollutant) {
    domPollutant.textContent = (summary.primaryDominantPollutant || "PM10").toUpperCase();
    if (domDetail) {
      domDetail.textContent = `Primary factor determining ${STATE.city || "regional"} health index`;
    }
  }

  // 3. Telemetry Ingestion Metrics (City-Specific)
  const statStations = document.getElementById("hero-total-stations");
  const statSensors = document.getElementById("hero-total-sensors");
  const pipelineLabel = document.getElementById("hero-pipeline-label");
  const pipelineSub = document.getElementById("hero-pipeline-sub");

  if (statStations) {
    const isFiltered = Boolean(STATE.city && STATE.city.trim() !== "");
    const stationCount = summary.stationsCount !== undefined ? summary.stationsCount : (isFiltered ? 6 : 18);
    const sensorCount = summary.sensorsCount !== undefined ? summary.sensorsCount : (stationCount * 13);
    const readingsCount = summary.readingsCount || 0;

    statStations.textContent = `${stationCount} Station${stationCount === 1 ? "" : "s"}`;

    if (pipelineLabel) {
      pipelineLabel.textContent = isFiltered ? `${STATE.city} Network` : "Global Network";
    }

    if (statSensors) {
      if (isFiltered) {
        statSensors.textContent = `${sensorCount} Sensors in ${STATE.city}`;
      } else {
        statSensors.textContent = `${sensorCount} Sensors across All Regions`;
      }
    }

    if (pipelineSub) {
      if (readingsCount > 0) {
        pipelineSub.textContent = `${readingsCount.toLocaleString()} readings processed via Kafka`;
      } else {
        pipelineSub.textContent = "Checkpointed in PostgreSQL via Kafka";
      }
    }
  }

  // 4. ML Forecaster Status
  const mlCount = document.getElementById("hero-forecast-count");
  if (mlCount && status?.metrics) {
    mlCount.textContent = `${status.metrics.total_forecasts || 48} Horizon Points`;
  }
}

// --------------------------------------------------------------------------
// 4. Interactive Leaflet Map
// --------------------------------------------------------------------------

function initMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  // Initialize Map centered on Pune
  STATE.map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
  }).setView([18.5204, 73.8567], 11);

  // OpenStreetMap Tile Layer with sleek dark theme filter (no watermark, zero API key)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    subdomains: "abc",
    className: "dark-tiles",
  }).addTo(STATE.map);
}

function renderMapMarkers(stationsAQI, metadataList) {
  if (!STATE.map) return;

  // Clear existing markers
  STATE.markers.forEach((m) => STATE.map.removeLayer(m));
  STATE.markers.clear();

  const metaById = new Map(metadataList.map((m) => [String(m.id), m]));
  const bounds = [];

  stationsAQI.forEach((st) => {
    const meta = metaById.get(String(st.id));
    const lat = st.latitude || meta?.latitude;
    const lon = st.longitude || meta?.longitude;

    if (!lat || !lon) return;

    bounds.push([lat, lon]);
    const color = st.color || getCategoryColor(st.aqi);

    // Custom pulsing SVG pin
    const pinHtml = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(17, 24, 39, 0.85);
        border: 2px solid ${color};
        box-shadow: 0 0 12px ${color}80;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Outfit', sans-serif;
        font-size: 11px;
        font-weight: 800;
        color: #fff;
        cursor: pointer;
        transition: transform 0.2s ease;
      ">
        ${st.aqi}
      </div>
    `;

    const icon = L.divIcon({
      className: "custom-aqi-marker",
      html: pinHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker([lat, lon], { icon }).addTo(STATE.map);

    // Popup Content
    const popupHtml = `
      <div class="map-popup">
        <h4>${st.name}</h4>
        <div class="popup-meta">${st.city} &bull; Dominant: <b>${st.dominantPollutant.toUpperCase()}</b></div>
        <div class="popup-aqi" style="background: ${color}25; color: ${color}; border: 1px solid ${color}60;">
          AQI ${st.aqi} &bull; ${st.category}
        </div>
        <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 6px;">${st.healthAdvisory}</p>
        <button class="btn-select-station" onclick="window.selectStation('${st.id}')">
          View Trends & ML Forecast &rarr;
        </button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    marker.on("click", () => {
      selectStation(st.id);
    });

    STATE.markers.set(String(st.id), marker);
  });

  // Fit map to markers if bounds exist
  if (bounds.length > 0 && !STATE.selectedStationId) {
    STATE.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

// --------------------------------------------------------------------------
// 5. Station Leaderboard & Selection
// --------------------------------------------------------------------------

function renderStationList(stations) {
  const container = document.getElementById("stations-list");
  if (!container) return;

  if (stations.length === 0) {
    container.innerHTML = `<div style="color: #64748b; font-size: 0.85rem; padding: 1rem; text-align: center;">No stations reporting in this region.</div>`;
    return;
  }

  container.innerHTML = stations
    .map((st) => {
      const color = st.color || getCategoryColor(st.aqi);
      const isSelected = String(st.id) === String(STATE.selectedStationId) ? "selected" : "";

      const chipsHtml = Object.entries(st.subIndices || {})
        .slice(0, 4)
        .map(([p, val]) => {
          const isDom = p === st.dominantPollutant ? "dominant" : "";
          return `<span class="chip ${isDom}">${p.toUpperCase()}: ${val}</span>`;
        })
        .join("");

      return `
        <div class="station-item ${isSelected}" id="station-card-${st.id}" onclick="selectStation('${st.id}')">
          <div class="station-item-header">
            <div>
              <div class="station-name">${st.name}</div>
              <div class="station-sub">${st.city} &bull; Primary: ${st.dominantPollutant.toUpperCase()}</div>
            </div>
            <div class="station-aqi-badge" style="background: ${color}20; color: ${color}; border: 1px solid ${color}50;">
              ${st.aqi}
            </div>
          </div>
          <div class="pollutant-chips">${chipsHtml}</div>
        </div>
      `;
    })
    .join("");
}

function filterStationList(searchTerm) {
  const query = searchTerm.toLowerCase().trim();
  const filtered = STATE.stationsAQI.filter(
    (st) =>
      st.name.toLowerCase().includes(query) ||
      st.city.toLowerCase().includes(query) ||
      st.dominantPollutant.toLowerCase().includes(query)
  );
  renderStationList(filtered);
}

window.selectStation = function (stationId) {
  STATE.selectedStationId = stationId;

  // Highlight card
  document.querySelectorAll(".station-item").forEach((el) => el.classList.remove("selected"));
  const activeCard = document.getElementById(`station-card-${stationId}`);
  if (activeCard) {
    activeCard.classList.add("selected");
    activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Pan map and open popup
  const marker = STATE.markers.get(String(stationId));
  if (marker && STATE.map) {
    STATE.map.setView(marker.getLatLng(), 13, { animate: true });
    marker.openPopup();
  }

  // Update chart
  updateChart(stationId, STATE.selectedPollutant);

  // Update environmental drawer
  updateEnvironmentalDrawer(stationId);
};

// --------------------------------------------------------------------------
// 6. Interactive Chart.js (Observed vs ML Forecast)
// --------------------------------------------------------------------------

function initChart() {
  const ctx = document.getElementById("forecast-chart");
  if (!ctx) return;

  const gradientObserved = ctx.getContext("2d").createLinearGradient(0, 0, 0, 300);
  gradientObserved.addColorStop(0, "rgba(56, 189, 248, 0.35)");
  gradientObserved.addColorStop(1, "rgba(56, 189, 248, 0.0)");

  const gradientForecast = ctx.getContext("2d").createLinearGradient(0, 0, 0, 300);
  gradientForecast.addColorStop(0, "rgba(192, 132, 252, 0.35)");
  gradientForecast.addColorStop(1, "rgba(192, 132, 252, 0.0)");

  STATE.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Actual Observed Telemetry",
          data: [],
          borderColor: "#38bdf8",
          backgroundColor: gradientObserved,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointBackgroundColor: "#38bdf8",
        },
        {
          label: "ML 24h Future Forecast (HistGradientBoosting)",
          data: [],
          borderColor: "#c084fc",
          backgroundColor: gradientForecast,
          borderWidth: 2.5,
          borderDash: [6, 6],
          tension: 0.35,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointBackgroundColor: "#c084fc",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(17, 24, 39, 0.95)",
          titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: "bold" },
          bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
          borderColor: "rgba(255, 255, 255, 0.15)",
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: (context) => {
              const val = context.raw;
              if (val === null || val === undefined) return null;
              return ` ${context.dataset.label.split("(")[0]}: ${val} µg/m³`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#64748b", font: { size: 10 } },
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#64748b", font: { size: 10 } },
          beginAtZero: true,
        },
      },
    },
  });
}

async function updateChart(stationId, pollutant) {
  if (!STATE.chart) return;

  const chartTitle = document.getElementById("chart-station-title");
  try {
    const res = await fetch(
      `${API_BASE}/stations/${stationId}/trend-and-forecast?pollutant=${pollutant}`
    ).then((r) => r.json());

    if (chartTitle && res.station) {
      chartTitle.textContent = `${res.station.name} - ${pollutant.toUpperCase()} Concentration Curve`;
    }

    const observedPoints = res.observed?.points || [];
    const forecastPoints = res.forecast?.points || [];

    const labels = [];
    const observedData = [];
    const forecastData = [];

    // Format timestamps for x-axis
    observedPoints.forEach((pt) => {
      const d = new Date(pt.observed_at);
      const timeStr = `${d.getHours()}:00`;
      labels.push(timeStr);
      observedData.push(pt.value);
      forecastData.push(null);
    });

    forecastPoints.forEach((pt) => {
      const d = new Date(pt.forecast_at);
      const timeStr = `+${d.getHours()}:00`;
      labels.push(timeStr);
      observedData.push(null);
      forecastData.push(pt.predicted_value);
    });

    // Bridge the gap between observed and forecast for continuous line look
    if (observedData.length > 0 && forecastData.length > 0) {
      forecastData[observedData.length - 1] = observedData[observedData.length - 1];
    }

    STATE.chart.data.labels = labels;
    STATE.chart.data.datasets[0].data = observedData;
    STATE.chart.data.datasets[1].data = forecastData;
    STATE.chart.update();
  } catch (err) {
    console.error("[Chart] Error loading trend and forecast:", err);
  }
}

// --------------------------------------------------------------------------
// 7. Environmental Telemetry Drawer
// --------------------------------------------------------------------------

async function updateEnvironmentalDrawer(stationId) {
  try {
    const readings = await fetch(`${API_BASE}/readings/latest?stationId=${stationId}`).then((r) =>
      r.json()
    );

    const tempVal = document.getElementById("env-temp");
    const humVal = document.getElementById("env-hum");
    const windSpeedVal = document.getElementById("env-wind");
    const windDirVal = document.getElementById("env-dir");

    let temp = "--", hum = "--", wind = "--", dir = "--";

    readings.forEach((r) => {
      const p = (r.pollutant || "").toLowerCase();
      if (p === "temperature") temp = `${r.value}°C`;
      if (p === "relativehumidity") hum = `${r.value}%`;
      if (p === "wind_speed") wind = `${r.value} ${r.unit || "m/s"}`;
      if (p === "wind_direction") dir = `${r.value}°`;
    });

    if (tempVal) tempVal.textContent = temp;
    if (humVal) humVal.textContent = hum;
    if (windSpeedVal) windSpeedVal.textContent = wind;
    if (windDirVal) windDirVal.textContent = dir;
  } catch (err) {
    console.error("[EnvDrawer] Error loading telemetry:", err);
  }
}
