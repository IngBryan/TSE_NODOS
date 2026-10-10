package uy.carga.pdi;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import uy.carga.pdi.consulta.ConsultaRegistroRepository;
import uy.carga.pdi.seguridad.WsAddressingAcciones;

/**
 * Prueba de punta a punta por HTTP real contra H2 en memoria.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
		"pdi.admin.usuario=admin", "pdi.admin.password=admin-test-password",
		"pdi.organismo-inicial.codigo=MTOP-CARGA", "pdi.organismo-inicial.clave=clave-de-prueba-123" })
class PdiSoapIntegrationTest {

	private static final String ADMIN_AUTH = "Basic "
			+ Base64.getEncoder().encodeToString("admin:admin-test-password".getBytes(StandardCharsets.UTF_8));

	private static final String PASSWORD_TEXT = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText";

	private static final String PASSWORD_DIGEST = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest";

	private final HttpClient http = HttpClient.newHttpClient();

	@LocalServerPort
	private int port;

	@Autowired
	private ConsultaRegistroRepository consultaRepository;

	// ===== Contrato DNIC con WS-Addressing + WS-Security =====

	@Test
	void obtDocDigitalizadoDevuelveLosDatosDeLaPersona() throws Exception {
		Cabecera cabecera = Cabecera.valida();

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 15));

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains(">Juan<")
			.contains("Pérez")
			.contains("1980-05-10")
			.contains("15</")
			.doesNotContain("Errores");
	}

	@Test
	void laRespuestaIncluyeLosHeadersWsAddressing() throws Exception {
		Cabecera cabecera = Cabecera.valida();

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.body()).contains("RelatesTo")
			.contains(cabecera.messageId)
			.contains(WsAddressingAcciones.OBT_DOC_DIGITALIZADO_RESPONSE);
	}

	@Test
	void sinWsAddressingDevuelveFault() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.conAddressing = false;

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault").contains("WS-Addressing requerido");
	}

	@Test
	void sinMessageIdDevuelveFault() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.messageId = null;

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.body()).contains("Fault").contains("MessageID");
	}

	@Test
	void sinHeaderWsSecurityDevuelveFault() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.conSecurity = false;

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault").doesNotContain("ObjPersona");
	}

	@Test
	void claveIncorrectaDevuelveFault() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.clave = "clave-incorrecta";

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault").doesNotContain("ObjPersona");
	}

	@Test
	void organismoInexistenteDevuelveFault() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.usuario = "OTRO-ORGANISMO";

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.body()).contains("Fault").doesNotContain("ObjPersona");
	}

	@Test
	void timestampVencidoDevuelveFault() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.creado = Instant.now().minus(Duration.ofMinutes(20));
		cabecera.expira = Instant.now().minus(Duration.ofMinutes(15));

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.body()).contains("Fault").doesNotContain("ObjPersona");
	}

	@Test
	void passwordDigestNoSeAdmite() throws Exception {
		Cabecera cabecera = Cabecera.valida();
		cabecera.passwordType = PASSWORD_DIGEST;

		HttpResponse<String> response = dnic(cabecera, obtDocDigitalizado("11111111", 1));

		assertThat(response.body()).contains("Fault").doesNotContain("ObjPersona");
	}

	@Test
	void ignoraOrganismoYClaveDelBodyYRegistraElDelToken() throws Exception {
		String body = """
				<ws:obtDocDigitalizado>
				  <ws:paramObtDocDigitalizado>
				    <ws:IdSolicitud>4242</ws:IdSolicitud>
				    <ws:Organismo>CUALQUIERA</ws:Organismo>
				    <ws:ClaveAcceso1>cualquier-cosa</ws:ClaveAcceso1>
				    <ws:Nrodocumento>22222222</ws:Nrodocumento>
				    <ws:NroIdentificacion>0</ws:NroIdentificacion>
				  </ws:paramObtDocDigitalizado>
				</ws:obtDocDigitalizado>""";

		HttpResponse<String> response = dnic(Cabecera.valida(), body);

		assertThat(response.body()).contains("María");
		assertThat(consultaRepository.findAll())
			.anyMatch(c -> c.getIdSolicitud() == 4242 && "MTOP-CARGA".equals(c.getOrganismoCodigo()));
	}

	@Test
	void personaDadaDeBajaDevuelveError1001() throws Exception {
		HttpResponse<String> response = dnic(Cabecera.valida(), obtDocDigitalizado("66666666", 1));

		assertThat(response.body()).contains("1001").doesNotContain("ObjPersona");
	}

	@Test
	void propagaElCorrelationIdYLoRegistra() throws Exception {
		HttpRequest request = HttpRequest.newBuilder(uri("/ws/servicioInformacion"))
			.header("Content-Type", "text/xml; charset=utf-8")
			.header("X-Correlation-Id", "test-correlacion-123")
			.POST(HttpRequest.BodyPublishers.ofString(
					envelope(Cabecera.valida().xml(WsAddressingAcciones.OBT_DOC_DIGITALIZADO, destino()),
							obtDocDigitalizado("22222222", 99))))
			.build();

		HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());

		assertThat(response.headers().firstValue("X-Correlation-Id")).hasValue("test-correlacion-123");
		assertThat(consultaRepository.findAll())
			.anyMatch(c -> "test-correlacion-123".equals(c.getCorrelationId()) && c.getIdSolicitud() == 99);
	}

	@Test
	void publicaElWsdlConWsAddressing() throws Exception {
		HttpResponse<String> response = http.send(HttpRequest.newBuilder(uri("/ws/servicioInformacion.wsdl")).build(),
				HttpResponse.BodyHandlers.ofString());

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains("wsServicioDeInformacionSoap")
			.contains("objPersona")
			.contains("UsingAddressing")
			.contains(WsAddressingAcciones.OBT_DOC_DIGITALIZADO_RESPONSE)
			.contains("localhost:" + port + "/ws/servicioInformacion");
	}

	@Test
	void productDescResponde() throws Exception {
		HttpResponse<String> response = post("/ws/servicioInformacion",
				envelope(Cabecera.valida().xml(WsAddressingAcciones.PRODUCT_DESC, destino()), "<ws:ProductDesc/>"),
				null);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains("SIMULACION").contains(WsAddressingAcciones.PRODUCT_DESC_RESPONSE);
	}

	// ===== Administración =====

	@Test
	void adminSinCredencialesDevuelve401ConDesafioBasic() throws Exception {
		HttpResponse<String> response = post("/ws/admin", envelope("", consultarPersona("11111111")), null);

		assertThat(response.statusCode()).isEqualTo(401);
		assertThat(response.headers().firstValue("WWW-Authenticate")).hasValueSatisfying(
				value -> assertThat(value).startsWith("Basic"));
	}

	@Test
	void adminConCredencialesIncorrectasDevuelveFault() throws Exception {
		String malas = "Basic " + Base64.getEncoder().encodeToString("admin:otra".getBytes(StandardCharsets.UTF_8));

		HttpResponse<String> response = post("/ws/admin", envelope("", consultarPersona("11111111")), malas);

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault").contains("Acceso denegado");
	}

	@Test
	void adminNoSePuedeSaltearEnviandoloAOtraUrl() throws Exception {
		HttpResponse<String> response = post("/ws/servicioInformacion", envelope("", consultarPersona("11111111")),
				null);

		assertThat(response.body()).contains("Acceso denegado");
	}

	@Test
	void altaDePersonaEnCalienteYLuegoSeConsultaPorDnic() throws Exception {
		String alta = """
				<adm:AltaPersonaRequest>
				  <adm:persona>
				    <adm:nroDocumento>81234567</adm:nroDocumento>
				    <adm:nombre1>Carla</adm:nombre1>
				    <adm:primerApellido>Benítez</adm:primerApellido>
				    <adm:fechaNacimiento>2001-03-15</adm:fechaNacimiento>
				    <adm:sexo>2</adm:sexo>
				    <adm:codNacionalidad>1</adm:codNacionalidad>
				  </adm:persona>
				</adm:AltaPersonaRequest>""";

		HttpResponse<String> altaResponse = post("/ws/admin", envelope("", alta), ADMIN_AUTH);
		assertThat(altaResponse.statusCode()).isEqualTo(200);
		assertThat(altaResponse.body()).contains("AltaPersonaResponse").contains("Carla");

		HttpResponse<String> consulta = dnic(Cabecera.valida(), obtDocDigitalizado("81234567", 2));
		assertThat(consulta.body()).contains("Carla").contains("2001-03-15");
	}

	@Test
	void adminValidaElPayloadContraElXsd() throws Exception {
		HttpResponse<String> response = post("/ws/admin", envelope("", consultarPersona("abc")), ADMIN_AUTH);

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault");
	}

	@Test
	void adminConsultaDePersonaInexistenteDevuelveFault() throws Exception {
		HttpResponse<String> response = post("/ws/admin", envelope("", consultarPersona("99999999")), ADMIN_AUTH);

		assertThat(response.body()).contains("Fault").contains("No existe una persona");
	}

	@Test
	void simulacionCaidoHaceFallarDnicPeroNoLaAdministracion() throws Exception {
		try {
			HttpResponse<String> configurar = post("/ws/admin", envelope("", configurarSimulacion("CAIDO")),
					ADMIN_AUTH);
			assertThat(configurar.body()).contains("CAIDO");

			HttpResponse<String> dnic = dnic(Cabecera.valida(), obtDocDigitalizado("11111111", 1));
			assertThat(dnic.statusCode()).isEqualTo(500);
			assertThat(dnic.body()).contains("Servicio no disponible");

			HttpResponse<String> admin = post("/ws/admin", envelope("", consultarPersona("11111111")), ADMIN_AUTH);
			assertThat(admin.statusCode()).isEqualTo(200);
		}
		finally {
			post("/ws/admin", envelope("", configurarSimulacion("NORMAL")), ADMIN_AUTH);
		}
	}

	// ===== Helpers =====

	/** Headers WS-Addressing y WS-Security de un request DNIC; cada test rompe lo que quiere probar. */
	private static final class Cabecera {

		boolean conAddressing = true;

		boolean conSecurity = true;

		String messageId = "urn:uuid:" + UUID.randomUUID();

		String usuario = "MTOP-CARGA";

		String clave = "clave-de-prueba-123";

		String passwordType = PASSWORD_TEXT;

		Instant creado = Instant.now();

		Instant expira = Instant.now().plus(Duration.ofMinutes(5));

		static Cabecera valida() {
			return new Cabecera();
		}

		String xml(String accion, String destino) {
			StringBuilder sb = new StringBuilder();
			if (conAddressing) {
				sb.append("<wsa:Action>").append(accion).append("</wsa:Action>");
				if (messageId != null) {
					sb.append("<wsa:MessageID>").append(messageId).append("</wsa:MessageID>");
				}
				sb.append("<wsa:To>").append(destino).append("</wsa:To>");
			}
			if (conSecurity) {
				sb.append("""
						<wsse:Security soapenv:mustUnderstand="1">
						  <wsu:Timestamp wsu:Id="TS-1">
						    <wsu:Created>%s</wsu:Created>
						    <wsu:Expires>%s</wsu:Expires>
						  </wsu:Timestamp>
						  <wsse:UsernameToken wsu:Id="UT-1">
						    <wsse:Username>%s</wsse:Username>
						    <wsse:Password Type="%s">%s</wsse:Password>
						  </wsse:UsernameToken>
						</wsse:Security>""".formatted(creado.truncatedTo(ChronoUnit.MILLIS),
						expira.truncatedTo(ChronoUnit.MILLIS), usuario, passwordType, clave));
			}
			return sb.toString();
		}

	}

	private HttpResponse<String> dnic(Cabecera cabecera, String body) throws Exception {
		return post("/ws/servicioInformacion",
				envelope(cabecera.xml(WsAddressingAcciones.OBT_DOC_DIGITALIZADO, destino()), body), null);
	}

	private String destino() {
		return "http://localhost:" + port + "/ws/servicioInformacion";
	}

	private HttpResponse<String> post(String path, String body, String authorization) throws Exception {
		HttpRequest.Builder builder = HttpRequest.newBuilder(uri(path))
			.header("Content-Type", "text/xml; charset=utf-8")
			.POST(HttpRequest.BodyPublishers.ofString(body));
		if (authorization != null) {
			builder.header("Authorization", authorization);
		}
		return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + port + path);
	}

	private static String envelope(String header, String body) {
		return """
				<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
				                  xmlns:ws="http://wsServicioDeInformacion/"
				                  xmlns:adm="http://pdi.carga.uy/admin"
				                  xmlns:wsa="http://www.w3.org/2005/08/addressing"
				                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
				                  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
				  <soapenv:Header>%s</soapenv:Header>
				  <soapenv:Body>%s</soapenv:Body>
				</soapenv:Envelope>""".formatted(header, body);
	}

	private static String obtDocDigitalizado(String documento, int idSolicitud) {
		return """
				<ws:obtDocDigitalizado>
				  <ws:paramObtDocDigitalizado>
				    <ws:TipoDocumento>DO</ws:TipoDocumento>
				    <ws:IdSolicitud>%d</ws:IdSolicitud>
				    <ws:Nrodocumento>%s</ws:Nrodocumento>
				    <ws:NroIdentificacion>0</ws:NroIdentificacion>
				  </ws:paramObtDocDigitalizado>
				</ws:obtDocDigitalizado>""".formatted(idSolicitud, documento);
	}

	private static String consultarPersona(String documento) {
		return "<adm:ConsultarPersonaRequest><adm:nroDocumento>%s</adm:nroDocumento></adm:ConsultarPersonaRequest>"
			.formatted(documento);
	}

	private static String configurarSimulacion(String modo) {
		return "<adm:ConfigurarSimulacionRequest><adm:modo>%s</adm:modo></adm:ConfigurarSimulacionRequest>"
			.formatted(modo);
	}

}
