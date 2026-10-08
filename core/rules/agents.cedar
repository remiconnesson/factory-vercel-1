// What each station's sandbox agent may reach and change. The model (AI Gateway) is always reachable.

@id("sandbox stations may read Vercel")
permit (principal, action == Factory::Action::"use", resource == Factory::Capability::"vercel")
when { principal in [Factory::Station::"spec", Factory::Station::"implement", Factory::Station::"revise"] };

@id("only Dev may push its branch")
permit (principal, action == Factory::Action::"use", resource == Factory::Capability::"github-push")
when { principal in [Factory::Station::"implement", Factory::Station::"revise"] };

@id("Spec changes only specs")
permit (principal == Factory::Station::"spec", action == Factory::Action::"change", resource)
when { resource.path like "specs/*" };

// Dev's prompt asks it to leave specs/ alone, but no rule can enforce that yet: the orchestrator judges Dev's PR by its
// whole diff, which always includes the specs Spec committed to the same branch.
@id("Dev changes the code")
permit (principal, action == Factory::Action::"change", resource)
when { principal in [Factory::Station::"implement", Factory::Station::"revise"] };

@id("no station changes CI")
forbid (principal, action == Factory::Action::"change", resource)
when { resource.path like ".github/*" };

@id("no station changes lockfiles")
forbid (principal, action == Factory::Action::"change", resource)
when {
  resource.path like "pnpm-lock.yaml" || resource.path like "*/pnpm-lock.yaml" ||
  resource.path like "package-lock.json" || resource.path like "*/package-lock.json" ||
  resource.path like "yarn.lock" || resource.path like "*/yarn.lock" ||
  resource.path like "composer.lock" || resource.path like "*/composer.lock"
};
