# Air Quality Analytics & Machine Learning Service

This service provides statistical air quality analysis (AQI), real-time sensor anomaly detection, and time-series pollution forecasting.

## Architecture & Structure

```
analytics/
├── .env                  # Environment variables (DB URL, Kafka broker, topics)
├── .venv/                # Python 3.12 virtual environment
├── requirements.txt      # Dependencies (pandas, scikit-learn, sqlalchemy, etc.)
├── test_setup.py         # Verification script
└── src/
    ├── config.py         # Pydantic Settings
    ├── db/
    │   └── session.py    # SQLAlchemy connection pool to PostgreSQL
    ├── engines/          # AQI calculator, anomaly detection, ML forecasters
    └── workers/          # Streaming & batch worker daemons
```

## Getting Started

### 1. Activate the Virtual Environment

**Windows (PowerShell):**
```powershell
.\.venv\Scripts\Activate.ps1
```

**Windows (Command Prompt):**
```cmd
.\.venv\Scripts\activate.bat
```

### 2. Verify Connections & Environment

Run the verification test:
```sh
.\.venv\Scripts\python test_setup.py
```
