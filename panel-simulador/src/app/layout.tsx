import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Panel de nodos periféricos · TSE",
  description: "Control de escenarios de los nodos periféricos",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
