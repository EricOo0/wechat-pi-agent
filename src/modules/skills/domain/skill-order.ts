export interface SkillResource {
  enabled: boolean;
  path: string;
  metadata: { scope: string; source: string; origin: string };
}
/** Bundled resources follow explicit project paths and precede all other sources. */
export function skillPathsWithBundled(resources: SkillResource[], bundled: string): string[] {
  const enabled = resources.filter(resource => resource.enabled);
  const index = enabled.findIndex(({ metadata: m }) => !(m.scope === "project" && m.source === "local" && m.origin !== "package"));
  const paths = enabled.map(resource => resource.path);
  paths.splice(index < 0 ? paths.length : index, 0, bundled);
  return paths;
}
