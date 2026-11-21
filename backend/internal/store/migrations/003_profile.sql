-- Optional profile: a display name and one of the built-in avatars. Empty
-- means «буква на цвете», drawn by the frontend from the address.
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
