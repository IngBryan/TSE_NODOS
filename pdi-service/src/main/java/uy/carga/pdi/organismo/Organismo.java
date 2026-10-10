package uy.carga.pdi.organismo;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Organismo autorizado a consumir la PDI (carga.uy). Se identifica con el campo
 * {@code Organismo} del request y se autentica con {@code ClaveAcceso1}, guardada como hash BCrypt.
 */
@Entity
@Table(name = "organismo")
public class Organismo {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(nullable = false, unique = true, length = 40)
	private String codigo;

	@Column(nullable = false, length = 120)
	private String nombre;

	@Column(name = "clave_hash", nullable = false, length = 100)
	private String claveHash;

	@Column(nullable = false)
	private boolean activo = true;

	@Column(name = "creado_en", nullable = false, updatable = false)
	private Instant creadoEn;

	protected Organismo() {
	}

	public Organismo(String codigo, String nombre, String claveHash) {
		this.codigo = codigo;
		this.nombre = nombre;
		this.claveHash = claveHash;
	}

	public void desactivar() {
		this.activo = false;
	}

	@PrePersist
	void alCrear() {
		this.creadoEn = Instant.now();
	}

	public Long getId() {
		return id;
	}

	public String getCodigo() {
		return codigo;
	}

	public String getNombre() {
		return nombre;
	}

	public String getClaveHash() {
		return claveHash;
	}

	public boolean isActivo() {
		return activo;
	}

}
