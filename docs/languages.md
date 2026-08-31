---
title: Languages
description: Daily Dial speaks ten languages — and never translates a word you wrote.
---

# Ten languages

Daily Dial is available in English, Arabic, Chinese (Simplified), French, German, Hindi, Japanese, Portuguese (Brazil), Russian and Spanish.

## Which language you see

Chrome picks the app's language by your browser's language setting and falls back to English if your language isn't supported. You can override this choice in Settings → Appearance → Language. This setting exists for the case Chrome cannot cover: a browser set to one language by someone who wants to read the app in another.

## What gets translated—and what doesn't

Only the app's own words are translated. Notes, intentions, reflections, category names, and everything else you write stays exactly as you wrote it, in whatever language you wrote it. Nothing you write is ever machine-translated. The app speaks your language; your data stays yours.

## Category names on a fresh install

When you install Daily Dial for the first time, the six starting categories arrive in your language. But if you've already renamed them or logged any entries, nothing changes. From the moment you edit a category, those names are your data. Renaming a category you have months of history against would be worse than leaving it in English, so the app respects what you've already done.

## Layout for right-to-left languages

Arabic reads right to left, and Daily Dial mirrors its layout to match: the category column and the week move to the right, and the panel to the left. One thing does not mirror: the dial itself. A clock runs clockwise in every language, and 15:00 is 15:00 everywhere.

## Plural handling matters more than you might think

Every language has plural rules, but not every language has the same rules. English has two forms: "1 entry" and "2 entries." Russian needs four forms, each used in different contexts: one entry is "1 день," two to four are "2 дня," five and above are "5 дней," and the pattern resets at 21 "день" — the same form as one. Arabic needs six forms, including a special dual form for exactly two items. Japanese and Chinese need only one form, no plurals at all.

Why does this matter for translation. If you translate Daily Dial into Russian by copying English's two-form logic, you will show "2 дня" where one form is needed, "5 дней" where another is right, and the app will read wrong. A translator needs to know which plural form to use in each slot, and that knowledge lives in each language's grammar, not in English's. The build checks this: it derives the required plural forms from `Intl.PluralRules` for each language and fails the build if any are missing. This is why translation is not just word substitution—it is respecting how each language actually works.

## Dates and times

Dates and weekday names follow the language the app is displayed in, not your browser's locale. This keeps your data readable when the two don't match.

The time fields in Settings use Chrome's own `<input type="time">` control. Chrome draws this field from the browser's locale and ignores the page, so those fields may show "01:00 PM" even when the rest of the app is in another language or you have set it to 24-hour time. This is a Chrome limitation, not something the app can change.

## What stays in English by design

Two things are always in English, and for good reasons. CSV export headers stay in English because a file exported on a Hindi install has to import cleanly on an English one—that is a file format standard, not prose. The app name, "Daily Dial," stays in English because it is what people search the store for.

## Contributing translations

Translations are welcome. They are flat `{key: "text"}` files in `translations/`, and a script builds the Chrome catalogs. See the [contribution guide](https://github.com/pranav083/daily-dial-extension/blob/main/CONTRIBUTING.md) for details.

---

Spot something wrong in your language? [Open an issue](https://github.com/pranav083/daily-dial-extension/issues/new/choose) — a native reader's eye is worth more than any amount of checking.
