package uy.carga.pdi.dnic;

/**
 * Datos del request {@code obtDocDigitalizado} que usa la simulación. El organismo es el autenticado por
 * WS-Security; los campos Organismo/ClaveAcceso1 del Body se ignoran.
 */
public record SolicitudConsulta(
		String organismo,
		String tipoDocumento,
		String nroDocumento,
		int idSolicitud) {
}
