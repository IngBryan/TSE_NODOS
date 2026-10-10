package uy.carga.pdi.config;

import java.util.List;
import javax.security.auth.callback.UnsupportedCallbackException;
import org.apache.wss4j.dom.WSConstants;
import org.apache.wss4j.dom.engine.WSSConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.ws.config.annotation.WsConfigurer;
import org.springframework.ws.server.EndpointInterceptor;
import org.springframework.ws.soap.security.wss4j2.Wss4jSecurityInterceptor;
import org.springframework.ws.soap.server.endpoint.interceptor.PayloadValidatingInterceptor;
import org.springframework.ws.wsdl.wsdl11.DefaultWsdl11Definition;
import org.springframework.ws.wsdl.wsdl11.SimpleWsdl11Definition;
import org.springframework.xml.xsd.SimpleXsdSchema;
import org.springframework.xml.xsd.XsdSchema;
import uy.carga.pdi.seguridad.OrganismoUsernameTokenValidator;
import uy.carga.pdi.seguridad.WsAddressingInterceptor;

/**
 * Publica los dos servicios SOAP bajo /ws:
 * <ul>
 * <li>/ws/servicioInformacion (WSDL: /ws/servicioInformacion.wsdl): contrato DNIC. Exige WS-Addressing y
 * WS-Security (Timestamp + UsernameToken del organismo).</li>
 * <li>/ws/admin (WSDL: /ws/admin.wsdl): administración de la PDI simulada, protegida con HTTP Basic.</li>
 * </ul>
 * Los interceptores se aplican por namespace del payload, no por URL (Spring-WS despacha por el contenido del
 * mensaje, así que filtrar por URL se podría saltear).
 */
@Configuration(proxyBeanMethods = false)
public class WebServiceConfig implements WsConfigurer {

	public static final String DNIC_NAMESPACE = "http://wsServicioDeInformacion/";

	public static final String ADMIN_NAMESPACE = "http://pdi.carga.uy/admin";

	private final AdminAuthInterceptor adminAuthInterceptor;

	private final OrganismoUsernameTokenValidator usernameTokenValidator;

	private final PdiProperties properties;

	public WebServiceConfig(PdiProperties properties, OrganismoUsernameTokenValidator usernameTokenValidator) {
		this.properties = properties;
		this.adminAuthInterceptor = new AdminAuthInterceptor(properties);
		this.usernameTokenValidator = usernameTokenValidator;
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
		// DNIC: WS-Addressing (MessageID obligatorio) y WS-Security.
		interceptors.add(new PorNamespaceInterceptor(new WsAddressingInterceptor(), DNIC_NAMESPACE));
		interceptors.add(new PorNamespaceInterceptor(wsSecurityInterceptor(), DNIC_NAMESPACE));
		// Administración: primero se autentica y después se valida el payload contra el XSD.
		interceptors.add(new PorNamespaceInterceptor(adminAuthInterceptor, ADMIN_NAMESPACE));
		interceptors.add(new PorNamespaceInterceptor(adminValidatingInterceptor(), ADMIN_NAMESPACE));
	}

	/**
	 * Exige en el header wsse:Security un Timestamp vigente y un UsernameToken (PasswordText) de un organismo
	 * activo. La respuesta no se firma ni se cifra.
	 */
	private Wss4jSecurityInterceptor wsSecurityInterceptor() {
		WSSConfig wssConfig = WSSConfig.getNewInstance();
		wssConfig.setValidator(WSConstants.USERNAME_TOKEN, usernameTokenValidator);

		Wss4jSecurityInterceptor interceptor = new Wss4jSecurityInterceptor();
		interceptor.setWssConfig(wssConfig);
		interceptor.setValidationActions("Timestamp UsernameToken");
		// Obligatorio para Spring-WS, pero no se usa: la clave la verifica OrganismoUsernameTokenValidator contra
		// el hash. Si WSS4J pidiera una clave en texto plano por esta vía, se rechaza.
		interceptor.setValidationCallbackHandler(callbacks -> {
			throw new UnsupportedCallbackException(callbacks[0], "Las claves se validan contra el hash BCrypt");
		});
		interceptor.setValidationTimeToLive(properties.wsSecurity().timestampTtlSegundos());
		interceptor.setTimestampStrict(true);
		interceptor.setSecureResponse(false);
		try {
			interceptor.afterPropertiesSet();
		}
		catch (Exception ex) {
			throw new IllegalStateException("No se pudo configurar WS-Security", ex);
		}
		return interceptor;
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
