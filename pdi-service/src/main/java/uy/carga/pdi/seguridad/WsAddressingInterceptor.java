package uy.carga.pdi.seguridad;

import org.slf4j.MDC;
import org.springframework.ws.context.MessageContext;
import org.springframework.ws.server.EndpointInterceptor;
import org.springframework.ws.soap.SoapMessage;
import org.springframework.ws.soap.addressing.core.MessageAddressingProperties;
import org.springframework.ws.soap.addressing.version.Addressing10;
import org.springframework.ws.soap.addressing.version.Addressing200408;
import org.springframework.ws.soap.addressing.version.AddressingVersion;

/**
 * Complementa el soporte WS-Addressing de Spring-WS para el servicio DNIC:
 * <ul>
 * <li>exige {@code wsa:MessageID} (Spring solo exige {@code wsa:Action});</li>
 * <li>pone el MessageID en el MDC ({@code wsaMessageId}) para que aparezca en los logs junto al correlationId.</li>
 * </ul>
 * Spring-WS se encarga del resto: despachar por wsa:Action y agregar a la respuesta wsa:Action, wsa:MessageID y
 * wsa:RelatesTo.
 */
public class WsAddressingInterceptor implements EndpointInterceptor {

	public static final String MDC_KEY = "wsaMessageId";

	private static final AddressingVersion[] VERSIONES = { new Addressing10(), new Addressing200408() };

	@Override
	public boolean handleRequest(MessageContext messageContext, Object endpoint) {
		MessageAddressingProperties map = leer(messageContext);
		if (map == null || map.getMessageId() == null) {
			throw new WsAddressingRequeridoException("WS-Addressing: falta el header wsa:MessageID");
		}
		MDC.put(MDC_KEY, map.getMessageId().toString());
		return true;
	}

	private static MessageAddressingProperties leer(MessageContext messageContext) {
		if (!(messageContext.getRequest() instanceof SoapMessage soapMessage)) {
			return null;
		}
		for (AddressingVersion version : VERSIONES) {
			MessageAddressingProperties map = version.getMessageAddressingProperties(soapMessage);
			if (map != null && map.getAction() != null) {
				return map;
			}
		}
		return null;
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
		MDC.remove(MDC_KEY);
	}

}
