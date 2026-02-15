// api/teams.js
// /api/teams?teamId=herren_w1
// Fetch PDF -> extract text using pdf-lib (no canvas, no DOMMatrix)

const { PDFDocument } = require("pdf-lib");

const TEAM_MAP = {
  herren_w1: {
    source_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

async function extractTextPdfLib(arrayBuffer) {
  const pdfBytes = new Uint8Array(arrayBuffer);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  // pdf-lib hat keine "one-liner" Text-API, aber wir können den Content stream lesen.
  // Das ist ein pragmatischer Ansatz: alle Contents (Operators) sammeln und Strings extrahieren.
  // Für viele "Text PDFs" funktioniert das ausreichend, um Match-/Tabellenzeilen zu parsen.

  let out = "";

  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    const contentStream = await page.node.Contents();
    if (!contentStream) continue;

    // Contents kann ein Stream oder Array sein
    const streams = Array.isArray(contentStream) ? contentStream : [contentStream];

    for (const s of streams) {
      const raw = s.contents ? s.contents : s; // defensive
      // pdf-lib intern: wir versuchen an den decoded stream zu kommen
      let decoded;
      try {
        decoded = raw.decode ? raw.decode() : raw;
      } catch {
        decoded = raw;
      }

      // decoded kann Uint8Array sein
      const buf =
        decoded instanceof Uint8Array
          ? decoded
          : decoded?.contents instanceof Uint8Array
          ? decoded.contents
          : null;

      if (!buf) continue;

      const str = Buffer.from(buf).toString("latin1"); // pdf operators sind oft latin1
      out += str + "\n";
    }

    out += "\n---PAGE---\n";
  }

  // Jetzt sind das noch PDF-Operatoren. Wir extrahieren daraus die Strings in Klammern: (text)
  // und Hex-Strings <...> die häufig Text enthalten.
  const texts = [];

  // ( ... ) Strings (mit escaped Klammern)
  const reParen = /\((?:\\.|[^\\)])*\)/g;
  let m;
  while ((m = reParen.exec(out)) !== null) {
    const t = m[0].slice(1, -1).replace(/\\([()\\nrtbf])/g, "$1");
    if (t.trim()) texts.push(t);
  }

  // <...> Hex strings (häufig UTF-16BE oder latin1)
  const reHex = /<([0-9A-Fa-f]+)>/g;
  while ((m = reHex.exec(out)) !== null) {
    const hex = m[1];
    if (hex.length < 4) continue;
    try {
      const bytes = Buffer.from(hex, "hex");
      // Heuristik: UTF-16BE wenn viele 00 Bytes
      const zeroCount = [...bytes].filter((b) => b === 0).length;
      let t = "";
      if (zeroCount > bytes.length * 0.2) {
        t = bytes.toString("utf16le"); // oft klappt's, sonst fallback
      } else {
        t = bytes.toString("latin1");
      }
      t = t.replace(/\u0000/g, "").trim();
      if (t) texts.push(t);
    } catch {}
  }

  return texts.join("\n");
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (m) => console.log(`[teams] +${Date.now() - t0}ms ${m}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const cfg = TEAM_MAP[teamId];
    if (!cfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    log("fetch pdf");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(cfg.source_url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!r.ok) {
      return res.status(502).json({ error: "pdf_fetch_failed", status: r.status });
    }

    const ab = await r.arrayBuffer();
    log(`downloaded bytes=${ab.byteLength}`);

    log("extract text (pdf-lib)");
    const text = await extractTextPdfLib(ab);
    log(`textLen=${text.length}`);

    return res.status(200).json({
      ok: true,
      teamId,
      source_url: cfg.source_url,
      ms: Date.now() - t0,
      text_preview: text.slice(0, 1200),
    });
  } catch (err) {
    console.error("[teams] error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err?.message || String(err),
      stack: (err?.stack || "").split("\n").slice(0, 6),
    });
  }
};
