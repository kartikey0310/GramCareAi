-- GramCare AI Database Schema
-- Run: sqlite3 gramcare.db < schema.sql

-- Patients: patient records created by users
CREATE TABLE IF NOT EXISTS patients (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    age         INTEGER NOT NULL,
    village     TEXT    NOT NULL,
    mobile      TEXT    NOT NULL,
    flag        TEXT    NOT NULL DEFAULT 'NO READINGS',
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vitals checks: heart rate / SpO2 / temperature readings
CREATE TABLE IF NOT EXISTS vitals_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hr          INTEGER NOT NULL,
    spo2        INTEGER NOT NULL,
    temp        REAL    NOT NULL,
    flag        TEXT    NOT NULL,
    message     TEXT    NOT NULL,
    checked_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Medicines: store catalogue (reference data, not patient data)
CREATE TABLE IF NOT EXISTS medicines (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL UNIQUE,
    category  TEXT    NOT NULL,
    price     INTEGER NOT NULL,
    rx        INTEGER NOT NULL DEFAULT 0
);

-- Emergency alerts: SOS requests
CREATE TABLE IF NOT EXISTS emergency_alerts (
    id         TEXT     PRIMARY KEY,
    name       TEXT     NOT NULL,
    problem    TEXT     NOT NULL,
    status     TEXT     NOT NULL DEFAULT 'SENT',
    responder  TEXT,
    eta_min    INTEGER,
    created_at TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_patients_name   ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile);
CREATE INDEX IF NOT EXISTS idx_vitals_checked  ON vitals_checks(checked_at);
CREATE INDEX IF NOT EXISTS idx_alerts_created  ON emergency_alerts(created_at);
