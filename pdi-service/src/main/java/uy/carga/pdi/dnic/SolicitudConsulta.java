package uy.carga.pdi.dnic;

/** Datos del request {@code obtDocDigitalizado} que usa la simulación. */
public record SolicitudConsulta(
		String organismo,
		String claveAcceso1,
		String tipoDocumento,
		String nroDocumento,
		int idSolicitud) {

	@Override
	public String toString() {
		// Nunca loguear la clave de acceso.
		return "SolicitudConsulta[organismo=" + organismo + ", tipoDocumento=" + tipoDocumento + ", idSolicitud="
				+ idSolicitud + "]";
	}

}
