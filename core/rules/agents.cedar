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

@id("Dev changes the code")
permit (principal, action == Factory::Action::"change", resource)
when { principal in [Factory::Station::"implement", Factory::Station::"revise"] };

@id("Dev leaves the approved specs alone")
forbid (principal, action == Factory::Action::"change", resource)
when { principal in [Factory::Station::"implement", Factory::Station::"revise"] && resource.path like "specs/*" };

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
