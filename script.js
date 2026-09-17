(function () {
  "use strict";

  // ---------- State ----------

  const state = {
    text: "",
    shape: "circle",
    font: "Inter",
    ringSpacing: 1.5, // radius growth per revolution, as a multiple of font size
    fontSize: 26,
    spacing: 2,
    rotationDeg: 0,
    ink: "#1d1d1f",
    paper: "#ffffff",
  };

  const FONTS = ["Inter", "Playfair Display", "Pacifico", "Bebas Neue", "Space Mono", "Caveat"];

  // ---------- Shape paths ----------
  // Each function takes t in [0,1) and returns one revolution of the shape
  // in roughly [-1,1] unit space. buildLUT() below re-samples it to even
  // arc-length spacing, and the spiral engine scales it by a growing radius.

  function circlePoint(t) {
    const a = t * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  function squarePoint(t) {
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const p = t * 4;
    const seg = Math.min(3, Math.floor(p));
    const f = p - seg;
    const a = corners[seg];
    const b = corners[(seg + 1) % 4];
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f };
  }

  function trianglePoint(t) {
    const verts = [0, 1, 2].map((i) => {
      const a = -Math.PI / 2 + i * ((Math.PI * 2) / 3);
      return [Math.cos(a), Math.sin(a)];
    });
    const p = t * 3;
    const seg = Math.min(2, Math.floor(p));
    const f = p - seg;
    const a = verts[seg];
    const b = verts[(seg + 1) % 3];
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f };
  }

  function heartPoint(t) {
    const a = t * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(a), 3);
    const y =
      13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
    // Normalize to roughly [-1,1] and flip y so the point sits at the bottom on screen.
    return { x: x / 17, y: -y / 17 };
  }

  const SHAPES = {
    circle: circlePoint,
    square: squarePoint,
    triangle: trianglePoint,
    heart: heartPoint,
  };

  // ---------- Arc-length lookup table ----------
  // Lets us walk one revolution of any shape at even spacing, regardless of
  // how unevenly its raw parametrization moves.

  function buildLUT(fn, samples) {
    samples = samples || 1440;
    const pts = new Array(samples + 1);
    for (let i = 0; i <= samples; i++) pts[i] = fn(i / samples);

    const cum = new Array(samples + 1);
    cum[0] = 0;
    for (let i = 1; i <= samples; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }

    return { pts, cum, total: cum[samples], samples };
  }

  const lutCache = {};
  function getLUT(shape) {
    if (!lutCache[shape]) lutCache[shape] = buildLUT(SHAPES[shape]);
    return lutCache[shape];
  }

  function pointAtFraction(lut, frac) {
    let f = frac % 1;
    if (f < 0) f += 1;
    const target = f * lut.total;

    let lo = 0,
      hi = lut.samples;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lut.cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const segLen = lut.cum[i] - lut.cum[i - 1] || 1e-6;
    const segFrac = (target - lut.cum[i - 1]) / segLen;
    const p0 = lut.pts[i - 1];
    const p1 = lut.pts[i];

    const x = p0.x + (p1.x - p0.x) * segFrac;
    const y = p0.y + (p1.y - p0.y) * segFrac;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    return { x, y, angle };
  }

  // ---------- Spiral layout ----------
  // Walks the whole (trimmed, non-repeating) text once, growing the radius
  // by `ringSpacing * fontSize` every revolution. Returns glyph placements
  // in an unscaled coordinate space; draw() fits and centers them after.

  function layoutSpiral() {
    const raw = state.text.replace(/\s+/g, "  ").trim();
    if (!raw) return { glyphs: [], fontSizeBase: state.fontSize };

    const lut = getLUT(state.shape);
    const fontSizeBase = state.fontSize;
    ctx.font = `${fontSizeBase}px "${state.font}"`;

    const growthPerRev = fontSizeBase * state.ringSpacing;
    const Rstart = fontSizeBase * 0.25;
    const minGapPx = fontSizeBase * 0.62;
    const rotationFrac = state.rotationDeg / 360;

    const radiusAt = (revCount) => Rstart + growthPerRev * revCount;

    let unitTraveled = 0;
    let prevX = null;
    let prevY = null;
    const glyphs = [];

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const chWidth = ctx.measureText(ch).width;

      // Step to the character's center.
      let revCount = unitTraveled / lut.total;
      let R = radiusAt(revCount);
      unitTraveled += chWidth / 2 / Math.max(R, 1e-3);

      revCount = unitTraveled / lut.total;
      R = radiusAt(revCount);
      let frac = revCount - Math.floor(revCount);
      let pt = pointAtFraction(lut, frac + rotationFrac);
      let x = pt.x * R;
      let y = pt.y * R;

      // Wherever the *real* distance to the previously placed letter is too
      // small - whether from a sharp corner folding the path back on
      // itself, a cusp (like the heart's bottom point, where distance from
      // it grows quadratically rather than linearly with arc length), or
      // simply a tight radius near the spiral's center - nudge forward in
      // small steps until there's enough room to read both letters.
      if (ch !== " " && prevX !== null) {
        let guard = 0;
        while (Math.hypot(x - prevX, y - prevY) < minGapPx && guard < 80) {
          unitTraveled += (fontSizeBase * 0.08) / Math.max(R, 1e-3);
          revCount = unitTraveled / lut.total;
          R = radiusAt(revCount);
          frac = revCount - Math.floor(revCount);
          pt = pointAtFraction(lut, frac + rotationFrac);
          x = pt.x * R;
          y = pt.y * R;
          guard++;
        }
      }

      if (ch !== " ") {
        glyphs.push({ ch, x, y, angle: pt.angle });
        prevX = x;
        prevY = y;
      }

      // Step past the character's remaining half-width plus letter spacing.
      unitTraveled += (chWidth / 2 + state.spacing) / Math.max(R, 1e-3);
    }

    return { glyphs, fontSizeBase, finalUnit: unitTraveled, lut, radiusAt, rotationFrac };
  }

  // ---------- Rendering ----------

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  function draw() {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = state.paper;
    ctx.fillRect(0, 0, w, h);

    const layout = layoutSpiral();
    const { glyphs, fontSizeBase } = layout;

    ctx.save();
    ctx.translate(w / 2, h / 2);

    if (glyphs.length) {
      // Fit the whole spiral inside the canvas, regardless of text length.
      let maxR = fontSizeBase; // floor, so 1-2 characters don't blow up the zoom
      for (const g of glyphs) {
        const r = Math.hypot(g.x, g.y);
        if (r > maxR) maxR = r;
      }
      maxR += fontSizeBase * 0.6;

      const canvasHalf = Math.min(w, h) / 2;
      const targetR = canvasHalf * 0.94;
      const scale = targetR / maxR;

      ctx.scale(scale, scale);

      // Faint guide along the spiral path itself.
      if (layout.lut && layout.finalUnit > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.06)";
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([4 / scale, 6 / scale]);
        ctx.beginPath();
        const steps = 800;
        for (let i = 0; i <= steps; i++) {
          const u = (layout.finalUnit * i) / steps;
          const revCount = u / layout.lut.total;
          const frac = revCount - Math.floor(revCount);
          const R = layout.radiusAt(revCount);
          const pt = pointAtFraction(layout.lut, frac + layout.rotationFrac);
          const x = pt.x * R;
          const y = pt.y * R;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      ctx.font = `${fontSizeBase}px "${state.font}"`;
      ctx.fillStyle = state.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const g of glyphs) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.angle);
        ctx.fillText(g.ch, 0, 0);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // ---------- Fonts ----------

  function preloadFonts() {
    const loaders = FONTS.map((f) =>
      document.fonts.load(`48px "${f}"`).catch(() => {})
    );
    return Promise.all(loaders);
  }

  // ---------- Controls ----------

  const textInput = document.getElementById("textInput");
  const fontSelect = document.getElementById("fontSelect");
  const ringRange = document.getElementById("ringRange");
  const fontSizeRange = document.getElementById("fontSizeRange");
  const spacingRange = document.getElementById("spacingRange");
  const rotationRange = document.getElementById("rotationRange");
  const textColor = document.getElementById("textColor");
  const bgColor = document.getElementById("bgColor");
  const exportBtn = document.getElementById("exportBtn");
  const shapeButtons = Array.from(document.querySelectorAll(".shape-btn"));

  const ringValue = document.getElementById("ringValue");
  const fontSizeValue = document.getElementById("fontSizeValue");
  const spacingValue = document.getElementById("spacingValue");
  const rotationValue = document.getElementById("rotationValue");

  state.text = textInput.value;
  state.fontSize = Number(fontSizeRange.value);
  state.ringSpacing = Number(ringRange.value);

  textInput.addEventListener("input", () => {
    state.text = textInput.value;
    draw();
  });

  fontSelect.addEventListener("change", () => {
    state.font = fontSelect.value;
    document.fonts.load(`${state.fontSize}px "${state.font}"`).finally(draw);
  });

  ringRange.addEventListener("input", () => {
    state.ringSpacing = Number(ringRange.value);
    ringValue.textContent = state.ringSpacing.toFixed(1);
    draw();
  });

  fontSizeRange.addEventListener("input", () => {
    state.fontSize = Number(fontSizeRange.value);
    fontSizeValue.textContent = state.fontSize;
    draw();
  });

  spacingRange.addEventListener("input", () => {
    state.spacing = Number(spacingRange.value);
    spacingValue.textContent = state.spacing;
    draw();
  });

  rotationRange.addEventListener("input", () => {
    state.rotationDeg = Number(rotationRange.value);
    rotationValue.textContent = state.rotationDeg;
    draw();
  });

  textColor.addEventListener("input", () => {
    state.ink = textColor.value;
    draw();
  });

  bgColor.addEventListener("input", () => {
    state.paper = bgColor.value;
    draw();
  });

  shapeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      shapeButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.shape = btn.dataset.shape;
      draw();
    });
  });

  // ---------- Export ----------

  async function exportPDF() {
    if (!window.jspdf) {
      alert("The PDF library didn't load. Check your connection and try again.");
      return;
    }
    exportBtn.disabled = true;
    const originalLabel = exportBtn.textContent;
    exportBtn.textContent = "Preparing…";

    try {
      const { jsPDF } = window.jspdf;
      const pageSize = 200; // mm, square page
      const doc = new jsPDF({ unit: "mm", format: [pageSize, pageSize] });
      const imgData = canvas.toDataURL("image/png", 1.0);
      doc.addImage(imgData, "PNG", 0, 0, pageSize, pageSize);

      const safeText = (state.text.trim() || "letter")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 24);
      doc.save(`shapeletters-${state.shape}-${safeText || "letter"}.pdf`);
    } catch (err) {
      alert("Something went wrong exporting the PDF. Please try again.");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalLabel;
    }
  }

  exportBtn.addEventListener("click", exportPDF);

  // ---------- Init ----------

  draw();
  preloadFonts().then(draw);
})();
