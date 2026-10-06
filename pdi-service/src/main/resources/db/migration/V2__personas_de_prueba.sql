-- Personas FICTICIAS para pruebas. Las fechas relativas se calculan el día en que corre la migración.
INSERT INTO persona (nro_documento, nombre1, nombre2, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, cod_nacionalidad, activo) VALUES
    -- Mayores de edad
    ('11111111', 'Juan',    'Carlos', 'Pérez',     'García',   DATE '1980-05-10', 1, 1, TRUE),
    ('22222222', 'María',   NULL,     'Rodríguez', 'López',    DATE '1995-11-23', 2, 1, TRUE),
    ('77777777', 'Diego',   'Martín', 'Sosa',      NULL,       DATE '1972-02-29', 1, 2, TRUE),
    -- Menor de edad (16 años)
    ('33333333', 'Lucía',   NULL,     'Fernández', 'Méndez',   DATEADD(YEAR, -16, CURRENT_DATE), 2, 1, TRUE),
    -- Casos borde: cumple 18 el día de la migración / cumple 18 al día siguiente
    ('44444444', 'Martín',  NULL,     'Gómez',     'Suárez',   DATEADD(YEAR, -18, CURRENT_DATE), 1, 1, TRUE),
    ('55555555', 'Ana',     'Laura',  'Silva',     'Castro',   DATEADD(DAY, 1, DATEADD(YEAR, -18, CURRENT_DATE)), 2, 1, TRUE),
    -- Dada de baja: obtDocDigitalizado responde "persona no encontrada"
    ('66666666', 'Pedro',   NULL,     'Acosta',    'Núñez',    DATE '1988-07-01', 1, 1, FALSE);
