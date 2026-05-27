-- Drop persisted `*.started` notifications. These rows were noise — a
-- transient live-UI signal that doubled the bell badge count for every
-- regen (one row for "X is regenerating slide N", a second for
-- "X regenerated slide N"). The terminal `*.finished` row tells the
-- full story; the started copy is meaningless by the time the
-- recipient opens the bell. See lib/notifications/server.ts for the
-- code-side change that stops creating new rows of these types.
DELETE FROM "Notification"
WHERE "type" IN ('slide.regen.started', 'deck.regen.started');
