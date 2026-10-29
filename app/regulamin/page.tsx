import { SalesDocumentPage } from "@/components/legal-page";

export const metadata = { title: "Regulamin | Wystawiacz by Tymo", robots: { index: false, follow: true } };
export default function TermsPage() {
  return <SalesDocumentPage name="regulamin" />;
}
