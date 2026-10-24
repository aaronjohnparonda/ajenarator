-- AJenarator migration 001: core tables for games, draw schedules, draw results, and fetch logs.
-- MySQL 8.0.16+ (CHECK constraints are enforced). All tables use InnoDB + utf8mb4.

-- The five PCSO 6-number games.
CREATE TABLE games (
  id          TINYINT UNSIGNED NOT NULL,
  code        VARCHAR(10)      NOT NULL COMMENT 'Format used to match PCSO names, e.g. 6/42',
  name        VARCHAR(50)      NOT NULL COMMENT 'Display name, e.g. Lotto 6/42',
  max_number  TINYINT UNSIGNED NOT NULL COMMENT 'Highest ball number, e.g. 42',
  pick_count  TINYINT UNSIGNED NOT NULL DEFAULT 6,
  draw_time   TIME             NOT NULL DEFAULT '21:00:00' COMMENT 'Philippine time',
  is_active   TINYINT(1)       NOT NULL DEFAULT 1,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_games_code (code),
  CONSTRAINT chk_games_max_number CHECK (max_number BETWEEN 6 AND 99),
  CONSTRAINT chk_games_pick_count CHECK (pick_count = 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Which weekdays each game is drawn. ISO weekday: 1 = Monday ... 7 = Sunday.
CREATE TABLE game_schedules (
  game_id      TINYINT UNSIGNED NOT NULL,
  day_of_week  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, day_of_week),
  CONSTRAINT fk_game_schedules_game FOREIGN KEY (game_id) REFERENCES games (id),
  CONSTRAINT chk_game_schedules_day CHECK (day_of_week BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per official draw. Numbers are stored sorted ascending (n1 < n2 < ... < n6);
-- the order PCSO published them in is kept in draw_order.
-- sum_total, odd_count and consecutive_pairs are STORED generated columns: MySQL computes them
-- once on insert, so they can never disagree with the numbers and cost nothing per read.
CREATE TABLE draws (
  id                 INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  game_id            TINYINT UNSIGNED NOT NULL,
  draw_date          DATE             NOT NULL,
  n1                 TINYINT UNSIGNED NOT NULL,
  n2                 TINYINT UNSIGNED NOT NULL,
  n3                 TINYINT UNSIGNED NOT NULL,
  n4                 TINYINT UNSIGNED NOT NULL,
  n5                 TINYINT UNSIGNED NOT NULL,
  n6                 TINYINT UNSIGNED NOT NULL,
  draw_order         VARCHAR(30)      NOT NULL COMMENT 'As published, e.g. 37-41-05-33-42-40',
  jackpot_amount     DECIMAL(15,2)    NULL,
  winners            INT UNSIGNED     NULL,
  sum_total          SMALLINT UNSIGNED AS (n1 + n2 + n3 + n4 + n5 + n6) STORED,
  odd_count          TINYINT UNSIGNED  AS ((n1 % 2) + (n2 % 2) + (n3 % 2) + (n4 % 2) + (n5 % 2) + (n6 % 2)) STORED,
  consecutive_pairs  TINYINT UNSIGNED  AS ((n2 = n1 + 1) + (n3 = n2 + 1) + (n4 = n3 + 1) + (n5 = n4 + 1) + (n6 = n5 + 1)) STORED,
  source             VARCHAR(20)      NOT NULL DEFAULT 'pcso',
  created_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One draw per game per date; also serves "latest draws for a game" queries (no extra index needed).
  UNIQUE KEY uq_draws_game_date (game_id, draw_date),
  CONSTRAINT fk_draws_game FOREIGN KEY (game_id) REFERENCES games (id),
  CONSTRAINT chk_draws_sorted_unique CHECK (n1 >= 1 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per fetch run (history load or nightly check), so every run can be audited.
CREATE TABLE ingest_runs (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_type          ENUM('backfill', 'daily') NOT NULL,
  trigger_source    VARCHAR(30)  NOT NULL COMMENT 'cli, github_actions, ...',
  status            ENUM('running', 'success', 'partial', 'failed') NOT NULL DEFAULT 'running',
  range_start       DATE         NULL,
  range_end         DATE         NULL,
  rows_inserted     INT UNSIGNED NOT NULL DEFAULT 0,
  rows_skipped      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Already saved and identical',
  rows_conflicting  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Already saved but different - never overwritten',
  details           JSON         NULL COMMENT 'Conflicts, missing expected draws, per-game counts',
  error_message     VARCHAR(1000) NULL,
  started_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at       DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY idx_ingest_runs_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
