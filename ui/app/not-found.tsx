export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-3xl font-semibold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
    </main>
  );
}
