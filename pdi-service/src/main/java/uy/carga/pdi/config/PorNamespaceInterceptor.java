package uy.carga.pdi.config;

import org.springframework.ws.context.MessageContext;
import org.springframework.ws.server.EndpointInterceptor;
import org.springframework.ws.soap.server.endpoint.interceptor.PayloadRootSmartSoapEndpointInterceptor;

/**
 * Aplica el interceptor delegado solo a los mensajes cuyo payload está en el namespace indicado.
 * <p>
 * {@link PayloadRootSmartSoapEndpointInterceptor} por sí solo no alcanza: el mapping por {@code wsa:Action}
 * (WS-Addressing) ejecuta todos los interceptores sin consultar {@code shouldIntercept}. Por eso el filtro se
 * repite en cada método.
 */
public class PorNamespaceInterceptor extends PayloadRootSmartSoapEndpointInterceptor {

	public PorNamespaceInterceptor(EndpointInterceptor delegate, String namespaceUri) {
		super(delegate, namespaceUri, null);
	}

	private boolean aplica(MessageContext messageContext, Object endpoint) {
		return shouldIntercept(messageContext.getRequest(), endpoint);
	}

	@Override
	public boolean handleRequest(MessageContext messageContext, Object endpoint) throws Exception {
		return !aplica(messageContext, endpoint) || super.handleRequest(messageContext, endpoint);
	}

	@Override
	public boolean handleResponse(MessageContext messageContext, Object endpoint) throws Exception {
		return !aplica(messageContext, endpoint) || super.handleResponse(messageContext, endpoint);
	}

	@Override
	public boolean handleFault(MessageContext messageContext, Object endpoint) throws Exception {
		return !aplica(messageContext, endpoint) || super.handleFault(messageContext, endpoint);
	}

	@Override
	public void afterCompletion(MessageContext messageContext, Object endpoint, Exception ex) throws Exception {
		if (aplica(messageContext, endpoint)) {
			super.afterCompletion(messageContext, endpoint, ex);
		}
	}

}
