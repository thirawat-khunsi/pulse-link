-- Initial schema (docs/SPEC.md §3)

CREATE TABLE links (
  id BIGSERIAL PRIMARY KEY,
  owner_token UUID NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  is_custom_alias BOOLEAN NOT NULL DEFAULT FALSE,
  target_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  max_clicks INTEGER CHECK (max_clicks > 0),
  click_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_links_owner ON links(owner_token, created_at DESC);

CREATE TABLE clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source VARCHAR(8) NOT NULL DEFAULT 'click' CHECK (source IN ('click','qr')),
  device VARCHAR(16),
  browser VARCHAR(64),
  os VARCHAR(64),
  referrer_host VARCHAR(255),
  is_bot BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_clicks_link_time ON clicks(link_id, clicked_at DESC);
