package uy.carga.pdi.persona;

import java.time.LocalDate;

/** Datos de una persona tal como los carga el servicio de administración. */
public record PersonaDatos(
		String nroDocumento,
		String nombre1,
		String nombre2,
		String primerApellido,
		String segundoApellido,
		LocalDate fechaNacimiento,
		int sexo,
		int codNacionalidad) {
}
