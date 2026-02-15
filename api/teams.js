// api/teams.js
// Serverless endpoint: /api/teams?teamId=herren_w1
// Purpose (debug step): fetch PDF -> extract text using pdfjs-dist (no canvas) -> return preview JSON

const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const TEAM_MAP = {
  herren_w1: {
    source_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

async function extractTextFromPdf(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(" ");
    fullText += pageText + "\n";
  }
  return fullText;
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (m) => console.log(`[teams] +${Date.now() - t0}ms ${m}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const cfg = TEAM_MAP[teamId];
    if (!cfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    // Fetch PDF with timeout
    log("fetch pdf");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const r = await fetch(cfg.source_url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!r.ok) {
      return res.status(502).json({
        error: "pdf_fetch_failed",
        status: r.status,
        source_url: cfg.source_url,
      });
    }

    const ab = await r.arrayBuffer();
    log(`downloaded bytes=${ab.byteLength}`);

    log("extract text (pdfjs-dist)");
    const text = await extractTextFromPdf(ab);
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
    });
  }
};
