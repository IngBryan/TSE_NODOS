package uy.carga.pdi.seguridad;

import javax.xml.namespace.QName;
import javax.xml.transform.TransformerFactory;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;
import org.springframework.ws.WebServiceMessage;
import org.springframework.ws.context.MessageContext;
import org.springframework.ws.server.EndpointInvocationChain;
import org.springframework.ws.server.EndpointMapping;
import org.springframework.ws.server.endpoint.support.PayloadRootUtils;
import uy.carga.pdi.config.WebServiceConfig;

/**
 * Último recurso para el servicio DNIC. Sus endpoints se mapean solo por {@code wsa:Action}, así que si un request
 * DNIC llega hasta acá es porque no trae los headers WS-Addressing o trae una acción desconocida. En lugar del 404
 * por defecto, se responde un SOAP Fault que explica qué falta.
 */
@Component
public class WsAddressingRequeridoMapping implements EndpointMapping, Ordered {

	private static final TransformerFactory TRANSFORMER_FACTORY = TransformerFactory.newInstance();

	@Override
	public EndpointInvocationChain getEndpoint(MessageContext messageContext) throws Exception {
		WebServiceMessage request = messageContext.getRequest();
		QName payload = PayloadRootUtils.getPayloadRootQName(request.getPayloadSource(), TRANSFORMER_FACTORY);
		if (payload != null && WebServiceConfig.DNIC_NAMESPACE.equals(payload.getNamespaceURI())) {
			throw new WsAddressingRequeridoException(
					"WS-Addressing requerido: el request debe incluir wsa:Action, wsa:MessageID y wsa:To "
							+ "(http://www.w3.org/2005/08/addressing). Acciones válidas: "
							+ WsAddressingAcciones.OBT_DOC_DIGITALIZADO + ", " + WsAddressingAcciones.PRODUCT_DESC);
		}
		return null;
	}

	@Override
	public int getOrder() {
		return Ordered.LOWEST_PRECEDENCE;
	}

}
