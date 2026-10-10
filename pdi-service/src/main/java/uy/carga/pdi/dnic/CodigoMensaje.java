package uy.carga.pdi.dnic;

/**
 * Códigos que se devuelven en {@code objResult.Errores}. El
 * componente central los traduce a los resultados de CU-03. La autenticación del organismo ya no es un error de
 * negocio: si falla, WS-Security responde un SOAP Fault antes de llegar acá.
 */
public enum CodigoMensaje {

	/** CU-03 → NO_EXISTE. */
	PERSONA_NO_ENCONTRADA(1001, "No se encontró una persona con el documento indicado"),

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
