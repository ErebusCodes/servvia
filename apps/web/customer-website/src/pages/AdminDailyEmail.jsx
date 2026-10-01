import Navbar from '../components/Navbar';

export default function AdminDailyEmail() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-24 pb-16 px-4 md:px-8 max-w-3xl mx-auto">
        <h1 className="font-display text-4xl text-foreground tracking-tight mb-4">Daily Email Settings</h1>
        <p className="text-muted-foreground font-body text-sm">
          This feature has been migrated to the Verdura Admin Console.
        </p>
      </div>
    </div>
  );
}
