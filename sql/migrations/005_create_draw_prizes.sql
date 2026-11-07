-- AJenarator migration 005: lower-prize breakdown per draw (how many matched 5, 4 and 3 numbers,
-- and how much each of them won).
-- PCSO's results page only lists the jackpot, so this comes from PCSO's official breakdown as
-- republished by The Summit Express. A row is saved only after every check passes:
-- same winning numbers as the PCSO result, 5- and 4-number pools add up, 3-number prize is the
-- fixed amount (see src/config/prize-structure.js). One row per draw; no row = not known yet.

CREATE TABLE draw_prizes (
  draw_id         INT UNSIGNED   NOT NULL,
  match5_winners  INT UNSIGNED   NOT NULL,
  match5_prize    DECIMAL(12,2)  NULL COMMENT 'Each winner; NULL when nobody matched 5',
  match4_winners  INT UNSIGNED   NOT NULL,
  match4_prize    DECIMAL(12,2)  NULL COMMENT 'Each winner; NULL when nobody matched 4',
  match3_winners  INT UNSIGNED   NOT NULL,
  match3_prize    DECIMAL(12,2)  NULL COMMENT 'Each winner; NULL when nobody matched 3',
  source          VARCHAR(30)    NOT NULL COMMENT 'summitexpress',
  source_url      VARCHAR(255)   NOT NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (draw_id),
  CONSTRAINT fk_draw_prizes_draw FOREIGN KEY (draw_id) REFERENCES draws (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
