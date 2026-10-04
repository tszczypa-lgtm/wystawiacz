export type CompanyDetails = { name: string; nip: string; street: string; postcode: string; city: string; country: "PL" };
export const emptyCompany: CompanyDetails = { name: "", nip: "", street: "", postcode: "", city: "", country: "PL" };

export function companyForForm(input: unknown): CompanyDetails {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return { name: typeof raw.name === "string" ? raw.name : "", nip: typeof raw.nip === "string" ? raw.nip : "", street: typeof raw.street === "string" ? raw.street : "", postcode: typeof raw.postcode === "string" ? raw.postcode : "", city: typeof raw.city === "string" ? raw.city : "", country: "PL" };
}

export function validateCompany(input: unknown): CompanyDetails {
  if (!input || typeof input !== "object") throw new Error("Uzupełnij dane firmy do faktury.");
  const raw = input as Record<string, unknown>;
  const field = (key: string, max: number) => {
    const value = typeof raw[key] === "string" ? raw[key].trim() : "";
    if (!value || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error("Uzupełnij poprawnie nazwę firmy i adres do faktury.");
    return value;
  };
  const nip = field("nip", 20).replace(/[ -]/g, "");
  const digits = [...nip].map(Number);
  const checksum = [6, 5, 7, 2, 3, 4, 5, 6, 7].reduce((sum, weight, i) => sum + weight * digits[i], 0) % 11;
  if (!/^\d{10}$/.test(nip) || checksum === 10 || checksum !== digits[9] || /^([0-9])\1{9}$/.test(nip)) throw new Error("Podaj poprawny polski NIP (10 cyfr).");
  const postcode = field("postcode", 6);
  if (!/^\d{2}-\d{3}$/.test(postcode)) throw new Error("Kod pocztowy powinien mieć format 00-000.");
  if (raw.country !== "PL") throw new Error("Ta wersja obsługuje dane firm z Polski.");
  return { name: field("name", 200), nip, street: field("street", 200), postcode, city: field("city", 100), country: "PL" };
}

export function validateSignup(password: string, confirmation: string, company: unknown) {
  if (password.length < 10) throw new Error("Hasło musi mieć co najmniej 10 znaków.");
  if (password !== confirmation) throw new Error("Hasła nie są takie same.");
  return validateCompany(company);
}
