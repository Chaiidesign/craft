// Card layout, top to bottom: a tinted hero banner holding the avatar (50% of the card), the
// details — name, "by" line, description (35%) — and the action row (15%). Heights are px so the
// auto-height template/community variants keep the same banner and action row.

// Fixed height for default/draft cards so every card in a grid lines up
// regardless of description length or which badges/footer content is
// present — the footer is pinned to the bottom of this via marginTop:'auto'
// rather than sitting wherever the content above happens to end.
export const CARD_HEIGHT = 320
export const CARD_RADIUS = 20
export const HERO_HEIGHT = CARD_HEIGHT * 0.5
export const ACTION_HEIGHT = CARD_HEIGHT * 0.15
export const AVATAR_SIZE = 110
/** The hero sits this far in from the card's top and sides, like a screen in a bezel. */
export const HERO_INSET = 6
