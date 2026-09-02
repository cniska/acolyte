import { describe, expect, test } from "bun:test";
import { chainedClaims, unquotedSpecifics, violatedMustNot } from "./distill-eval-checks";

// The two corruptions this eval exists to catch, recorded verbatim from the first import's corpus
// alongside the text of the turn each was distilled from. A check that cannot fail on these is
// hollow, so they are asserted before anything else the checks do.
const STALENESS_TURN = `The import staleness gate is a spending budget, not a correctness filter.
Default budget is 50 commits: a project may accrue that many commits past a session before its
tape stops earning what distilling it costs. Spend oldest-first, and --include-stale overrides.`;

const STALENESS_FACT =
  "Design decision from Fable: the import staleness gate is a spending budget, not a correctness filter. Default budget = 50 turns.";

const SOURCE_SEAM_TURN = `The unit of the contract is the session, not the file. ImportReader is replaced by a source
contract with listSessions and readSession. Planning needs only what gates a session, so listing
must not pay for exchanges. There is no --project flag and no per-source flag: other projects are
reached by standing in them and running the command again.`;

const SOURCE_SEAM_FACT =
  "Design decision: implement a transcript source seam with listTranscripts + loadTranscript and add a --source flag.";

describe("unquotedSpecifics", () => {
  test("flags a unit the turn never paired with the figure", () => {
    const found = unquotedSpecifics(STALENESS_FACT, STALENESS_TURN);
    expect(found).toContain("50 turns");
  });

  test("accepts the figure and unit the turn actually stated", () => {
    const fact = "The import staleness budget is 50 commits, and --include-stale overrides it.";
    expect(unquotedSpecifics(fact, STALENESS_TURN)).toEqual([]);
  });

  test("flags identifiers and flags the turn never contained", () => {
    const found = unquotedSpecifics(SOURCE_SEAM_FACT, SOURCE_SEAM_TURN);
    expect(found).toContain("listTranscripts");
    expect(found).toContain("loadTranscript");
    expect(found).toContain("--source");
  });

  test("accepts the identifiers the design actually settled on", () => {
    const fact = "The source contract replaces ImportReader with listSessions and readSession.";
    expect(unquotedSpecifics(fact, SOURCE_SEAM_TURN)).toEqual([]);
  });

  test("reads a spelled-out count as a figure", () => {
    const turn = "The release carries launcher.sh and launcher.sha256 plus seven platform tarballs.";
    expect(unquotedSpecifics("The release includes nine assets.", turn)).toContain("nine assets");
  });

  test("does not demand a unit for a version, which takes none", () => {
    const turn = "Release v0.27.0 is not a draft, and release.yml completed on all jobs.";
    expect(unquotedSpecifics("Release 0.27.0 includes the launcher and is not a draft.", turn)).toEqual([]);
  });

  test("does not flag a figure whose neighbor is a verb rather than a unit", () => {
    const turn = "git remains a system requirement at minimum 2.14 and mise has no plain git.";
    expect(unquotedSpecifics("git 2.14 remains required, and mise does not provide it.", turn)).toEqual([]);
  });

  test("flags a path the turn never named", () => {
    const turn = "The pinned Bun comes from mise.toml at the repository root.";
    expect(unquotedSpecifics("Bun is pinned in config/mise.toml.", turn)).toContain("config/mise.toml");
  });

  test("is case-sensitive on code tokens and insensitive on prose figures", () => {
    const turn = "The seam is TRANSCRIPT_SOURCES, and 50 commits is the budget.";
    expect(unquotedSpecifics("The seam is transcript_sources.", turn)).toContain("transcript_sources");
    expect(unquotedSpecifics("The budget is 50 Commits.", turn)).toEqual([]);
  });

  test("ignores whitespace and line breaks in the turn", () => {
    const turn = "The budget is 50\ncommits past the session.";
    expect(unquotedSpecifics("The budget is 50 commits.", turn)).toEqual([]);
  });
});

describe("chainedClaims", () => {
  test("flags the five-claim release record the corpus produced", () => {
    const fact =
      "the public installer at https://acolyte.sh/install now works: releases/latest resolves to v0.27.0; release v0.27.0 includes launcher.sh and nine assets; the release is not a draft or prerelease; release.yml completed successfully on all jobs";
    expect(chainedClaims(fact)).toBe(true);
  });

  test("leaves a single fact with one semicolon alone", () => {
    const fact = "git remains a system requirement at minimum 2.14; mise's registry has no plain git.";
    expect(chainedClaims(fact)).toBe(false);
  });

  test("leaves a fact with no semicolons alone", () => {
    expect(chainedClaims("The pre-push hook rejects placeholder author domains.")).toBe(false);
  });

  test("does not count semicolon-separated fragments that carry no verb", () => {
    const fact = "The release assets are launcher.sh; launcher.sha256; and nine platform tarballs.";
    expect(chainedClaims(fact)).toBe(false);
  });
});

describe("violatedMustNot", () => {
  test("catches a plan wearing the shape of a state", () => {
    const fact = "README.md includes a rationale sentence that should be removed from README.";
    expect(violatedMustNot(fact, ["/should be removed/i"])).toEqual(["/should be removed/i"]);
  });

  test("catches the measured prefixes", () => {
    expect(violatedMustNot("Plan: reorganize acolyte status.", ["/^plan:/i"])).toHaveLength(1);
    expect(violatedMustNot("User asked to have Fable plan the filters.", ["/^user asked/i"])).toHaveLength(1);
  });

  test("passes a fact that trips none of its labels", () => {
    expect(violatedMustNot("The tap is named cniska/homebrew-tap.", ["/^plan:/i", "/50\\s*turns/i"])).toEqual([]);
  });
});
