package uy.carga.pdi;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import uy.carga.pdi.consulta.ConsultaRegistroRepository;

/**
 * Prueba de punta a punta por HTTP real contra H2 en memoria.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
		"pdi.admin.usuario=admin", "pdi.admin.password=admin-test-password",
		"pdi.organismo-inicial.codigo=MTOP-CARGA", "pdi.organismo-inicial.clave=clave-de-prueba-123" })
class PdiSoapIntegrationTest {

	private static final String ADMIN_AUTH = "Basic "
			+ Base64.getEncoder().encodeToString("admin:admin-test-password".getBytes(StandardCharsets.UTF_8));

	private final HttpClient http = HttpClient.newHttpClient();

	@LocalServerPort
	private int port;

	@Autowired
	private ConsultaRegistroRepository consultaRepository;

	// ===== Contrato DNIC =====

	@Test
	void obtDocDigitalizadoDevuelveLosDatosDeLaPersona() throws Exception {
		HttpResponse<String> response = dnic(obtDocDigitalizado("MTOP-CARGA", "clave-de-prueba-123", "11111111", 15));

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains(">Juan<")
			.contains("Pérez")
			.contains("1980-05-10")
			.contains("15</")
			.doesNotContain("Errores");
	}

	@Test
	void obtDocDigitalizadoConClaveIncorrectaDevuelveError2001() throws Exception {
		HttpResponse<String> response = dnic(obtDocDigitalizado("MTOP-CARGA", "clave-incorrecta", "11111111", 1));

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains("2001").doesNotContain("ObjPersona");
	}

	@Test
	void personaDadaDeBajaDevuelveError1001() throws Exception {
		HttpResponse<String> response = dnic(obtDocDigitalizado("MTOP-CARGA", "clave-de-prueba-123", "66666666", 1));

		assertThat(response.body()).contains("1001").doesNotContain("ObjPersona");
	}

	@Test
	void propagaElCorrelationIdYLoRegistra() throws Exception {
		HttpRequest request = HttpRequest.newBuilder(uri("/ws/servicioInformacion"))
			.header("Content-Type", "text/xml; charset=utf-8")
			.header("X-Correlation-Id", "test-correlacion-123")
			.POST(HttpRequest.BodyPublishers
				.ofString(obtDocDigitalizado("MTOP-CARGA", "clave-de-prueba-123", "22222222", 99)))
			.build();

		HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());

		assertThat(response.headers().firstValue("X-Correlation-Id")).hasValue("test-correlacion-123");
		assertThat(consultaRepository.findAll())
			.anyMatch(c -> "test-correlacion-123".equals(c.getCorrelationId()) && c.getIdSolicitud() == 99);
	}

	@Test
	void publicaElWsdlOriginal() throws Exception {
		HttpResponse<String> response = http.send(HttpRequest.newBuilder(uri("/ws/servicioInformacion.wsdl")).build(),
				HttpResponse.BodyHandlers.ofString());

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains("wsServicioDeInformacionSoap")
			.contains("objPersona")
			.contains("localhost:" + port + "/ws/servicioInformacion");
	}

	@Test
	void productDescResponde() throws Exception {
		HttpResponse<String> response = dnic(envelope("<ws:ProductDesc/>"));

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains("SIMULACION");
	}

	// ===== Administración =====

	@Test
	void adminSinCredencialesDevuelve401ConDesafioBasic() throws Exception {
		HttpResponse<String> response = post("/ws/admin", consultarPersona("11111111"), null);

		assertThat(response.statusCode()).isEqualTo(401);
		assertThat(response.headers().firstValue("WWW-Authenticate")).hasValueSatisfying(
				value -> assertThat(value).startsWith("Basic"));
	}

	@Test
	void adminConCredencialesIncorrectasDevuelveFault() throws Exception {
		String malas = "Basic " + Base64.getEncoder().encodeToString("admin:otra".getBytes(StandardCharsets.UTF_8));

		HttpResponse<String> response = post("/ws/admin", consultarPersona("11111111"), malas);

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault").contains("Acceso denegado");
	}

	@Test
	void adminNoSePuedeSaltearEnviandoloAOtraUrl() throws Exception {
		HttpResponse<String> response = post("/ws/servicioInformacion", consultarPersona("11111111"), null);

		assertThat(response.body()).contains("Acceso denegado");
	}

	@Test
	void altaDePersonaEnCalienteYLuegoSeConsultaPorDnic() throws Exception {
		String alta = envelope("""
				<adm:AltaPersonaRequest>
				  <adm:persona>
				    <adm:nroDocumento>81234567</adm:nroDocumento>
				    <adm:nombre1>Carla</adm:nombre1>
				    <adm:primerApellido>Benítez</adm:primerApellido>
				    <adm:fechaNacimiento>2001-03-15</adm:fechaNacimiento>
				    <adm:sexo>2</adm:sexo>
				    <adm:codNacionalidad>1</adm:codNacionalidad>
				  </adm:persona>
				</adm:AltaPersonaRequest>""");

		HttpResponse<String> altaResponse = post("/ws/admin", alta, ADMIN_AUTH);
		assertThat(altaResponse.statusCode()).isEqualTo(200);
		assertThat(altaResponse.body()).contains("AltaPersonaResponse").contains("Carla");

		HttpResponse<String> consulta = dnic(obtDocDigitalizado("MTOP-CARGA", "clave-de-prueba-123", "81234567", 2));
		assertThat(consulta.body()).contains("Carla").contains("2001-03-15");
	}

	@Test
	void adminValidaElPayloadContraElXsd() throws Exception {
		HttpResponse<String> response = post("/ws/admin", consultarPersona("abc"), ADMIN_AUTH);

		assertThat(response.statusCode()).isEqualTo(500);
		assertThat(response.body()).contains("Fault");
	}

	@Test
	void adminConsultaDePersonaInexistenteDevuelveFault() throws Exception {
		HttpResponse<String> response = post("/ws/admin", consultarPersona("99999999"), ADMIN_AUTH);

		assertThat(response.body()).contains("Fault").contains("No existe una persona");
	}

	@Test
	void simulacionCaidoHaceFallarDnicPeroNoLaAdministracion() throws Exception {
		try {
			HttpResponse<String> configurar = post("/ws/admin", configurarSimulacion("CAIDO"), ADMIN_AUTH);
			assertThat(configurar.body()).contains("CAIDO");

			HttpResponse<String> dnic = dnic(obtDocDigitalizado("MTOP-CARGA", "clave-de-prueba-123", "11111111", 1));
			assertThat(dnic.statusCode()).isEqualTo(500);
			assertThat(dnic.body()).contains("Servicio no disponible");

			HttpResponse<String> admin = post("/ws/admin", consultarPersona("11111111"), ADMIN_AUTH);
			assertThat(admin.statusCode()).isEqualTo(200);
		}
		finally {
			post("/ws/admin", configurarSimulacion("NORMAL"), ADMIN_AUTH);
		}
	}

	// ===== Helpers =====

	private HttpResponse<String> dnic(String body) throws Exception {
		return post("/ws/servicioInformacion", body, null);
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

	private static String envelope(String body) {
		return """
				<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
				                  xmlns:ws="http://wsServicioDeInformacion/"
				                  xmlns:adm="http://pdi.carga.uy/admin">
				  <soapenv:Body>%s</soapenv:Body>
				</soapenv:Envelope>""".formatted(body);
	}

	private static String obtDocDigitalizado(String organismo, String clave, String documento, int idSolicitud) {
		return envelope("""
				<ws:obtDocDigitalizado>
				  <ws:paramObtDocDigitalizado>
				    <ws:TipoDocumento>DO</ws:TipoDocumento>
				    <ws:IdSolicitud>%d</ws:IdSolicitud>
				    <ws:Organismo>%s</ws:Organismo>
				    <ws:ClaveAcceso1>%s</ws:ClaveAcceso1>
				    <ws:Nrodocumento>%s</ws:Nrodocumento>
				    <ws:NroIdentificacion>0</ws:NroIdentificacion>
				  </ws:paramObtDocDigitalizado>
				</ws:obtDocDigitalizado>""".formatted(idSolicitud, organismo, clave, documento));
	}

	private static String consultarPersona(String documento) {
		return envelope("<adm:ConsultarPersonaRequest><adm:nroDocumento>%s</adm:nroDocumento></adm:ConsultarPersonaRequest>"
			.formatted(documento));
	}

	private static String configurarSimulacion(String modo) {
		return envelope("<adm:ConfigurarSimulacionRequest><adm:modo>%s</adm:modo></adm:ConfigurarSimulacionRequest>"
			.formatted(modo));
	}

}
