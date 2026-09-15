# Ambience

Canvas ambience streams multi-hour **nature recordings** remotely (Internet Archive),
via progressive `HTMLAudioElement` playback. Tracks loop when they finish.

Current scenes (see `src/data/ambienceCatalog.ts`):

- Gentle night rain (~3h)
- Beachfront ocean waves (~3h, lighter shore surf)
- Evening thunderstorm (~3h)
- Campfire / firewood crackle (~12 min fireplace, Freesound CC0, buffered + optional amplify)
- Winter blizzard / wind & snow (~6.5 min hilltop + ~3 min snowstorm fallback, Freesound CC0)
- Soft steam train carriage (~1.3 min Swanage Railway passenger takes, Freesound CC0, streams)

No multi-hundred-MB files are committed to the repo. Playback needs network access
to `archive.org` / `cdn.freesound.org`. Short Freesound previews are fully buffered
to a blob before play (avoids CDN underrun stutter); multi-hour Archive tracks stream.
Player chrome adapted from Digital Stillness (`rain.html`).
