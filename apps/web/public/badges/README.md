# Store badges

Apple and Google allow only their official badge artwork. Until these files exist and `NEXT_PUBLIC_OFFICIAL_BADGES=1`
is set, the site shows Loopfield's own pills, which carry no Apple or Google marks.

| File | Where to get it | When it shows |
| --- | --- | --- |
| `app-store.svg` | Apple Marketing Tools: "Download on the App Store", black, English | iPhone store state `live` |
| `app-store-preorder.svg` | Apple Marketing Tools: "Pre-order on the App Store", black, English | iPhone store state `preorder` |
| `google-play.svg` | Google Play badge generator: "Get it on Google Play", English | Android store state `live` |
| `google-play-preregister.svg` | Google Play badge generator: "Pre-register on Google Play", English | Android store state `preorder` |

Rules the components already follow, so keep the files as supplied:

- Never redraw, recolour, tilt or animate a badge. Apple: the black badge whenever another platform's badge sits beside it,
  App Store first, at least 40 px tall, clear space of a quarter of its height, one App Store badge per layout.
- Google: clear space of a quarter of the badge's height, linked to the Google Play listing, only for an app available there.
  Check Google's current badge guidelines before launch.
- The footer carries both trademark lines.
