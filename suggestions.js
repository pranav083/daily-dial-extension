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
 * @typedef {{name: string, platforms: string, url: string}} Tool
 * @typedef {{text: string, tools?: Tool[]}} Approach
 * @typedef {{lead: string, approaches: Approach[]}} Suggestion
 * @type {Record<string, Suggestion>}
 */
export const SUGGESTIONS = {
  /* Setting more intentions than you finish. The honest advice is to set
     fewer, not to try harder — so this one names no software at all. */
  intentionOvercommit: {
    lead: "Three or four things you actually finish beats ten you meant to.",
    approaches: [
      { text: "Set fewer. One thing that must happen, and two that would be good, is a full day for most people." },
      { text: "Make each one small enough to finish in a sitting — \"draft the email\" rather than \"sort out the application\"." },
      { text: "Move the ones that keep rolling over into a single \"someday\" note, so they stop reappearing as today's failure." },
    ],
  },

  /* Two weeks with no rest logged at all. */
  noBreaks: {
    lead: "Rest that never gets logged tends to be rest that never happens.",
    approaches: [
      {
        text: "Put breaks on a timer, so stopping isn't a decision you have to make while concentrating.",
        tools: [
          { name: "Stretchly", platforms: "Windows · macOS · Linux · free, open source", url: "https://hovancik.net/stretchly/" },
          { name: "Time Out", platforms: "macOS · free", url: "https://www.dejal.com/timeout/" },
        ],
      },
      { text: "Take the break away from the screen entirely — a walk, food, or anything that isn't another window." },
      { text: "If you're already resting but not logging it, log it. A day that reads as sixteen unbroken hours isn't the day you had." },
    ],
  },

  /* The hour you're most productive in is the one you least often protect. */
  peakHoursUnprotected: {
    lead: "The hour you're best in is worth defending before anything else gets to claim it.",
    approaches: [
      { text: "Block it in whatever calendar other people can see, so the time is taken before someone else takes it." },
      {
        text: "Silence everything for that hour, rather than relying on not looking.",
        tools: [
          { name: "Focus modes", platforms: "macOS · iOS · built in", url: "https://support.apple.com/en-us/HT212608" },
          { name: "Digital Wellbeing — Focus mode", platforms: "Android · built in", url: "https://wellbeing.google/" },
        ],
      },
      { text: "Start the hardest thing of the day in that window, not the easiest. The easy work will survive being done at a worse hour; the hard work often won't." },
      { text: "If you can, change where you are for that hour. A different room or a library does more than most software." },
    ],
  },

  /* Distraction time climbing week over week. */
  distractionTrend: {
    lead: "Rising distraction is usually a friction problem rather than a willpower one — the aim is to make the easy thing slightly harder.",
    approaches: [
      {
        text: "Block the sites that take the time, but only during the hours you actually want to work — an all-day block tends to get switched off entirely.",
        tools: [
          { name: "SelfControl", platforms: "macOS · free, open source", url: "https://selfcontrolapp.com/" },
          { name: "Cold Turkey", platforms: "Windows · macOS · free tier", url: "https://getcoldturkey.com/" },
          { name: "Freedom", platforms: "Windows · macOS · iOS · Android · paid", url: "https://freedom.to/" },
        ],
      },
      {
        text: "Add a pause before the app opens, instead of blocking it. A few seconds of friction removes most of the opening-it-without-deciding-to.",
        tools: [
          { name: "one sec", platforms: "iOS · Android · free tier", url: "https://one-sec.app/" },
        ],
      },
      {
        text: "Make the phone boring for a while rather than forbidden.",
        tools: [
          { name: "Assistive Access", platforms: "iOS 17+ · built in — reduces the phone to a few large, simple apps", url: "https://support.apple.com/en-us/HT213805" },
          { name: "Screen Time app limits", platforms: "iOS · macOS · built in", url: "https://support.apple.com/en-us/HT208982" },
        ],
      },
      { text: "Put the phone in another room while you work. Unglamorous, free, and more reliable than anything you can install on the device you're trying to avoid." },
      { text: "Replace rather than remove — decide what the time goes to instead, or it tends to find its way back." },
    ],
  },

  /* Logging is thinning out. Points at this extension's own reminders,
     because the honest answer here is a habit fix, not another product. */
  coverageDecline: {
    lead: "Logging less is usually the first sign of a stretch going badly — and the thing that makes it hard to see how badly.",
    approaches: [
      { text: "Log at two or three fixed points in the day rather than reconstructing it at midnight. Daily Dial's own reminders (Settings → Reminders) exist for this." },
      { text: "Log roughly rather than not at all. An approximate day is worth far more than a blank one, and you can always sharpen it." },
      { text: "Use \"The day, end to end\" below the dial to fill gaps in a couple of minutes — the rows are already there, they just need words." },
      { text: "If it's stopped being worth the effort, that's worth knowing too. A tracker you resent is one you'll abandon." },
    ],
  },

  /* Everything logged sits in a few categories, with enabled ones unused.
     Categories are capped at six slots, so this can only ever suggest
     repurposing one — never adding one, which the app cannot do. */
  untrackedLifeArea: {
    lead: "What isn't a category can't show up in any of these numbers — and what doesn't show up is easy to let slide.",
    approaches: [
      { text: "Rename a category you don't use to cover something that's missing — time with other people, exercise, sleep, or anything you'd want to be honest with yourself about (Settings → Categories)." },
      { text: "Give it a neutral weight rather than a productive one. The point is to see it, not to score it." },
      { text: "Once it's a category, the goals and History trends you already have will do the rest without any further effort." },
    ],
  },
};

/** Observation ids the user has silenced for good. Kept in its own storage
 *  key rather than in `settings`, since it is a growing list of dismissals
 *  rather than a preference, and it has no business travelling in a backup to
 *  another device where the patterns will be different. */
export const SILENCED_KEY = "silencedObservations";

/** @returns {Suggestion|null} */
export const suggestionFor = (key) => SUGGESTIONS[key] ?? null;
