# Recent Progress on Bay Area Show Explorer

Bay Area Show Explorer has been moving from a simple imported concert list toward something more useful: a small local calendar with a real editorial workflow behind it.

The biggest shift is conceptual. I stopped treating every listing as an artist record. A show can now be an artist show, but it can also be a non-artist event: karaoke, trivia, poetry, open mics, game nights, themed dance nights, and other listings that belong on a calendar without pretending to be bands. That distinction sounds small, but it makes the whole system feel more honest. It gives the site room to represent more of what actually happens at local venues without muddying the artist database.

The admin tools have grown around that idea. There is now a Show Review area where listings can be cleaned up directly: show type, display name, details, event types, themes, sources, image links, and info links can all be edited in one place. Duplicate shows can be merged, source comparisons are available when they are useful, and the interface is becoming more compact so the review process feels less like wrestling a spreadsheet.

Artist and venue review have also become more practical. Records can be filtered by date, source, city, venue, and review needs, which makes it possible to focus on a specific week instead of staring at the whole database at once. That matters because the real goal is not to build a perfect database in the abstract. The goal is to efficiently verify the next useful slice of the calendar.

The public Show Explorer has improved too. The default feed now focuses on music listings, while non-music event types are still available through filters. Mike's Picks gives me a way to feature particular shows. The mobile layout has been getting special attention: filters are easier to reach, the sticky search controls are less jumpy, and narrow viewports now make better use of scarce horizontal space.

Another major success is source coverage. The project started with The List, and now also pulls in KALX calendar listings. Those sources are not interchangeable, and the site now treats them as distinct signals instead of flattening everything into one anonymous feed. That makes it easier to inspect where a listing came from and decide how much confidence to put in it.

There is also a basic admin login flow now. Locally, the admin area is protected by an access key and session cookie. That is a good step for development, but it is not the same as production auth. Before the admin area goes live, the project still needs a real deployed backend, likely through Netlify Functions, Clerk, or a small hosted Node service.

The part I am happiest about is that the app is becoming a tool for judgment rather than a machine that pretends certainty. Imported data is messy. Event titles contain artist names, venue names, dates, jokes, themes, and ticketing notes all mashed together. The project is getting better because it acknowledges that mess and gives me ways to sort, correct, merge, feature, and review records without throwing away the context.

Recent wins:

- Shows can now be classified as artist shows or event shows.
- Event types and themes are first-class data points.
- The public feed defaults to music while still supporting broader event discovery.
- KALX has joined The List as useful source material.
- Show Review can merge duplicates and preserve source context.
- Mike's Picks can feature selected shows in Show Explorer.
- The admin interface is becoming cleaner, denser, and easier to work through.
- Local admin login now exists, with a clearer path toward production auth.

Next, I want to keep tightening the review workflow and make deployment decisions carefully. The site is close enough to be worth backing up and sharing as a project, but the live admin story deserves one more thoughtful pass before it is exposed to the open web.
