// Who may start a station. Everything not permitted here is ignored.

@id("allowed users may start any station")
permit (
  principal in Factory::Group::"allowed",
  action in [Factory::Action::"startTriage", Factory::Action::"startSpec", Factory::Action::"startImplement", Factory::Action::"startRevision", Factory::Action::"startReview"],
  resource
);

// Implementation needs a human: no bot, not even the factory's, may start it.
@id("the factory's bot continues chains that allowed users started")
permit (principal, action in [Factory::Action::"startSpec", Factory::Action::"startRevision"], resource)
when { principal.kind == "Bot" && resource.author in Factory::Group::"allowed" };

@id("the factory's bot sends PRs it marked ready to review")
permit (principal, action == Factory::Action::"startReview", resource)
when { principal.kind == "Bot" };

@id("only ready PRs from this repo are reviewed")
forbid (principal, action == Factory::Action::"startReview", resource)
when { resource.draft || resource.fromFork };

// Anyone who can merge has write access.
@id("a merged factory PR starts the cleanup")
permit (principal, action == Factory::Action::"startCleanup", resource)
when { resource.merged && !resource.fromFork };
