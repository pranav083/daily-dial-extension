/**
 * What people do about the patterns Daily Dial notices.
 *
 * Pure data, deliberately in its own module: `lib.js` decides *whether* a
 * pattern is present, and this file holds *what to do about it*. Keeping them
 * apart means the wording here can be argued over and rewritten without
 * touching any logic, and the detectors stay testable without importing prose.
 *
 * Three rules govern everything below.
 *
 * 1. **Approaches first, tools second.** "Block distracting sites during your
 *    focus hours" will still be true in ten years; "use SelfControl" is one
 *    acquisition away from being wrong. The approach is the advice; a tool is
 *    only ever an example of it.
 *
 * 2. **Bundled, never fetched.** This ships inside the extension. The moment
 *    it is downloaded from anywhere, Daily Dial stops being able to say it
 *    makes no network requests — which is the strongest claim it has. A link
 *    the user clicks is fine; a list the extension retrieves is not.
 *
 * 3. **Not everything is a software problem.** Two of the six entries here
 *    recommend no tool at all, and several recommend leaving the computer.
 *    A catalog that answers every observation with an app to install would be
 *    an app-recommendation engine wearing a time tracker's clothes.
 *
 * None of these tools are affiliated with Daily Dial, and none are endorsed —
 * they are named as examples of an approach, and the user is told as much.
 */

/**
 * Guides live on the project's docs site, not in here. They are long-form
 * prose with per-platform setup steps, which has no business being bundled
 * into an extension that has to translate every string it ships.
 *
 * @typedef {{name: string, platforms: string, url: string}} Tool
 * @typedef {{text: string, tools?: Tool[]}} Approach
 * @typedef {{guide?: string, leadKey: string, approaches: Approach[]}} Suggestion
 * @type {Record<string, Suggestion>}
 */
export const SUGGESTIONS = {
  /* Setting more intentions than you finish. The honest advice is to set
     fewer, not to try harder — so this one names no software at all. */
  intentionOvercommit: {
    leadKey: "sug_intentionOvercommit_lead",
    approaches: [
      { textKey: "sug_intentionOvercommit_text1" },
      { textKey: "sug_intentionOvercommit_text2" },
      { textKey: "sug_intentionOvercommit_text3" },
    ],
  },

  /* Two weeks with no rest logged at all. */
  noBreaks: {
    guide: "rest",
    leadKey: "sug_noBreaks_lead",
    approaches: [
      {
        textKey: "sug_noBreaks_text1",
        tools: [
          { name: "Stretchly", platformsKey: "sugPlat_Stretchly", url: "https://hovancik.net/stretchly/" },
          { name: "Time Out", platformsKey: "sugPlat_TimeOut", url: "https://www.dejal.com/timeout/" },
        ],
      },
      { textKey: "sug_noBreaks_text2" },
      { textKey: "sug_noBreaks_text3" },
    ],
  },

  /* The hour you're most productive in is the one you least often protect. */
  peakHoursUnprotected: {
    guide: "best-hour",
    leadKey: "sug_peakHoursUnprotected_lead",
    approaches: [
      { textKey: "sug_peakHoursUnprotected_text1" },
      {
        textKey: "sug_peakHoursUnprotected_text2",
        tools: [
          { name: "Focus modes", platformsKey: "sugPlat_Focusmodes", url: "https://support.apple.com/en-us/HT212608" },
          { name: "Digital Wellbeing — Focus mode", platformsKey: "sugPlat_DigitalWellbeingFocusmode", url: "https://wellbeing.google/" },
        ],
      },
      { textKey: "sug_peakHoursUnprotected_text3" },
      { textKey: "sug_peakHoursUnprotected_text4" },
    ],
  },

  /* Distraction time climbing week over week. */
  distractionTrend: {
    guide: "blocking-sites",
    leadKey: "sug_distractionTrend_lead",
    approaches: [
      {
        textKey: "sug_distractionTrend_text1",
        tools: [
          { name: "SelfControl", platformsKey: "sugPlat_SelfControl", url: "https://selfcontrolapp.com/" },
          { name: "Cold Turkey", platformsKey: "sugPlat_ColdTurkey", url: "https://getcoldturkey.com/" },
          { name: "Freedom", platformsKey: "sugPlat_Freedom", url: "https://freedom.to/" },
        ],
      },
      {
        textKey: "sug_distractionTrend_text2",
        tools: [
          { name: "one sec", platformsKey: "sugPlat_onesec", url: "https://one-sec.app/" },
        ],
      },
      {
        textKey: "sug_distractionTrend_text3",
        tools: [
          { name: "Assistive Access", platformsKey: "sugPlat_AssistiveAccess", url: "https://support.apple.com/en-us/HT213805" },
          { name: "Screen Time app limits", platformsKey: "sugPlat_ScreenTimeapplimits", url: "https://support.apple.com/en-us/HT208982" },
        ],
      },
      { textKey: "sug_distractionTrend_text4" },
      { textKey: "sug_distractionTrend_text5" },
    ],
  },

  /* Logging is thinning out. Points at this extension's own reminders,
     because the honest answer here is a habit fix, not another product. */
  coverageDecline: {
    leadKey: "sug_coverageDecline_lead",
    approaches: [
      { textKey: "sug_coverageDecline_text1" },
      { textKey: "sug_coverageDecline_text2" },
      { textKey: "sug_coverageDecline_text3" },
      { textKey: "sug_coverageDecline_text4" },
    ],
  },

  /* Everything logged sits in a few categories, with enabled ones unused.
     Categories are capped at six slots, so this can only ever suggest
     repurposing one — never adding one, which the app cannot do. */
  untrackedLifeArea: {
    leadKey: "sug_untrackedLifeArea_lead",
    approaches: [
      { textKey: "sug_untrackedLifeArea_text1" },
      { textKey: "sug_untrackedLifeArea_text2" },
      { textKey: "sug_untrackedLifeArea_text3" },
    ],
  },

  /* The daily target and a typical day have drifted apart. The only entry
     here about the app rather than the user, so it names no tool at all —
     the fix is a field in Settings, and recommending software for a problem
     this app created would be absurd. */
  targetMismatch: {
    leadKey: "sug_targetMismatch_lead",
    approaches: [
      { textKey: "sug_targetMismatch_text1" },
      { textKey: "sug_targetMismatch_text2" },
    ],
  },
};

/** Observation ids the user has silenced for good. Kept in its own storage
 *  key rather than in `settings`, since it is a growing list of dismissals
 *  rather than a preference, and it has no business travelling in a backup to
 *  another device where the patterns will be different. */
export const SILENCED_KEY = "silencedObservations";

/** Where a suggestion's long-form guide lives. */
export const GUIDE_BASE = "https://pranav083.github.io/daily-dial-extension/guides/";

/** @returns {Suggestion|null} */
export const suggestionFor = (key) => SUGGESTIONS[key] ?? null;
