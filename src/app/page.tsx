import { GrowthTracker } from "@/components/growth-tracker";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Personal Growth</h1>
        <p className="mt-2 text-muted-foreground">
          Track the dimensions of your life and capture what you&apos;re
          learning along the way.
        </p>
      </header>
      <GrowthTracker />
    </main>
  );
}
