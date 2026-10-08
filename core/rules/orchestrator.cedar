// The orchestrator's decisions about PRs and sandboxes.

// A revision may rightly change nothing: it goes back to Review. A first implementation must change something.
@id("Dev's PR is ready once verified, within its allowed changes")
permit (principal == Factory::Station::"revise", action == Factory::Action::"markReady", resource)
when { context.verifyPassed && context.changesAllowed };

@id("a first implementation is ready once verified, within its allowed changes, and not empty")
permit (principal == Factory::Station::"implement", action == Factory::Action::"markReady", resource)
when { context.verifyPassed && context.changesAllowed && context.changedSomething };

@id("Review sends a PR back to Dev, up to three rounds")
permit (principal == Factory::Station::"review", action == Factory::Action::"sendBackToDev", resource)
when { context.verdict == "changes-requested" && context.reviewRounds < 3 };

@id("a merged PR's sandbox is deleted")
permit (principal == Factory::Station::"cleanup", action == Factory::Action::"deleteSandbox", resource)
when { resource.merged && !resource.fromFork };
