package uy.carga.pdi.config;

import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.ws.config.annotation.WsConfigurer;
import org.springframework.ws.server.EndpointInterceptor;
import org.springframework.ws.soap.server.endpoint.interceptor.PayloadRootSmartSoapEndpointInterceptor;
import org.springframework.ws.soap.server.endpoint.interceptor.PayloadValidatingInterceptor;
import org.springframework.ws.wsdl.wsdl11.DefaultWsdl11Definition;
import org.springframework.ws.wsdl.wsdl11.SimpleWsdl11Definition;
import org.springframework.xml.xsd.SimpleXsdSchema;
import org.springframework.xml.xsd.XsdSchema;

/**
 * Publica los dos servicios SOAP bajo /ws:
 * <ul>
 * <li>/ws/servicioInformacion (WSDL: /ws/servicioInformacion.wsdl): contrato DNIC original.</li>
 * <li>/ws/admin (WSDL: /ws/admin.wsdl): administración de la PDI simulada, protegida con HTTP Basic.</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
public class WebServiceConfig implements WsConfigurer {

	public static final String DNIC_NAMESPACE = "http://wsServicioDeInformacion/";

	public static final String ADMIN_NAMESPACE = "http://pdi.carga.uy/admin";

	private final AdminAuthInterceptor adminAuthInterceptor;

	public WebServiceConfig(PdiProperties properties) {
		this.adminAuthInterceptor = new AdminAuthInterceptor(properties);
	}

	/** El nombre del bean define la URL del WSDL: /ws/servicioInformacion.wsdl */
	@Bean(name = "servicioInformacion")
	SimpleWsdl11Definition servicioInformacion() {
		return new SimpleWsdl11Definition(new ClassPathResource("wsdl/servicioInformacion.wsdl"));
	}

	@Bean
	XsdSchema adminSchema() {
		return new SimpleXsdSchema(new ClassPathResource("xsd/admin.xsd"));
	}

	/** El nombre del bean define la URL del WSDL: /ws/admin.wsdl */
	@Bean(name = "admin")
	DefaultWsdl11Definition admin(XsdSchema adminSchema) {
		DefaultWsdl11Definition definition = new DefaultWsdl11Definition();
		definition.setPortTypeName("PdiAdminPort");
		definition.setServiceName("PdiAdminService");
		definition.setLocationUri("/ws/admin");
		definition.setTargetNamespace(ADMIN_NAMESPACE);
		definition.setSchema(adminSchema);
		return definition;
	}

	@Override
	public void addInterceptors(List<EndpointInterceptor> interceptors) {
		// Primero se autentica y después se valida el payload contra el XSD de administración.
		interceptors.add(new PayloadRootSmartSoapEndpointInterceptor(adminAuthInterceptor, ADMIN_NAMESPACE, null));
		interceptors.add(new PayloadRootSmartSoapEndpointInterceptor(adminValidatingInterceptor(), ADMIN_NAMESPACE,
				null));
	}

	private PayloadValidatingInterceptor adminValidatingInterceptor() {
		PayloadValidatingInterceptor validating = new PayloadValidatingInterceptor();
		validating.setSchema(new ClassPathResource("xsd/admin.xsd"));
		validating.setValidateRequest(true);
		validating.setValidateResponse(false);
		try {
			validating.afterPropertiesSet();
		}
		catch (Exception ex) {
			throw new IllegalStateException("No se pudo cargar xsd/admin.xsd", ex);
		}
		return validating;
	}

}
