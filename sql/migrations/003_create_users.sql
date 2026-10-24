-- AJenarator migration 003: people who signed in with Google.
-- Only emails on the OWNER_EMAILS allow-list can sign in, so in practice this holds the owner.
-- Saved picks (next step) will belong to a row here.

CREATE TABLE users (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  google_sub     VARCHAR(255)  NOT NULL COMMENT 'Google account ID (the "sub" claim); never changes',
  email          VARCHAR(320)  NOT NULL,
  display_name   VARCHAR(200)  NULL,
  picture_url    VARCHAR(1024) NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_google_sub (google_sub),
  KEY idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
