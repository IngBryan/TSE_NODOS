package uy.carga.pdi.consulta;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Registro de cada consulta recibida (Ley 18.331: quién consultó qué documento y cuándo). Su id es el
 * {@code idRespuesta} que se devuelve en el contrato DNIC.
 */
@Entity
@Table(name = "consulta")
public class ConsultaRegistro {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Integer id;

	@Column(name = "organismo_codigo", length = 40)
	private String organismoCodigo;

	@Column(name = "nro_documento", length = 40)
	private String nroDocumento;

	@Column(name = "id_solicitud", nullable = false)
	private int idSolicitud;

	@Column(nullable = false, length = 40)
	private String resultado;

	@Column(name = "correlation_id", length = 64)
	private String correlationId;

	@Column(nullable = false)
	private Instant fecha;

	protected ConsultaRegistro() {
	}

	public ConsultaRegistro(String organismoCodigo, String nroDocumento, int idSolicitud, String resultado,
			String correlationId) {
		this.organismoCodigo = truncar(organismoCodigo, 40);
		this.nroDocumento = truncar(nroDocumento, 40);
		this.idSolicitud = idSolicitud;
		this.resultado = resultado;
		this.correlationId = correlationId;
		this.fecha = Instant.now();
	}

	private static String truncar(String valor, int largo) {
		return valor == null || valor.length() <= largo ? valor : valor.substring(0, largo);
	}

	public Integer getId() {
		return id;
	}

	public String getOrganismoCodigo() {
		return organismoCodigo;
	}

	public String getNroDocumento() {
		return nroDocumento;
	}

	public int getIdSolicitud() {
		return idSolicitud;
	}

	public String getResultado() {
		return resultado;
	}

	public String getCorrelationId() {
		return correlationId;
	}

	public Instant getFecha() {
		return fecha;
	}

}
