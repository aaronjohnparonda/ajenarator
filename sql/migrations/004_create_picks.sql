-- AJenarator migration 004: My Picks - one saved combination per user, game and draw.
-- Picks are final once saved (no UPDATE path in the app) and lock 1 hour before the draw;
-- both rules are enforced by the server. Results are not stored here: they are computed by
-- joining draws on (game_id, draw_date), so a pick is "graded" the moment the result is saved.
-- Note: TiDB accepts but does not enforce CHECK constraints; the app validates every pick first.

CREATE TABLE picks (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED     NOT NULL,
  game_id         TINYINT UNSIGNED NOT NULL,
  draw_date       DATE             NOT NULL COMMENT 'Philippine date of the draw this pick is for',
  n1              TINYINT UNSIGNED NOT NULL,
  n2              TINYINT UNSIGNED NOT NULL,
  n3              TINYINT UNSIGNED NOT NULL,
  n4              TINYINT UNSIGNED NOT NULL,
  n5              TINYINT UNSIGNED NOT NULL,
  n6              TINYINT UNSIGNED NOT NULL,
  source          VARCHAR(10)      NOT NULL COMMENT 'generator or manual',
  created_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result_seen_at  DATETIME         NULL COMMENT 'When the result pop-up was dismissed',
  PRIMARY KEY (id),
  UNIQUE KEY uq_picks_user_game_draw (user_id, game_id, draw_date),
  KEY idx_picks_user_draw_date (user_id, draw_date),
  CONSTRAINT fk_picks_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_picks_game FOREIGN KEY (game_id) REFERENCES games (id),
  CONSTRAINT chk_picks_sorted_unique CHECK (n1 >= 1 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6),
  CONSTRAINT chk_picks_source CHECK (source IN ('generator', 'manual'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
