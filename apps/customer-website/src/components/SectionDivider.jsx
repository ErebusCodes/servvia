export default function SectionDivider({ title }) {
  return (
    <div className="flex items-center gap-4 justify-center py-8">
      <div className="h-px w-12 bg-accent/40" />
      <h2 className="font-display text-2xl md:text-3xl tracking-wider text-foreground italic">{title}</h2>
      <div className="h-px w-12 bg-accent/40" />
    </div>
  );
}