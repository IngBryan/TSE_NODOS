package uy.carga.pdi.seguridad;

import org.springframework.ws.context.MessageContext;

/** Organismo autenticado por WS-Security, guardado en el MessageContext del request. */
public final class OrganismoAutenticado {

	private static final String PROPIEDAD = OrganismoAutenticado.class.getName();

	private OrganismoAutenticado() {
	}

	static void guardar(MessageContext messageContext, String codigo) {
		messageContext.setProperty(PROPIEDAD, codigo);
	}

	/** Código del organismo autenticado, o {@code null} si el request no pasó por WS-Security. */
	public static String de(MessageContext messageContext) {
		return (String) messageContext.getProperty(PROPIEDAD);
	}

}
