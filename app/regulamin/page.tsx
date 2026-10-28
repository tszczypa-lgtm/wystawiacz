import { SalesDocumentPage } from "@/components/legal-page";

export const metadata = { title: "Projekt regulaminu | Wystawiacz by Tymo", robots: { index: false, follow: true } };
export default function TermsPage() {
  return <SalesDocumentPage name="regulamin" />;
}
