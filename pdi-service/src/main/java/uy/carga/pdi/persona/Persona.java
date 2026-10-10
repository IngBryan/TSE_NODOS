package uy.carga.pdi.persona;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Persona del registro simulado de DNIC. Solo se guardan los campos que usa carga.uy; el resto de
 * {@code objPersona} respondemos vacío.
 */
@Entity
@Table(name = "persona")
public class Persona {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(name = "nro_documento", nullable = false, unique = true, length = 8)
	private String nroDocumento;

	@Column(nullable = false, length = 60)
	private String nombre1;

	@Column(length = 60)
	private String nombre2;

	@Column(name = "primer_apellido", nullable = false, length = 60)
	private String primerApellido;

	@Column(name = "segundo_apellido", length = 60)
	private String segundoApellido;

	@Column(name = "fecha_nacimiento", nullable = false)
	private LocalDate fechaNacimiento;

	@Column(nullable = false)
	private int sexo;

	@Column(name = "cod_nacionalidad", nullable = false)
	private int codNacionalidad;

	@Column(nullable = false)
	private boolean activo = true;

	@Column(name = "creado_en", nullable = false, updatable = false)
	private Instant creadoEn;

	@Column(name = "actualizado_en", nullable = false)
	private Instant actualizadoEn;

	protected Persona() {
	}

	public Persona(PersonaDatos datos) {
		this.nroDocumento = datos.nroDocumento();
		actualizar(datos);
	}

	/** Actualiza los datos personales (el número de documento no cambia) y reactiva la persona. */
	public void actualizar(PersonaDatos datos) {
		this.nombre1 = datos.nombre1();
		this.nombre2 = datos.nombre2();
		this.primerApellido = datos.primerApellido();
		this.segundoApellido = datos.segundoApellido();
		this.fechaNacimiento = datos.fechaNacimiento();
		this.sexo = datos.sexo();
		this.codNacionalidad = datos.codNacionalidad();
		this.activo = true;
	}

	public void darDeBaja() {
		this.activo = false;
	}

	public PersonaDatos datos() {
		return new PersonaDatos(nroDocumento, nombre1, nombre2, primerApellido, segundoApellido, fechaNacimiento,
				sexo, codNacionalidad);
	}

	@PrePersist
	void alCrear() {
		this.creadoEn = Instant.now();
		this.actualizadoEn = this.creadoEn;
	}

	@PreUpdate
	void alActualizar() {
		this.actualizadoEn = Instant.now();
	}

	public Long getId() {
		return id;
	}

	public String getNroDocumento() {
		return nroDocumento;
	}

	public String getNombre1() {
		return nombre1;
	}

	public String getNombre2() {
		return nombre2;
	}

	public String getPrimerApellido() {
		return primerApellido;
	}

	public String getSegundoApellido() {
		return segundoApellido;
	}

	public LocalDate getFechaNacimiento() {
		return fechaNacimiento;
	}

	public int getSexo() {
		return sexo;
	}

	public int getCodNacionalidad() {
		return codNacionalidad;
	}

	public boolean isActivo() {
		return activo;
	}

}
