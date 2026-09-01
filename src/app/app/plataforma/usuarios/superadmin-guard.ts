// Función pura, sin "use server" — Next.js exige que TODO export de un módulo "use server" sea una
// función async (Server Action); una utilidad sincrónica como esta tiene que vivir aparte.
export function wouldRemoveLastSuperadmin(currentAdminCount: number): boolean {
  return currentAdminCount <= 1;
}
