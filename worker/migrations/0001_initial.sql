PRAGMA foreign_keys = ON;

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workshops (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(title) BETWEEN 2 AND 120),
  normalized_title TEXT NOT NULL UNIQUE,
  suggested_by TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rsvps (
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workshop_id, participant_id)
);

CREATE INDEX idx_workshops_created_at ON workshops(created_at DESC);
CREATE INDEX idx_rsvps_workshop ON rsvps(workshop_id, created_at ASC);
CREATE INDEX idx_rsvps_participant ON rsvps(participant_id);
