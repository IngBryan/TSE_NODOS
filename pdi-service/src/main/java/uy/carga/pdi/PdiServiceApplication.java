package uy.carga.pdi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class PdiServiceApplication {

	public static void main(String[] args) {
		SpringApplication.run(PdiServiceApplication.class, args);
	}

}
