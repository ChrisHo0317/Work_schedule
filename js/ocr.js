const OCR = (() => {
  async function recognizeGrid(imageFile, onProgress) {
    const worker = await Tesseract.createWorker("chi_tra", 1, {
      logger: (msg) => {
        if (onProgress) onProgress(msg);
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: "4" });
    try {
      const { data } = await worker.recognize(imageFile, {}, { blocks: true, text: true });
      const lines = [];
      (data.blocks || []).forEach((block) => {
        (block.paragraphs || []).forEach((para) => {
          (para.lines || []).forEach((line) => {
            lines.push({
              text: (line.text || "").trim(),
              bbox: line.bbox,
              words: (line.words || []).map((w) => ({ text: w.text, bbox: w.bbox })),
            });
          });
        });
      });
      return { lines, rawText: data.text || "" };
    } finally {
      await worker.terminate();
    }
  }

  return { recognizeGrid };
})();
