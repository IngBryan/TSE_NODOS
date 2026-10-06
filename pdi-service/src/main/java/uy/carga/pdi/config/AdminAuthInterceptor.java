package uy.carga.pdi.config;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ws.context.MessageContext;
import org.springframework.ws.server.EndpointInterceptor;
import org.springframework.ws.soap.server.endpoint.annotation.FaultCode;
import org.springframework.ws.soap.server.endpoint.annotation.SoapFault;
import org.springframework.ws.transport.context.TransportContext;
import org.springframework.ws.transport.context.TransportContextHolder;
import org.springframework.ws.transport.http.HttpServletConnection;

/**
 * Autenticación HTTP Basic del servicio de administración.
 * <p>
 * Se aplica por namespace del payload (ver {@link WebServiceConfig}) y no por URL: Spring-WS despacha por el
 * elemento raíz del mensaje, así que filtrar por path permitiría saltearlo enviando el mensaje a otra URL.
 * Cuando se incorpore WS-Security, este interceptor se reemplaza por uno de WSS4J con el mismo alcance.
 * <p>
 * No es un bean a propósito: así no hay riesgo de que se aplique a los endpoints DNIC.
 */
public class AdminAuthInterceptor implements EndpointInterceptor {

	private static final Logger log = LoggerFactory.getLogger(AdminAuthInterceptor.class);

	private final byte[] credencialEsperada;

	public AdminAuthInterceptor(PdiProperties properties) {
		String credencial = properties.admin().usuario() + ":" + properties.admin().password();
		this.credencialEsperada = credencial.getBytes(StandardCharsets.UTF_8);
	}

	@Override
	public boolean handleRequest(MessageContext messageContext, Object endpoint) {
		if (!credencialValida(leerAuthorization())) {
			log.warn("Acceso denegado al servicio de administración");
			throw new AccesoDenegadoException();
		}
		return true;
	}

	private String leerAuthorization() {
		TransportContext context = TransportContextHolder.getTransportContext();
		if (context != null && context.getConnection() instanceof HttpServletConnection connection) {
			return connection.getHttpServletRequest().getHeader("Authorization");
		}
		return null;
	}

	private boolean credencialValida(String authorization) {
		if (authorization == null || !authorization.regionMatches(true, 0, "Basic ", 0, 6)) {
			return false;
		}
		try {
			byte[] recibida = Base64.getDecoder().decode(authorization.substring(6).trim());
			return MessageDigest.isEqual(recibida, credencialEsperada);
		}
		catch (IllegalArgumentException ex) {
			return false;
		}
	}

	@Override
	public boolean handleResponse(MessageContext messageContext, Object endpoint) {
		return true;
	}

	@Override
	public boolean handleFault(MessageContext messageContext, Object endpoint) {
		return true;
	}

	@Override
	public void afterCompletion(MessageContext messageContext, Object endpoint, Exception ex) {
	}

	@SoapFault(faultCode = FaultCode.CLIENT, faultStringOrReason = "Acceso denegado: credenciales de administración inválidas")
	public static class AccesoDenegadoException extends RuntimeException {

		public AccesoDenegadoException() {
			super("Acceso denegado");
		}

	}

}
