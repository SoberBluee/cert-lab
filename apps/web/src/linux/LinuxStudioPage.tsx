import { PageHeader, Section } from '../components/ui';
import { QuickCreateTracks } from '../studio/QuickCreateTracks';

/** Quick Create entry only — no Advanced Studio / blueprints under Linux Labs. */
export function LinuxStudioPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-14 pb-10">
      <PageHeader title="Studio" intro="Build practice labs. The Linux recipe catalog is still empty; builders land here later." />
      <Section title="Quick Create" note="question by question, no YAML or scripts">
        <QuickCreateTracks base="/linux" />
      </Section>
    </div>
  );
}
