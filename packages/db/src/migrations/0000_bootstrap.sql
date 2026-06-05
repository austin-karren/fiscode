CREATE TABLE IF NOT EXISTS profile (
  id TEXT PRIMARY KEY,
  filing_status TEXT NOT NULL,
  state TEXT NOT NULL,
  se_start_date TEXT NOT NULL,
  dependents INTEGER NOT NULL DEFAULT 0,
  tracks_roth INTEGER NOT NULL DEFAULT 0,
  uses_retirement INTEGER NOT NULL DEFAULT 0,
  quarterly_method TEXT NOT NULL DEFAULT 'annualized',
  prep_lead_days INTEGER NOT NULL DEFAULT 14,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);

CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spouse (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT,
  annual_w2_wages_cents INTEGER NOT NULL DEFAULT 0,
  annual_federal_withholding_cents INTEGER NOT NULL DEFAULT 0,
  annual_state_withholding_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  notes TEXT,
  default_rate_cents INTEGER,
  default_commission_rate_basis_points INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  client_id TEXT,
  amount_cents INTEGER NOT NULL,
  source_type TEXT NOT NULL DEFAULT '1099',
  kind TEXT NOT NULL DEFAULT 'recurring',
  description TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_entry (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  client_id TEXT,
  minutes INTEGER NOT NULL,
  description TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle (
  id TEXT PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  mpg INTEGER,
  method TEXT NOT NULL DEFAULT 'standard_mileage',
  in_service_date TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mileage (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vehicle_id TEXT,
  business_miles INTEGER NOT NULL,
  purpose TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS home_office (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT,
  method TEXT NOT NULL DEFAULT 'simplified',
  office_sqft INTEGER,
  home_sqft INTEGER,
  monthly_rent_mortgage_cents INTEGER,
  monthly_utilities_cents INTEGER,
  monthly_insurance_cents INTEGER,
  regular_exclusive_ack INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category TEXT NOT NULL,
  client_id TEXT,
  description TEXT,
  reason TEXT,
  notes TEXT,
  flag_for_section_179 INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retirement_contribution (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL DEFAULT (current_timestamp)
);

CREATE INDEX IF NOT EXISTS income_date_idx ON income (date);
CREATE INDEX IF NOT EXISTS expense_date_idx ON expense (date);
CREATE INDEX IF NOT EXISTS mileage_date_idx ON mileage (date);
CREATE INDEX IF NOT EXISTS time_entry_date_idx ON time_entry (date);
CREATE INDEX IF NOT EXISTS history_entity_idx ON history (entity, entity_id);
