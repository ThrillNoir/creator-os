import { getActiveCreator } from "@/lib/current-creator";
import { getCreators } from "@/lib/db";
import { AppNavigation } from "@/components/app-navigation";

type AppShellProps = {
  active: string;
  children: React.ReactNode;
};

export async function AppShell({ active, children }: AppShellProps) {
  const activeCreator = await getActiveCreator();
  const creators = getCreators();

  return (
    <div className="app-shell">
      <AppNavigation active={active} activeCreator={activeCreator} creators={creators} />
      <main>{children}</main>
    </div>
  );
}
