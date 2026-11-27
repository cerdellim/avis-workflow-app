type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-muted">
        {description}
      </p>
    </section>
  );
}
