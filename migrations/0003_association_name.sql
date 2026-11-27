UPDATE app_settings
SET value = 'Avis Berceto',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE key = 'association_name';
