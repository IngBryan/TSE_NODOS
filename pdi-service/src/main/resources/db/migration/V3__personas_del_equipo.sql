-- Personas del equipo para probar el login con gub.uy testing (CU-01) y el alta de chofer (CU-02) sin tener
-- que darlas de alta por el servicio de administración cada vez que se reinicia la PDI.
INSERT INTO persona (nro_documento, nombre1, nombre2, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, cod_nacionalidad, activo) VALUES
    -- Responsable de la empresa de prueba en el componente central (datos-prueba.sql)
    ('54074380', 'Emiliano', NULL, 'Tomas',    'Martinez', DATE '2000-06-29', 1, 1, TRUE),
    -- Chofer para probar el alta de chofer
    ('56087406', 'Bryan',    NULL, 'Salamone', 'Varela',   DATE '2000-03-15', 1, 1, TRUE),
    ('48060995', 'Alejandro', NULL, 'Orellano', 'Prantl',  DATE '2000-04-15', 1, 1, TRUE);
