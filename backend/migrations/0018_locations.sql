-- #40: multi-location hierarchy (site/building/floor/room) + move history.
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site text NOT NULL DEFAULT '',
  building text NOT NULL DEFAULT '',
  floor text NOT NULL DEFAULT '',
  room text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, building, floor, room)
);

ALTER TABLE assets ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

CREATE TABLE asset_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  from_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  to_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_moves_asset ON asset_moves (asset_id, created_at DESC);
