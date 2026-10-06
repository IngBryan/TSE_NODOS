package uy.carga.pdi.dnic;

/**
 * Códigos que se devuelven en {@code objResult.Errores}. Son propios de esta simulación (no los de DNIC) y el
 * componente central los traduce a los resultados de CU-03.
 */
public enum CodigoMensaje {

	/** CU-03 → NO_EXISTE. */
	PERSONA_NO_ENCONTRADA(1001, "No se encontró una persona con el documento indicado"),

	/** Organismo inexistente, inactivo o clave de acceso incorrecta. */
	ORGANISMO_NO_AUTORIZADO(2001, "Organismo o clave de acceso inválidos"),

	/** Número de documento ausente o con formato inválido. */
	DOCUMENTO_INVALIDO(3001, "Número de documento inválido"),

	/** Solo se admite cédula de identidad (TipoDocumento "DO" o vacío). */
	TIPO_DOCUMENTO_NO_SOPORTADO(3002, "Tipo de documento no soportado");

	private final int codigo;

	private final String descripcion;

	CodigoMensaje(int codigo, String descripcion) {
		this.codigo = codigo;
		this.descripcion = descripcion;
	}

	public int codigo() {
		return codigo;
	}

	public String descripcion() {
		return descripcion;
	}

}
