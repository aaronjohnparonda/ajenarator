-- AJenarator migration 002: the five PCSO 6-number games and their weekly draw days.
-- Draw days confirmed during Phase 0 (all drawn at 9:00 PM Philippine time):
--   6/42 Tue Thu Sat | 6/45 Mon Wed Fri | 6/49 Tue Thu Sun | 6/55 Mon Wed Sat | 6/58 Tue Fri Sun

INSERT INTO games (id, code, name, max_number) VALUES
  (1, '6/42', 'Lotto 6/42',       42),
  (2, '6/45', 'Mega Lotto 6/45',  45),
  (3, '6/49', 'Super Lotto 6/49', 49),
  (4, '6/55', 'Grand Lotto 6/55', 55),
  (5, '6/58', 'Ultra Lotto 6/58', 58);

-- ISO weekday: 1 = Monday ... 7 = Sunday
INSERT INTO game_schedules (game_id, day_of_week) VALUES
  (1, 2), (1, 4), (1, 6),
  (2, 1), (2, 3), (2, 5),
  (3, 2), (3, 4), (3, 7),
  (4, 1), (4, 3), (4, 6),
  (5, 2), (5, 5), (5, 7);
