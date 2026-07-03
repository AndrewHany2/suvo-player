/**
 * Pure D-pad navigation reducer for the TV player's settings row + menus.
 *
 * The component owns which icons are present and what each menu contains; this
 * module only moves a focus index across the row, an item index within an open
 * menu, and signals when to apply a selection.
 *
 * State: { focus, inMenu, menuIndex }
 *   focus     -1 = not in the settings row; >=0 = index into the visible icon row
 *   inMenu    true when a menu is open for the focused icon
 *   menuIndex highlighted item index within the open menu
 *
 * Only consulted while IN the settings surface (focus >= 0 or inMenu). Entering
 * the row (focus -1 -> 0) and all legacy transport keys stay in the component.
 */

const INITIAL_TV_NAV = { focus: -1, inMenu: false, menuIndex: 0 };

/**
 * @param {{focus:number, inMenu:boolean, menuIndex:number}} state
 * @param {'left'|'right'|'up'|'down'|'ok'|'back'} key
 * @param {{iconCount:number, menuLen:number, initialMenuIndex:number}} ctx
 * @returns {{ state: {focus:number,inMenu:boolean,menuIndex:number}, effect: null | {type:'apply', index:number} }}
 */
function tvNavReduce(state, key, ctx) {
  const { focus, inMenu, menuIndex } = state;
  const iconCount = Math.max(0, (ctx && ctx.iconCount) || 0);
  const menuLen = Math.max(0, (ctx && ctx.menuLen) || 0);

  if (inMenu) {
    switch (key) {
      case "up":
        return { state: { ...state, menuIndex: Math.max(0, menuIndex - 1) }, effect: null };
      case "down":
        return { state: { ...state, menuIndex: Math.min(menuLen - 1, menuIndex + 1) }, effect: null };
      case "ok":
        return { state: { ...state, inMenu: false }, effect: { type: "apply", index: menuIndex } };
      case "back":
        return { state: { ...state, inMenu: false }, effect: null };
      default:
        return { state, effect: null };
    }
  }

  // In the row (focus >= 0), no menu open.
  switch (key) {
    case "left":
      return { state: { ...state, focus: Math.max(0, focus - 1) }, effect: null };
    case "right":
      return { state: { ...state, focus: Math.min(iconCount - 1, focus + 1) }, effect: null };
    case "ok":
      return {
        state: { ...state, inMenu: true, menuIndex: Math.max(0, (ctx && ctx.initialMenuIndex) || 0) },
        effect: null,
      };
    case "down":
    case "back":
      return { state: { ...state, focus: -1 }, effect: null };
    default:
      return { state, effect: null };
  }
}

module.exports = { INITIAL_TV_NAV, tvNavReduce };
