package uy.carga.pdi.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Si llega un POST a /ws/admin sin header Authorization, responde 401 con el desafío Basic. Así los clientes que
 * no envían credenciales de forma preventiva (p. ej. SoapUI) reintentan con ellas.
 * <p>
 * No es el control de acceso: ese lo hace {@link AdminAuthInterceptor} por namespace, sea cual sea la URL.
 */
@Component
public class AdminBasicChallengeFilter extends OncePerRequestFilter {

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !"POST".equals(request.getMethod()) || !request.getRequestURI().startsWith("/ws/admin");
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		if (request.getHeader("Authorization") == null) {
			response.setHeader("WWW-Authenticate", "Basic realm=\"pdi-admin\", charset=\"UTF-8\"");
			response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
			return;
		}
		chain.doFilter(request, response);
	}

}
