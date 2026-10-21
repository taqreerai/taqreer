// Equal-height peers - runs in the bake render session right before the flow
// shots of the freeze (2026-10-21).
//
// WHY: cards side by side in one row read as a set only when they share one
// height. The model often writes align-items:start on a card row (the NO EMPTY
// CARDS rule pushed it there), so every card hugs its own text and a row of
// three ends up with three different heights (owner, project
// cmvhxq5yt001b2z6d9qft4ejc slide 4). The freeze then pins those heights.
//
// WHAT: a grid or row-flex container whose visible children are ALL painted
// boxes (background, border or shadow) and that has a row whose boxes differ
// in height by more than TOL px gets align-items:stretch, and each box
// align-self:stretch. A row's height is already its tallest box, so this only
// grows the shorter boxes to it; the spare space falls at their bottom.
//
// GUARANTEE - never move anything else: when the container's own box changes
// size after the stretch (it should not), every inline style is restored.
// Boxes with an explicit height do not stretch (CSS rule) and are left alone.

export const EQUALIZE_PEERS_SCRIPT = `
function __tqEqualizePeers(well) {
  var TOL = 4;
  var out = { rows: 0 };
  var opaqueish = function (c) {
    if (!c) return false;
    if (c.indexOf("rgba") === 0) return parseFloat(c.slice(c.lastIndexOf(",") + 1)) > 0.05;
    return c.indexOf("rgb(") === 0;
  };
  var painted = function (cs) {
    if (cs.backgroundImage !== "none" || opaqueish(cs.backgroundColor)) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    var sides = ["Top", "Right", "Bottom", "Left"];
    for (var i = 0; i < sides.length; i++) {
      if (parseFloat(cs["border" + sides[i] + "Width"]) >= 1 && cs["border" + sides[i] + "Style"] !== "none" && opaqueish(cs["border" + sides[i] + "Color"])) return true;
    }
    return false;
  };
  var all = well.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var box = all[i];
    var cs = getComputedStyle(box);
    var isGrid = cs.display === "grid" || cs.display === "inline-grid";
    var isRow = (cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection.indexOf("row") === 0;
    if (!isGrid && !isRow) continue;
    var kids = Array.prototype.filter.call(box.children, function (k) {
      var kcs = getComputedStyle(k);
      return kcs.display !== "none" && kcs.position !== "absolute" && kcs.position !== "fixed";
    });
    if (kids.length < 2) continue;
    if (!kids.every(function (k) { return painted(getComputedStyle(k)); })) continue;
    // Group by row (same top) and look for an uneven row.
    var rows = {};
    kids.forEach(function (k) {
      var r = k.getBoundingClientRect();
      var key = Math.round(r.top / 8);
      (rows[key] = rows[key] || []).push(r.height);
    });
    var uneven = Object.keys(rows).some(function (key) {
      var hs = rows[key];
      return hs.length > 1 && Math.max.apply(null, hs) - Math.min.apply(null, hs) > TOL;
    });
    if (!uneven) continue;
    var before = box.getBoundingClientRect();
    var saved = [[box, box.style.alignItems]].concat(kids.map(function (k) { return [k, k.style.alignSelf]; }));
    box.style.alignItems = "stretch";
    kids.forEach(function (k) { k.style.alignSelf = "stretch"; });
    var after = box.getBoundingClientRect();
    if (Math.abs(after.height - before.height) > 1 || Math.abs(after.width - before.width) > 1) {
      box.style.alignItems = saved[0][1];
      for (var s = 1; s < saved.length; s++) saved[s][0].style.alignSelf = saved[s][1];
      continue;
    }
    out.rows += 1;
  }
  return out;
}
`;
