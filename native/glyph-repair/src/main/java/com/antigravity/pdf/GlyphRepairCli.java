package com.antigravity.pdf;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.BufferedWriter;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

import org.apache.fontbox.cmap.CMap;
import org.apache.fontbox.ttf.CmapLookup;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.contentstream.PDFStreamEngine;
import org.apache.pdfbox.contentstream.operator.DrawObject;
import org.apache.pdfbox.contentstream.operator.Operator;
import org.apache.pdfbox.contentstream.operator.OperatorName;
import org.apache.pdfbox.contentstream.operator.state.Concatenate;
import org.apache.pdfbox.contentstream.operator.state.Restore;
import org.apache.pdfbox.contentstream.operator.state.Save;
import org.apache.pdfbox.contentstream.operator.state.SetGraphicsStateParameters;
import org.apache.pdfbox.contentstream.operator.state.SetMatrix;
import org.apache.pdfbox.contentstream.operator.text.BeginText;
import org.apache.pdfbox.contentstream.operator.text.EndText;
import org.apache.pdfbox.contentstream.operator.text.MoveText;
import org.apache.pdfbox.contentstream.operator.text.MoveTextSetLeading;
import org.apache.pdfbox.contentstream.operator.text.NextLine;
import org.apache.pdfbox.contentstream.operator.text.SetCharSpacing;
import org.apache.pdfbox.contentstream.operator.text.SetFontAndSize;
import org.apache.pdfbox.contentstream.operator.text.SetTextHorizontalScaling;
import org.apache.pdfbox.contentstream.operator.text.SetTextLeading;
import org.apache.pdfbox.contentstream.operator.text.SetTextRenderingMode;
import org.apache.pdfbox.contentstream.operator.text.SetTextRise;
import org.apache.pdfbox.contentstream.operator.text.SetWordSpacing;
import org.apache.pdfbox.contentstream.operator.text.ShowText;
import org.apache.pdfbox.contentstream.operator.text.ShowTextAdjusted;
import org.apache.pdfbox.contentstream.operator.text.ShowTextLine;
import org.apache.pdfbox.contentstream.operator.text.ShowTextLineAndSpace;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.cos.COSStream;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.font.PDCIDFont;
import org.apache.pdfbox.pdmodel.font.PDCIDSystemInfo;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDSimpleFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.PDTrueTypeFont;
import org.apache.pdfbox.pdmodel.font.encoding.GlyphList;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.util.Matrix;
import org.apache.pdfbox.util.Vector;

public final class GlyphRepairCli {
  private static final int MAX_GLYPH_SAMPLES_PER_FONT = 24;

  private GlyphRepairCli() {
  }

  public static void main(String[] args) {
    try {
      CliOptions options = CliOptions.parse(args);
      if ("diagnose".equals(options.command)) {
        GlyphDiagnosticsReport report = diagnose(options);
        System.out.println(report.toJson());
      } else if ("repair".equals(options.command)) {
        GlyphRepairReport report = repair(options);
        System.out.println(report.toJson());
      } else {
        throw new IllegalArgumentException("Unknown command: " + options.command);
      }
    } catch (Exception err) {
      System.err.println(err.getMessage());
      System.exit(2);
    }
  }

  private static GlyphDiagnosticsReport diagnose(CliOptions options) throws IOException {
    try (PDDocument document = Loader.loadPDF(options.inputFile)) {
      List<Integer> pages = options.resolvePages(document.getNumberOfPages());
      List<PageGlyphReport> pageReports = new ArrayList<>();

      for (int pageNumber : pages) {
        PDPage page = document.getPage(pageNumber - 1);
        GlyphDiagnosticsEngine engine = new GlyphDiagnosticsEngine(pageNumber);
        engine.processPage(page);
        pageReports.add(engine.toReport());
      }

      return new GlyphDiagnosticsReport(
        document.getNumberOfPages(),
        document.isEncrypted(),
        document.getSignatureDictionaries().size(),
        pageReports
      );
    }
  }

  private static GlyphRepairReport repair(CliOptions options) throws IOException {
    if (options.outputFile == null) {
      throw new IllegalArgumentException("Repair requires --output <pdf>.");
    }

    try (PDDocument document = Loader.loadPDF(options.inputFile)) {
      List<Integer> pages = options.resolvePages(document.getNumberOfPages());
      int signatureCount = document.getSignatureDictionaries().size();
      boolean protectedDocument = document.isEncrypted() || signatureCount > 0;
      String ocrText = options.readOcrText();
      Map<Integer, String> beforeText = extractPageText(document, pages);
      Map<Integer, BufferedImage> beforeImages = renderPages(document, pages);
      Map<PDFont, FontRepairAccumulator> fontAccumulators = new IdentityHashMap<>();

      for (int pageNumber : pages) {
        PDPage page = document.getPage(pageNumber - 1);
        GlyphDiagnosticsEngine engine = new GlyphDiagnosticsEngine(pageNumber);
        engine.processPage(page);

        for (FontGlyphReportBuilder builder : engine.fontReports.values()) {
          FontRepairAccumulator accumulator = fontAccumulators.computeIfAbsent(
            builder.font,
            FontRepairAccumulator::new
          );
          accumulator.observe(pageNumber, builder);
        }
      }

      List<FontRepairResult> fontResults = new ArrayList<>();
      boolean allowOcrAssist = ocrText != null && !ocrText.isBlank() && pages.size() == 1 && fontAccumulators.size() == 1;
      for (FontRepairAccumulator accumulator : fontAccumulators.values()) {
        fontResults.add(accumulator.repair(
          document,
          protectedDocument,
          options.replaceExistingToUnicode,
          allowOcrAssist ? ocrText : null
        ));
      }
      fontResults.sort(Comparator.comparing(result -> result.resourceName));

      int repairedFonts = (int) fontResults.stream()
        .filter(result -> "repaired".equals(result.status))
        .count();
      int mappingsAdded = fontResults.stream().mapToInt(result -> result.mappingsAdded).sum();

      if (repairedFonts > 0) {
        document.save(options.outputFile);
      } else {
        Files.copy(options.inputFile.toPath(), options.outputFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
      }

      try (PDDocument repairedDocument = Loader.loadPDF(options.outputFile)) {
        Map<Integer, String> afterText = extractPageText(repairedDocument, pages);
        GlyphRepairValidation validation = validateRepair(
          repairedDocument,
          pages,
          beforeText,
          afterText,
          beforeImages
        );
        GlyphDiagnosticsReport afterDiagnostics = diagnoseLoadedDocument(repairedDocument, pages);

        return new GlyphRepairReport(
          document.getNumberOfPages(),
          document.isEncrypted(),
          signatureCount,
          pages.size(),
          fontResults.size(),
          repairedFonts,
          mappingsAdded,
          protectedDocument,
          fontResults,
          validation,
          afterDiagnostics
        );
      }
    }
  }

  private static GlyphDiagnosticsReport diagnoseLoadedDocument(PDDocument document, List<Integer> pages)
    throws IOException {
    List<PageGlyphReport> pageReports = new ArrayList<>();
    for (int pageNumber : pages) {
      PDPage page = document.getPage(pageNumber - 1);
      GlyphDiagnosticsEngine engine = new GlyphDiagnosticsEngine(pageNumber);
      engine.processPage(page);
      pageReports.add(engine.toReport());
    }

    return new GlyphDiagnosticsReport(
      document.getNumberOfPages(),
      document.isEncrypted(),
      document.getSignatureDictionaries().size(),
      pageReports
    );
  }

  private static Map<Integer, String> extractPageText(PDDocument document, List<Integer> pages)
    throws IOException {
    Map<Integer, String> textByPage = new java.util.LinkedHashMap<>();
    for (int pageNumber : pages) {
      PDFTextStripper stripper = new PDFTextStripper();
      stripper.setStartPage(pageNumber);
      stripper.setEndPage(pageNumber);
      textByPage.put(pageNumber, stripper.getText(document));
    }
    return textByPage;
  }

  private static Map<Integer, BufferedImage> renderPages(PDDocument document, List<Integer> pages)
    throws IOException {
    Map<Integer, BufferedImage> images = new java.util.LinkedHashMap<>();
    PDFRenderer renderer = new PDFRenderer(document);
    renderer.setSubsamplingAllowed(true);
    for (int pageNumber : pages) {
      images.put(pageNumber, renderer.renderImage(pageNumber - 1, 1.0f, ImageType.RGB));
    }
    return images;
  }

  private static GlyphRepairValidation validateRepair(
    PDDocument repairedDocument,
    List<Integer> pages,
    Map<Integer, String> beforeText,
    Map<Integer, String> afterText,
    Map<Integer, BufferedImage> beforeImages
  ) throws IOException {
    PDFRenderer renderer = new PDFRenderer(repairedDocument);
    renderer.setSubsamplingAllowed(true);

    int pagesCompared = 0;
    double maxChangedPixelRatio = 0;
    int maxChannelDelta = 0;

    for (int pageNumber : pages) {
      BufferedImage before = beforeImages.get(pageNumber);
      if (before == null) continue;

      BufferedImage after = renderer.renderImage(pageNumber - 1, 1.0f, ImageType.RGB);
      PixelDiff diff = compareImages(before, after);
      pagesCompared += 1;
      maxChangedPixelRatio = Math.max(maxChangedPixelRatio, diff.changedPixelRatio);
      maxChannelDelta = Math.max(maxChannelDelta, diff.maxChannelDelta);
    }

    int extractionChangedPages = 0;
    int beforeTextLength = 0;
    int afterTextLength = 0;
    for (int pageNumber : pages) {
      String before = beforeText.getOrDefault(pageNumber, "");
      String after = afterText.getOrDefault(pageNumber, "");
      beforeTextLength += before.length();
      afterTextLength += after.length();
      if (!before.equals(after)) {
        extractionChangedPages += 1;
      }
    }

    return new GlyphRepairValidation(
      true,
      pagesCompared,
      maxChangedPixelRatio,
      maxChannelDelta,
      beforeTextLength,
      afterTextLength,
      extractionChangedPages
    );
  }

  private static PixelDiff compareImages(BufferedImage before, BufferedImage after) {
    if (before.getWidth() != after.getWidth() || before.getHeight() != after.getHeight()) {
      return new PixelDiff(1, 255);
    }

    int changedPixels = 0;
    int maxChannelDelta = 0;
    int totalPixels = before.getWidth() * before.getHeight();

    for (int y = 0; y < before.getHeight(); y++) {
      for (int x = 0; x < before.getWidth(); x++) {
        int beforeRgb = before.getRGB(x, y);
        int afterRgb = after.getRGB(x, y);
        if (beforeRgb == afterRgb) continue;

        changedPixels += 1;
        maxChannelDelta = Math.max(maxChannelDelta, channelDelta(beforeRgb, afterRgb, 16));
        maxChannelDelta = Math.max(maxChannelDelta, channelDelta(beforeRgb, afterRgb, 8));
        maxChannelDelta = Math.max(maxChannelDelta, channelDelta(beforeRgb, afterRgb, 0));
      }
    }

    return new PixelDiff(totalPixels == 0 ? 0 : (double) changedPixels / totalPixels, maxChannelDelta);
  }

  private static int channelDelta(int left, int right, int shift) {
    return Math.abs(((left >> shift) & 0xFF) - ((right >> shift) & 0xFF));
  }

  private static final class CliOptions {
    private final String command;
    private final File inputFile;
    private final File outputFile;
    private final String pages;
    private final boolean replaceExistingToUnicode;
    private final File ocrTextFile;

    private CliOptions(
      String command,
      File inputFile,
      File outputFile,
      String pages,
      boolean replaceExistingToUnicode,
      File ocrTextFile
    ) {
      this.command = command;
      this.inputFile = inputFile;
      this.outputFile = outputFile;
      this.pages = pages;
      this.replaceExistingToUnicode = replaceExistingToUnicode;
      this.ocrTextFile = ocrTextFile;
    }

    static CliOptions parse(String[] args) {
      if (args.length == 0 || (!"diagnose".equals(args[0]) && !"repair".equals(args[0]))) {
        throw new IllegalArgumentException(
          "Usage: glyph-repair diagnose --input <pdf> [--pages 1,2,3|all] | " +
          "glyph-repair repair --input <pdf> --output <pdf> [--pages 1,2,3|all] " +
          "[--replace-existing-to-unicode] [--ocr-text-file <txt>]"
        );
      }

      String command = args[0];
      File input = null;
      File output = null;
      String pages = "all";
      boolean replaceExistingToUnicode = false;
      File ocrTextFile = null;
      for (int i = 1; i < args.length; i++) {
        String arg = args[i];
        if ("--input".equals(arg) && i + 1 < args.length) {
          input = new File(args[++i]);
        } else if ("--output".equals(arg) && i + 1 < args.length) {
          output = new File(args[++i]);
        } else if ("--pages".equals(arg) && i + 1 < args.length) {
          pages = args[++i];
        } else if ("--replace-existing-to-unicode".equals(arg)) {
          replaceExistingToUnicode = true;
        } else if ("--ocr-text-file".equals(arg) && i + 1 < args.length) {
          ocrTextFile = new File(args[++i]);
        } else if ("--format".equals(arg) && i + 1 < args.length) {
          String format = args[++i];
          if (!"json".equals(format)) {
            throw new IllegalArgumentException("Only --format json is supported.");
          }
        } else {
          throw new IllegalArgumentException("Unknown argument: " + arg);
        }
      }

      if (input == null || !input.isFile()) {
        throw new IllegalArgumentException("Input PDF does not exist.");
      }
      if ("repair".equals(command) && output == null) {
        throw new IllegalArgumentException("Repair requires --output <pdf>.");
      }
      if (ocrTextFile != null && !ocrTextFile.isFile()) {
        throw new IllegalArgumentException("OCR text file does not exist.");
      }

      return new CliOptions(command, input, output, pages, replaceExistingToUnicode, ocrTextFile);
    }

    String readOcrText() throws IOException {
      if (ocrTextFile == null) {
        return null;
      }
      return Files.readString(ocrTextFile.toPath(), StandardCharsets.UTF_8);
    }

    List<Integer> resolvePages(int pageCount) {
      if ("all".equalsIgnoreCase(pages)) {
        List<Integer> resolved = new ArrayList<>();
        for (int pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          resolved.add(pageNumber);
        }
        return resolved;
      }

      Set<Integer> resolved = new LinkedHashSet<>();
      for (String token : pages.split(",")) {
        String trimmed = token.trim();
        if (trimmed.isEmpty()) {
          continue;
        }

        int pageNumber;
        try {
          pageNumber = Integer.parseInt(trimmed);
        } catch (NumberFormatException err) {
          throw new IllegalArgumentException("Invalid page number: " + trimmed);
        }

        if (pageNumber < 1 || pageNumber > pageCount) {
          throw new IllegalArgumentException(
            "Page " + pageNumber + " is outside this " + pageCount + "-page PDF."
          );
        }
        resolved.add(pageNumber);
      }

      if (resolved.isEmpty()) {
        throw new IllegalArgumentException("At least one page must be selected.");
      }
      return new ArrayList<>(resolved);
    }
  }

  private static final class FontRepairAccumulator {
    private final PDFont font;
    private final Set<String> resourceNames = new TreeSet<>();
    private final Set<Integer> pageNumbers = new TreeSet<>();
    private final Set<Integer> observedCodes = new TreeSet<>();
    private final List<Integer> eventCodes = new ArrayList<>();
    private int glyphEvents;
    private boolean hasUnsafeCurrentMapping;

    FontRepairAccumulator(PDFont font) {
      this.font = font;
    }

    void observe(int pageNumber, FontGlyphReportBuilder builder) {
      pageNumbers.add(pageNumber);
      resourceNames.addAll(builder.resourceNames);
      observedCodes.addAll(builder.uniqueCodes);
      eventCodes.addAll(builder.eventCodes);
      glyphEvents += builder.glyphEvents;
      for (int code : builder.uniqueCodes) {
        hasUnsafeCurrentMapping = hasUnsafeCurrentMapping || !isSafeRepairUnicode(font.toUnicode(code));
      }
    }

    FontRepairResult repair(
      PDDocument document,
      boolean protectedDocument,
      boolean replaceExistingToUnicode,
      String ocrText
    ) throws IOException {
      FontMetadata metadata = FontMetadata.from(font);
      String resourceName = String.join(",", resourceNames);
      List<Integer> pages = new ArrayList<>(pageNumbers);

      if (protectedDocument) {
        return skipped(resourceName, metadata, pages, "protected-document", "Encrypted or signed PDFs are not mutated.");
      }
      if (metadata.damaged) {
        return skipped(resourceName, metadata, pages, "damaged-font", "PDFBox reported this font as damaged.");
      }
      if (metadata.vertical) {
        return skipped(resourceName, metadata, pages, "vertical-font", "Vertical writing mode repair is not enabled yet.");
      }
      if (observedCodes.isEmpty()) {
        return skipped(resourceName, metadata, pages, "no-observed-codes", "No text-showing glyph codes were observed.");
      }
      if (!(font instanceof PDSimpleFont) && !(font instanceof PDType0Font)) {
        return skipped(resourceName, metadata, pages, "unsupported-font-type", "Only simple fonts and Type0 fonts are enabled.");
      }

      if (metadata.hasToUnicode && !replaceExistingToUnicode) {
        return skipped(resourceName, metadata, pages, "existing-to-unicode", "Font already has a /ToUnicode map.");
      }

      if (metadata.hasToUnicode && ocrText != null && !ocrText.isBlank()) {
        MappingAttempt ocrAttempt = buildOcrMapping(ocrText);
        if (ocrAttempt.complete()) {
          writeToUnicode(document, ocrAttempt.mapping);
          return repaired(
            resourceName,
            metadata,
            pages,
            ocrAttempt.mapping.size(),
            "to-unicode-ocr-assisted-replaced",
            "Replaced /ToUnicode using strict OCR-to-glyph alignment.",
            "ocr-strict"
          );
        }
        return skippedFromAttempt(resourceName, metadata, pages, ocrAttempt, "ocr-strict");
      }

      if (metadata.hasToUnicode && !hasUnsafeCurrentMapping) {
        return skipped(
          resourceName,
          metadata,
          pages,
          "existing-to-unicode-appears-readable",
          "Existing /ToUnicode values are readable; OCR-assisted repair is required before replacing them."
        );
      }

      MappingAttempt deterministicAttempt = buildDeterministicMapping(!metadata.hasToUnicode);
      if (deterministicAttempt.complete()) {
        writeToUnicode(document, deterministicAttempt.mapping);
        return repaired(
          resourceName,
          metadata,
          pages,
          deterministicAttempt.mapping.size(),
          metadata.hasToUnicode ? "to-unicode-replaced" : "to-unicode-added",
          metadata.hasToUnicode
            ? "Replaced a broken /ToUnicode CMap with deterministic mappings."
            : "Added a deterministic /ToUnicode CMap.",
          "deterministic"
        );
      }

      if (ocrText != null && !ocrText.isBlank()) {
        MappingAttempt ocrAttempt = buildOcrMapping(ocrText);
        if (ocrAttempt.complete()) {
          writeToUnicode(document, ocrAttempt.mapping);
          return repaired(
            resourceName,
            metadata,
            pages,
            ocrAttempt.mapping.size(),
            metadata.hasToUnicode ? "to-unicode-ocr-assisted-replaced" : "to-unicode-ocr-assisted-added",
            metadata.hasToUnicode
              ? "Replaced /ToUnicode using strict OCR-to-glyph alignment."
              : "Added /ToUnicode using strict OCR-to-glyph alignment.",
            "ocr-strict"
          );
        }
        return skippedFromAttempt(resourceName, metadata, pages, ocrAttempt, "ocr-strict");
      }

      return skippedFromAttempt(resourceName, metadata, pages, deterministicAttempt, "deterministic");
    }

    private MappingAttempt buildDeterministicMapping(boolean allowCurrentMapping) throws IOException {
      Map<Integer, String> mapping = new java.util.TreeMap<>();
      List<Integer> unmappedCodes = new ArrayList<>();
      for (int code : observedCodes) {
        String unicode = deterministicUnicode(font, code, allowCurrentMapping);
        if (isSafeRepairUnicode(unicode)) {
          mapping.put(code, unicode);
        } else {
          unmappedCodes.add(code);
        }
      }

      if (!unmappedCodes.isEmpty()) {
        return MappingAttempt.skipped(
          "ambiguous-codes",
          "Some observed codes could not be mapped deterministically.",
          mapping,
          toCodeHexList(unmappedCodes)
        );
      }
      if (mapping.isEmpty()) {
        return MappingAttempt.skipped(
          "no-deterministic-mapping",
          "No safe code-to-Unicode mapping was found.",
          mapping,
          Collections.emptyList()
        );
      }

      return MappingAttempt.complete(mapping);
    }

    private MappingAttempt buildOcrMapping(String rawOcrText) {
      List<String> ocrCharacters = normalizeOcrCharacters(rawOcrText);
      if (ocrCharacters.isEmpty()) {
        return MappingAttempt.skipped(
          "ocr-text-missing",
          "OCR-assisted repair needs OCR text for this page.",
          Collections.emptyMap(),
          Collections.emptyList()
        );
      }
      if (ocrCharacters.size() != eventCodes.size()) {
        return MappingAttempt.skipped(
          "ocr-text-length-mismatch",
          "OCR text did not align one-for-one with observed glyph events.",
          Collections.emptyMap(),
          Collections.emptyList()
        );
      }

      Map<Integer, String> mapping = new java.util.TreeMap<>();
      List<Integer> conflictCodes = new ArrayList<>();
      for (int index = 0; index < eventCodes.size(); index++) {
        int code = eventCodes.get(index);
        String unicode = ocrCharacters.get(index);
        if (!isSafeRepairUnicode(unicode)) {
          conflictCodes.add(code);
          continue;
        }

        String existing = mapping.get(code);
        if (existing != null && !existing.equals(unicode)) {
          conflictCodes.add(code);
          continue;
        }
        mapping.put(code, unicode);
      }

      if (!conflictCodes.isEmpty()) {
        return MappingAttempt.skipped(
          "ocr-conflicting-code-map",
          "OCR-assisted mapping found the same glyph code paired with different text.",
          mapping,
          toCodeHexList(conflictCodes)
        );
      }

      return mapping.isEmpty()
        ? MappingAttempt.skipped("ocr-no-mapping", "OCR-assisted repair found no usable mappings.", mapping, Collections.emptyList())
        : MappingAttempt.complete(mapping);
    }

    private void writeToUnicode(PDDocument document, Map<Integer, String> mapping) throws IOException {
      int sourceBytes = sourceCodeBytes(font);
      COSStream toUnicode = createToUnicodeStream(document, mapping, sourceBytes);
      font.getCOSObject().setItem(COSName.TO_UNICODE, toUnicode);
    }

    private FontRepairResult repaired(
      String resourceName,
      FontMetadata metadata,
      List<Integer> pages,
      int mappingSize,
      String reason,
      String message,
      String mappingSource
    ) {
      return new FontRepairResult(
        resourceName,
        metadata,
        "repaired",
        reason,
        message,
        pages,
        glyphEvents,
        observedCodes.size(),
        mappingSize,
        0,
        mappingSize,
        sourceCodeBytes(font),
        Collections.emptyList(),
        mappingSource
      );
    }

    private FontRepairResult skipped(
      String resourceName,
      FontMetadata metadata,
      List<Integer> pages,
      String reason,
      String message
    ) {
      return new FontRepairResult(
        resourceName,
        metadata,
        "skipped",
        reason,
        message,
        pages,
        glyphEvents,
        observedCodes.size(),
        0,
        observedCodes.size(),
        0,
        sourceCodeBytes(font),
        toCodeHexList(new ArrayList<>(observedCodes)),
        "none"
      );
    }

    private FontRepairResult skippedFromAttempt(
      String resourceName,
      FontMetadata metadata,
      List<Integer> pages,
      MappingAttempt attempt,
      String mappingSource
    ) {
      return new FontRepairResult(
        resourceName,
        metadata,
        "skipped",
        attempt.reason,
        attempt.message,
        pages,
        glyphEvents,
        observedCodes.size(),
        attempt.mapping.size(),
        Math.max(observedCodes.size() - attempt.mapping.size(), 0),
        0,
        sourceCodeBytes(font),
        attempt.unmappedCodeHex,
        mappingSource
      );
    }
  }

  private static final class MappingAttempt {
    private final Map<Integer, String> mapping;
    private final String reason;
    private final String message;
    private final List<String> unmappedCodeHex;

    private MappingAttempt(Map<Integer, String> mapping, String reason, String message, List<String> unmappedCodeHex) {
      this.mapping = new java.util.TreeMap<>(mapping);
      this.reason = reason;
      this.message = message;
      this.unmappedCodeHex = Collections.unmodifiableList(new ArrayList<>(unmappedCodeHex));
    }

    static MappingAttempt complete(Map<Integer, String> mapping) {
      return new MappingAttempt(mapping, "complete", "", Collections.emptyList());
    }

    static MappingAttempt skipped(String reason, String message, Map<Integer, String> mapping, List<String> unmappedCodeHex) {
      return new MappingAttempt(mapping, reason, message, unmappedCodeHex);
    }

    boolean complete() {
      return "complete".equals(reason) && !mapping.isEmpty();
    }
  }

  private static String deterministicUnicode(PDFont font, int code, boolean allowCurrentMapping) throws IOException {
    String unicode;
    if (allowCurrentMapping) {
      unicode = font.toUnicode(code);
      if (isSafeRepairUnicode(unicode)) {
        return unicode;
      }
    }

    if (font instanceof PDSimpleFont simpleFont) {
      String glyphName = simpleFont.getEncoding() == null ? null : simpleFont.getEncoding().getName(code);
      unicode = unicodeFromGlyphName(glyphName);
      if (isSafeRepairUnicode(unicode)) {
        return unicode;
      }
    }

    if (font instanceof PDTrueTypeFont trueTypeFont) {
      unicode = unicodeFromTrueTypeGlyph(trueTypeFont, code);
      if (isSafeRepairUnicode(unicode)) {
        return unicode;
      }
    }

    if (font instanceof PDType0Font type0Font) {
      CMap ucs2 = type0Font.getCMapUCS2();
      if (ucs2 != null) {
        unicode = ucs2.toUnicode(type0Font.codeToCID(code));
        if (isSafeRepairUnicode(unicode)) {
          return unicode;
        }
      }

      CmapLookup lookup = type0Font.getCmapLookup();
      if (lookup != null) {
        int gid = type0Font.codeToGID(code);
        unicode = unicodeFromGlyphId(lookup, gid);
        if (isSafeRepairUnicode(unicode)) {
          return unicode;
        }
      }
    }

    return null;
  }

  private static List<String> normalizeOcrCharacters(String rawOcrText) {
    String normalized = rawOcrText.replaceAll("\\s+", " ").trim();
    if (normalized.isEmpty()) {
      return Collections.emptyList();
    }
    return normalized.codePoints()
      .mapToObj(codePoint -> new String(Character.toChars(codePoint)))
      .toList();
  }

  private static String unicodeFromTrueTypeGlyph(PDTrueTypeFont font, int code) throws IOException {
    CmapLookup lookup = font.getTrueTypeFont().getUnicodeCmapLookup(false);
    if (lookup == null) {
      return null;
    }
    return unicodeFromGlyphId(lookup, font.codeToGID(code));
  }

  private static String unicodeFromGlyphId(CmapLookup lookup, int glyphId) {
    List<Integer> charCodes = lookup.getCharCodes(glyphId);
    if (charCodes == null || charCodes.size() != 1) {
      return null;
    }

    int codePoint = charCodes.get(0);
    if (!Character.isValidCodePoint(codePoint)) {
      return null;
    }
    return new String(Character.toChars(codePoint));
  }

  private static String unicodeFromGlyphName(String glyphName) {
    if (glyphName == null || glyphName.isBlank()) {
      return null;
    }

    String unicode = GlyphList.getAdobeGlyphList().toUnicode(glyphName);
    if (unicode != null && !unicode.isEmpty()) {
      return unicode;
    }

    if (glyphName.matches("uni[0-9A-Fa-f]{4}([0-9A-Fa-f]{4})*")) {
      String hex = glyphName.substring(3);
      StringBuilder value = new StringBuilder();
      for (int i = 0; i < hex.length(); i += 4) {
        int codePoint = Integer.parseInt(hex.substring(i, i + 4), 16);
        value.append((char) codePoint);
      }
      return value.toString();
    }

    if (glyphName.matches("u[0-9A-Fa-f]{4,6}")) {
      int codePoint = Integer.parseInt(glyphName.substring(1), 16);
      if (Character.isValidCodePoint(codePoint)) {
        return new String(Character.toChars(codePoint));
      }
    }

    return null;
  }

  private static boolean isSafeRepairUnicode(String unicode) {
    if (unicode == null || unicode.isEmpty()) {
      return false;
    }
    if (unicode.indexOf('\uFFFD') >= 0 || containsPrivateUse(unicode)) {
      return false;
    }
    return unicode.codePoints().noneMatch(codePoint -> (
      codePoint == 0 ||
      Character.isISOControl(codePoint) && codePoint != '\t' && codePoint != '\n' && codePoint != '\r'
    ));
  }

  private static int sourceCodeBytes(PDFont font) {
    return font instanceof PDSimpleFont ? 1 : 2;
  }

  private static COSStream createToUnicodeStream(
    PDDocument document,
    Map<Integer, String> mapping,
    int sourceBytes
  ) throws IOException {
    COSStream stream = document.getDocument().createCOSStream();
    try (OutputStream output = stream.createOutputStream(COSName.FLATE_DECODE);
         BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.US_ASCII))) {
      writer.write("/CIDInit /ProcSet findresource begin\n");
      writer.write("12 dict begin\n\n");
      writer.write("begincmap\n");
      writer.write("/CIDSystemInfo\n");
      writer.write("<< /Registry (Adobe)\n");
      writer.write("/Ordering (UCS)\n");
      writer.write("/Supplement 0\n");
      writer.write(">> def\n\n");
      writer.write("/CMapName /Adobe-Identity-UCS def\n");
      writer.write("/CMapType 2 def\n\n");
      writer.write("1 begincodespacerange\n");
      writer.write("<");
      writer.write("00".repeat(sourceBytes));
      writer.write("> <");
      writer.write("FF".repeat(sourceBytes));
      writer.write(">\n");
      writer.write("endcodespacerange\n\n");

      List<Map.Entry<Integer, String>> entries = new ArrayList<>(mapping.entrySet());
      for (int index = 0; index < entries.size(); index += 100) {
        int batchSize = Math.min(100, entries.size() - index);
        writer.write(Integer.toString(batchSize));
        writer.write(" beginbfchar\n");
        for (int offset = 0; offset < batchSize; offset++) {
          Map.Entry<Integer, String> entry = entries.get(index + offset);
          writer.write("<");
          writer.write(toFixedHex(entry.getKey(), sourceBytes * 2));
          writer.write("> <");
          writer.write(toUtf16BeHex(entry.getValue()));
          writer.write(">\n");
        }
        writer.write("endbfchar\n\n");
      }

      writer.write("endcmap\n");
      writer.write("CMapName currentdict /CMap defineresource pop\n");
      writer.write("end\n");
      writer.write("end\n");
    }
    return stream;
  }

  private static String toFixedHex(int code, int length) {
    String hex = Integer.toHexString(code).toUpperCase(Locale.ROOT);
    return "0".repeat(Math.max(length - hex.length(), 0)) + hex;
  }

  private static String toUtf16BeHex(String value) {
    StringBuilder hex = new StringBuilder();
    for (int index = 0; index < value.length(); index++) {
      hex.append(toFixedHex(value.charAt(index), 4));
    }
    return hex.toString();
  }

  private static List<String> toCodeHexList(List<Integer> codes) {
    return codes.stream().map(GlyphRepairCli::toCodeHex).toList();
  }

  private static final class PixelDiff {
    private final double changedPixelRatio;
    private final int maxChannelDelta;

    PixelDiff(double changedPixelRatio, int maxChannelDelta) {
      this.changedPixelRatio = changedPixelRatio;
      this.maxChannelDelta = maxChannelDelta;
    }
  }

  private static final class GlyphRepairReport implements JsonWritable {
    private final int pageCount;
    private final boolean encrypted;
    private final int signatureCount;
    private final int pagesAnalyzed;
    private final int fontsConsidered;
    private final int fontsRepaired;
    private final int mappingsAdded;
    private final boolean protectedDocument;
    private final List<FontRepairResult> fonts;
    private final GlyphRepairValidation validation;
    private final GlyphDiagnosticsReport afterDiagnostics;

    GlyphRepairReport(
      int pageCount,
      boolean encrypted,
      int signatureCount,
      int pagesAnalyzed,
      int fontsConsidered,
      int fontsRepaired,
      int mappingsAdded,
      boolean protectedDocument,
      List<FontRepairResult> fonts,
      GlyphRepairValidation validation,
      GlyphDiagnosticsReport afterDiagnostics
    ) {
      this.pageCount = pageCount;
      this.encrypted = encrypted;
      this.signatureCount = signatureCount;
      this.pagesAnalyzed = pagesAnalyzed;
      this.fontsConsidered = fontsConsidered;
      this.fontsRepaired = fontsRepaired;
      this.mappingsAdded = mappingsAdded;
      this.protectedDocument = protectedDocument;
      this.fonts = Collections.unmodifiableList(new ArrayList<>(fonts));
      this.validation = validation;
      this.afterDiagnostics = afterDiagnostics;
    }

    @Override
    public String toJson() {
      StringBuilder json = new StringBuilder();
      json.append('{');
      appendNumber(json, "pageCount", pageCount).append(',');
      appendBoolean(json, "encrypted", encrypted).append(',');
      appendNumber(json, "signatureCount", signatureCount).append(',');
      appendNumber(json, "pagesAnalyzed", pagesAnalyzed).append(',');
      appendNumber(json, "fontsConsidered", fontsConsidered).append(',');
      appendNumber(json, "fontsRepaired", fontsRepaired).append(',');
      appendNumber(json, "mappingsAdded", mappingsAdded).append(',');
      appendBoolean(json, "protectedDocument", protectedDocument).append(',');
      json.append("\"validation\":").append(validation.toJson()).append(',');
      json.append("\"afterDiagnostics\":").append(afterDiagnostics.toJson()).append(',');
      json.append("\"fonts\":[");
      appendJoined(json, fonts);
      json.append("]}");
      return json.toString();
    }
  }

  private static final class GlyphRepairValidation implements JsonWritable {
    private final boolean reloaded;
    private final int visualPagesCompared;
    private final double maxChangedPixelRatio;
    private final int maxChannelDelta;
    private final int beforeTextLength;
    private final int afterTextLength;
    private final int extractionChangedPages;

    GlyphRepairValidation(
      boolean reloaded,
      int visualPagesCompared,
      double maxChangedPixelRatio,
      int maxChannelDelta,
      int beforeTextLength,
      int afterTextLength,
      int extractionChangedPages
    ) {
      this.reloaded = reloaded;
      this.visualPagesCompared = visualPagesCompared;
      this.maxChangedPixelRatio = maxChangedPixelRatio;
      this.maxChannelDelta = maxChannelDelta;
      this.beforeTextLength = beforeTextLength;
      this.afterTextLength = afterTextLength;
      this.extractionChangedPages = extractionChangedPages;
    }

    @Override
    public String toJson() {
      StringBuilder json = new StringBuilder();
      json.append('{');
      appendBoolean(json, "reloaded", reloaded).append(',');
      appendNumber(json, "visualPagesCompared", visualPagesCompared).append(',');
      appendDecimal(json, "maxChangedPixelRatio", maxChangedPixelRatio).append(',');
      appendNumber(json, "maxChannelDelta", maxChannelDelta).append(',');
      appendNumber(json, "beforeTextLength", beforeTextLength).append(',');
      appendNumber(json, "afterTextLength", afterTextLength).append(',');
      appendNumber(json, "extractionChangedPages", extractionChangedPages);
      json.append('}');
      return json.toString();
    }
  }

  private static final class FontRepairResult implements JsonWritable {
    private final String resourceName;
    private final FontMetadata metadata;
    private final String status;
    private final String reason;
    private final String message;
    private final List<Integer> pages;
    private final int glyphEvents;
    private final int observedCodes;
    private final int mappedCodes;
    private final int unmappedCodes;
    private final int mappingsAdded;
    private final int sourceCodeBytes;
    private final List<String> unmappedCodeHex;
    private final String mappingSource;

    FontRepairResult(
      String resourceName,
      FontMetadata metadata,
      String status,
      String reason,
      String message,
      List<Integer> pages,
      int glyphEvents,
      int observedCodes,
      int mappedCodes,
      int unmappedCodes,
      int mappingsAdded,
      int sourceCodeBytes,
      List<String> unmappedCodeHex,
      String mappingSource
    ) {
      this.resourceName = resourceName;
      this.metadata = metadata;
      this.status = status;
      this.reason = reason;
      this.message = message;
      this.pages = Collections.unmodifiableList(new ArrayList<>(pages));
      this.glyphEvents = glyphEvents;
      this.observedCodes = observedCodes;
      this.mappedCodes = mappedCodes;
      this.unmappedCodes = unmappedCodes;
      this.mappingsAdded = mappingsAdded;
      this.sourceCodeBytes = sourceCodeBytes;
      this.unmappedCodeHex = Collections.unmodifiableList(new ArrayList<>(unmappedCodeHex));
      this.mappingSource = mappingSource;
    }

    @Override
    public String toJson() {
      StringBuilder json = new StringBuilder();
      json.append('{');
      appendString(json, "resourceName", resourceName).append(',');
      json.append("\"font\":").append(metadata.toJson()).append(',');
      appendString(json, "status", status).append(',');
      appendString(json, "reason", reason).append(',');
      appendString(json, "message", message).append(',');
      appendNumberArray(json, "pages", pages).append(',');
      appendNumber(json, "glyphEvents", glyphEvents).append(',');
      appendNumber(json, "observedCodes", observedCodes).append(',');
      appendNumber(json, "mappedCodes", mappedCodes).append(',');
      appendNumber(json, "unmappedCodes", unmappedCodes).append(',');
      appendNumber(json, "mappingsAdded", mappingsAdded).append(',');
      appendNumber(json, "sourceCodeBytes", sourceCodeBytes).append(',');
      appendStringArray(json, "unmappedCodeHex", unmappedCodeHex).append(',');
      appendString(json, "mappingSource", mappingSource);
      json.append('}');
      return json.toString();
    }
  }

  private static final class GlyphDiagnosticsEngine extends PDFStreamEngine {
    private final int pageNumber;
    private final Map<PDFont, FontGlyphReportBuilder> fontReports = new IdentityHashMap<>();
    private String currentFontResourceName;

    GlyphDiagnosticsEngine(int pageNumber) {
      this.pageNumber = pageNumber;
      addOperator(new BeginText(this));
      addOperator(new Concatenate(this));
      addOperator(new DrawObject(this));
      addOperator(new EndText(this));
      addOperator(new SetGraphicsStateParameters(this));
      addOperator(new Save(this));
      addOperator(new Restore(this));
      addOperator(new NextLine(this));
      addOperator(new SetCharSpacing(this));
      addOperator(new MoveText(this));
      addOperator(new MoveTextSetLeading(this));
      addOperator(new SetFontAndSize(this));
      addOperator(new ShowText(this));
      addOperator(new ShowTextAdjusted(this));
      addOperator(new SetTextLeading(this));
      addOperator(new SetMatrix(this));
      addOperator(new SetTextRenderingMode(this));
      addOperator(new SetTextRise(this));
      addOperator(new SetWordSpacing(this));
      addOperator(new SetTextHorizontalScaling(this));
      addOperator(new ShowTextLine(this));
      addOperator(new ShowTextLineAndSpace(this));
    }

    @Override
    protected void processOperator(Operator operator, List<COSBase> operands) throws IOException {
      if (OperatorName.SET_FONT_AND_SIZE.equals(operator.getName()) && !operands.isEmpty()) {
        COSBase fontOperand = operands.get(0);
        if (fontOperand instanceof COSName) {
          currentFontResourceName = ((COSName) fontOperand).getName();
        }
      }
      super.processOperator(operator, operands);
    }

    @Override
    protected void showGlyph(Matrix textRenderingMatrix, PDFont font, int code, Vector displacement)
      throws IOException {
      FontGlyphReportBuilder builder = fontReports.computeIfAbsent(
        font,
        key -> new FontGlyphReportBuilder(key, currentFontResourceName)
      );
      builder.observe(currentFontResourceName, code, font.toUnicode(code), displacement, textRenderingMatrix, getRenderingMode());
      super.showGlyph(textRenderingMatrix, font, code, displacement);
    }

    PageGlyphReport toReport() {
      List<FontGlyphReport> fonts = fontReports.values().stream()
        .map(FontGlyphReportBuilder::toReport)
        .sorted(Comparator.comparing(report -> report.resourceName))
        .toList();
      return new PageGlyphReport(pageNumber, fonts);
    }

    private int getRenderingMode() {
      RenderingMode mode = getGraphicsState().getTextState().getRenderingMode();
      return mode == null ? 0 : mode.intValue();
    }
  }

  private static final class FontGlyphReportBuilder {
    private final PDFont font;
    private final Set<String> resourceNames = new TreeSet<>();
    private final Set<Integer> uniqueCodes = new TreeSet<>();
    private final List<Integer> eventCodes = new ArrayList<>();
    private final List<GlyphSample> samples = new ArrayList<>();
    private int glyphEvents;
    private int unmappedGlyphs;
    private int privateUseGlyphs;
    private int replacementGlyphs;
    private int invisibleGlyphs;

    FontGlyphReportBuilder(PDFont font, String resourceName) {
      this.font = font;
      addResourceName(resourceName);
    }

    void observe(
      String resourceName,
      int code,
      String unicode,
      Vector displacement,
      Matrix textRenderingMatrix,
      int renderingMode
    ) {
      addResourceName(resourceName);
      glyphEvents += 1;
      uniqueCodes.add(code);
      eventCodes.add(code);
      if (unicode == null || unicode.isEmpty()) {
        unmappedGlyphs += 1;
      } else {
        if (containsPrivateUse(unicode)) {
          privateUseGlyphs += 1;
        }
        if (unicode.indexOf('\uFFFD') >= 0) {
          replacementGlyphs += 1;
        }
      }
      if (renderingMode == 3) {
        invisibleGlyphs += 1;
      }

      if (samples.size() < MAX_GLYPH_SAMPLES_PER_FONT) {
        samples.add(new GlyphSample(
          code,
          unicode,
          displacement.getX(),
          displacement.getY(),
          textRenderingMatrix.getTranslateX(),
          textRenderingMatrix.getTranslateY(),
          renderingMode
        ));
      }
    }

    FontGlyphReport toReport() {
      FontMetadata metadata = FontMetadata.from(font);
      return new FontGlyphReport(
        String.join(",", resourceNames),
        metadata,
        glyphEvents,
        uniqueCodes.size(),
        unmappedGlyphs,
        privateUseGlyphs,
        replacementGlyphs,
        invisibleGlyphs,
        repairPlan(metadata),
        samples
      );
    }

    private void addResourceName(String resourceName) {
      resourceNames.add(resourceName == null || resourceName.isBlank() ? "unknown" : resourceName);
    }

    private String repairPlan(FontMetadata metadata) {
      if (glyphEvents == 0) {
        return "no-text";
      }
      if (!metadata.hasToUnicode && !metadata.damaged && unmappedGlyphs == 0 && privateUseGlyphs == 0 && replacementGlyphs == 0) {
        return "deterministic-to-unicode-candidate";
      }
      if (unmappedGlyphs == 0 && privateUseGlyphs == 0 && replacementGlyphs == 0) {
        return "mapping-present";
      }
      if (!metadata.hasToUnicode && metadata.embedded && !metadata.damaged) {
        return "deterministic-to-unicode-candidate";
      }
      if (metadata.hasToUnicode) {
        return "existing-to-unicode-needs-review";
      }
      return "ocr-assisted-mapping-candidate";
    }
  }

  private static final class GlyphDiagnosticsReport {
    private final int pageCount;
    private final boolean encrypted;
    private final int signatureCount;
    private final List<PageGlyphReport> pages;

    GlyphDiagnosticsReport(int pageCount, boolean encrypted, int signatureCount, List<PageGlyphReport> pages) {
      this.pageCount = pageCount;
      this.encrypted = encrypted;
      this.signatureCount = signatureCount;
      this.pages = pages;
    }

    String toJson() {
      int glyphEvents = pages.stream().mapToInt(PageGlyphReport::glyphEvents).sum();
      int unmappedGlyphs = pages.stream().mapToInt(PageGlyphReport::unmappedGlyphs).sum();
      int fontCount = pages.stream().mapToInt(page -> page.fonts.size()).sum();
      int deterministicCandidates = pages.stream().mapToInt(PageGlyphReport::deterministicCandidateFonts).sum();

      StringBuilder json = new StringBuilder();
      json.append('{');
      appendNumber(json, "pageCount", pageCount).append(',');
      appendBoolean(json, "encrypted", encrypted).append(',');
      appendNumber(json, "signatureCount", signatureCount).append(',');
      appendNumber(json, "pagesAnalyzed", pages.size()).append(',');
      appendNumber(json, "fontCount", fontCount).append(',');
      appendNumber(json, "glyphEvents", glyphEvents).append(',');
      appendNumber(json, "unmappedGlyphs", unmappedGlyphs).append(',');
      appendNumber(json, "deterministicCandidateFonts", deterministicCandidates).append(',');
      json.append("\"pages\":[");
      appendJoined(json, pages);
      json.append("]}");
      return json.toString();
    }
  }

  private static final class PageGlyphReport implements JsonWritable {
    private final int pageNumber;
    private final List<FontGlyphReport> fonts;

    PageGlyphReport(int pageNumber, List<FontGlyphReport> fonts) {
      this.pageNumber = pageNumber;
      this.fonts = fonts;
    }

    int glyphEvents() {
      return fonts.stream().mapToInt(font -> font.glyphEvents).sum();
    }

    int unmappedGlyphs() {
      return fonts.stream().mapToInt(font -> font.unmappedGlyphs).sum();
    }

    int deterministicCandidateFonts() {
      return (int) fonts.stream()
        .filter(font -> "deterministic-to-unicode-candidate".equals(font.repairPlan))
        .count();
    }

    @Override
    public String toJson() {
      int glyphEvents = glyphEvents();
      int unmappedGlyphs = unmappedGlyphs();
      double suspectScore = glyphEvents == 0 ? 0 : Math.min(1, (double) unmappedGlyphs / glyphEvents);

      StringBuilder json = new StringBuilder();
      json.append('{');
      appendNumber(json, "pageNumber", pageNumber).append(',');
      appendNumber(json, "fontCount", fonts.size()).append(',');
      appendNumber(json, "glyphEvents", glyphEvents).append(',');
      appendNumber(json, "unmappedGlyphs", unmappedGlyphs).append(',');
      appendDecimal(json, "suspectScore", suspectScore).append(',');
      json.append("\"fonts\":[");
      appendJoined(json, fonts);
      json.append("]}");
      return json.toString();
    }
  }

  private static final class FontGlyphReport implements JsonWritable {
    private final String resourceName;
    private final FontMetadata metadata;
    private final int glyphEvents;
    private final int uniqueCodes;
    private final int unmappedGlyphs;
    private final int privateUseGlyphs;
    private final int replacementGlyphs;
    private final int invisibleGlyphs;
    private final String repairPlan;
    private final List<GlyphSample> samples;

    FontGlyphReport(
      String resourceName,
      FontMetadata metadata,
      int glyphEvents,
      int uniqueCodes,
      int unmappedGlyphs,
      int privateUseGlyphs,
      int replacementGlyphs,
      int invisibleGlyphs,
      String repairPlan,
      List<GlyphSample> samples
    ) {
      this.resourceName = resourceName;
      this.metadata = metadata;
      this.glyphEvents = glyphEvents;
      this.uniqueCodes = uniqueCodes;
      this.unmappedGlyphs = unmappedGlyphs;
      this.privateUseGlyphs = privateUseGlyphs;
      this.replacementGlyphs = replacementGlyphs;
      this.invisibleGlyphs = invisibleGlyphs;
      this.repairPlan = repairPlan;
      this.samples = Collections.unmodifiableList(new ArrayList<>(samples));
    }

    @Override
    public String toJson() {
      StringBuilder json = new StringBuilder();
      json.append('{');
      appendString(json, "resourceName", resourceName).append(',');
      json.append("\"font\":").append(metadata.toJson()).append(',');
      appendNumber(json, "glyphEvents", glyphEvents).append(',');
      appendNumber(json, "uniqueCodes", uniqueCodes).append(',');
      appendNumber(json, "unmappedGlyphs", unmappedGlyphs).append(',');
      appendNumber(json, "privateUseGlyphs", privateUseGlyphs).append(',');
      appendNumber(json, "replacementGlyphs", replacementGlyphs).append(',');
      appendNumber(json, "invisibleGlyphs", invisibleGlyphs).append(',');
      appendString(json, "repairPlan", repairPlan).append(',');
      json.append("\"samples\":[");
      appendJoined(json, samples);
      json.append("]}");
      return json.toString();
    }
  }

  private static final class FontMetadata implements JsonWritable {
    private final String name;
    private final String subtype;
    private final String implementation;
    private final String encoding;
    private final String descendantSubtype;
    private final String cidSystem;
    private final boolean embedded;
    private final boolean damaged;
    private final boolean vertical;
    private final boolean hasToUnicode;

    private FontMetadata(
      String name,
      String subtype,
      String implementation,
      String encoding,
      String descendantSubtype,
      String cidSystem,
      boolean embedded,
      boolean damaged,
      boolean vertical,
      boolean hasToUnicode
    ) {
      this.name = name;
      this.subtype = subtype;
      this.implementation = implementation;
      this.encoding = encoding;
      this.descendantSubtype = descendantSubtype;
      this.cidSystem = cidSystem;
      this.embedded = embedded;
      this.damaged = damaged;
      this.vertical = vertical;
      this.hasToUnicode = hasToUnicode;
    }

    static FontMetadata from(PDFont font) {
      String encoding = readEncoding(font);
      String descendantSubtype = null;
      String cidSystem = null;
      if (font instanceof PDType0Font type0Font) {
        PDCIDFont descendant = type0Font.getDescendantFont();
        descendantSubtype = descendant == null ? null : descendant.getCOSObject().getNameAsString(COSName.SUBTYPE);
        PDCIDSystemInfo systemInfo = descendant == null ? null : descendant.getCIDSystemInfo();
        if (systemInfo != null) {
          cidSystem = systemInfo.getRegistry() + "-" + systemInfo.getOrdering() + "-" + systemInfo.getSupplement();
        }
      }

      COSDictionary dict = font.getCOSObject();
      return new FontMetadata(
        knownOrUnknown(font.getName()),
        knownOrUnknown(font.getSubType()),
        font.getClass().getSimpleName(),
        encoding,
        descendantSubtype,
        cidSystem,
        font.isEmbedded(),
        font.isDamaged(),
        font.isVertical(),
        dict.containsKey(COSName.TO_UNICODE)
      );
    }

    private static String readEncoding(PDFont font) {
      if (font instanceof PDSimpleFont simpleFont && simpleFont.getEncoding() != null) {
        return simpleFont.getEncoding().getEncodingName();
      }
      if (font instanceof PDType0Font type0Font) {
        CMap cMap = type0Font.getCMap();
        if (cMap != null && cMap.getName() != null) {
          return cMap.getName();
        }
      }

      COSBase encoding = font.getCOSObject().getDictionaryObject(COSName.ENCODING);
      if (encoding instanceof COSName) {
        return ((COSName) encoding).getName();
      }
      return encoding == null ? null : encoding.getClass().getSimpleName();
    }

    @Override
    public String toJson() {
      StringBuilder json = new StringBuilder();
      json.append('{');
      appendString(json, "name", name).append(',');
      appendString(json, "subtype", subtype).append(',');
      appendString(json, "implementation", implementation).append(',');
      appendNullableString(json, "encoding", encoding).append(',');
      appendNullableString(json, "descendantSubtype", descendantSubtype).append(',');
      appendNullableString(json, "cidSystem", cidSystem).append(',');
      appendBoolean(json, "embedded", embedded).append(',');
      appendBoolean(json, "damaged", damaged).append(',');
      appendBoolean(json, "vertical", vertical).append(',');
      appendBoolean(json, "hasToUnicode", hasToUnicode);
      json.append('}');
      return json.toString();
    }
  }

  private static final class GlyphSample implements JsonWritable {
    private final int code;
    private final String unicode;
    private final float advanceX;
    private final float advanceY;
    private final float x;
    private final float y;
    private final int renderingMode;

    GlyphSample(int code, String unicode, float advanceX, float advanceY, float x, float y, int renderingMode) {
      this.code = code;
      this.unicode = unicode;
      this.advanceX = advanceX;
      this.advanceY = advanceY;
      this.x = x;
      this.y = y;
      this.renderingMode = renderingMode;
    }

    @Override
    public String toJson() {
      StringBuilder json = new StringBuilder();
      json.append('{');
      appendNumber(json, "code", code).append(',');
      appendString(json, "codeHex", toCodeHex(code)).append(',');
      appendNullableString(json, "unicode", unicode).append(',');
      appendString(json, "unicodeCodePoints", unicodeCodePoints(unicode)).append(',');
      appendDecimal(json, "advanceX", advanceX).append(',');
      appendDecimal(json, "advanceY", advanceY).append(',');
      appendDecimal(json, "x", x).append(',');
      appendDecimal(json, "y", y).append(',');
      appendNumber(json, "renderingMode", renderingMode);
      json.append('}');
      return json.toString();
    }
  }

  private interface JsonWritable {
    String toJson();
  }

  private static boolean containsPrivateUse(String value) {
    return value.codePoints().anyMatch(codePoint -> (
      (codePoint >= 0xE000 && codePoint <= 0xF8FF) ||
      (codePoint >= 0xF0000 && codePoint <= 0xFFFFD) ||
      (codePoint >= 0x100000 && codePoint <= 0x10FFFD)
    ));
  }

  private static String toCodeHex(int code) {
    int minLength = code <= 0xFFFF ? 4 : 6;
    String hex = Integer.toHexString(code).toUpperCase(Locale.ROOT);
    return "0".repeat(Math.max(minLength - hex.length(), 0)) + hex;
  }

  private static String unicodeCodePoints(String value) {
    if (value == null || value.isEmpty()) {
      return "";
    }
    List<String> codePoints = value.codePoints()
      .mapToObj(codePoint -> "U+" + toCodeHex(codePoint))
      .toList();
    return String.join(" ", codePoints);
  }

  private static StringBuilder appendJoined(StringBuilder json, List<? extends JsonWritable> values) {
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) {
        json.append(',');
      }
      json.append(values.get(i).toJson());
    }
    return json;
  }

  private static StringBuilder appendString(StringBuilder json, String key, String value) {
    return json.append('"').append(key).append("\":").append(quote(value));
  }

  private static StringBuilder appendNullableString(StringBuilder json, String key, String value) {
    json.append('"').append(key).append("\":");
    return value == null ? json.append("null") : json.append(quote(value));
  }

  private static StringBuilder appendNumber(StringBuilder json, String key, int value) {
    return json.append('"').append(key).append("\":").append(value);
  }

  private static StringBuilder appendNumberArray(StringBuilder json, String key, List<Integer> values) {
    json.append('"').append(key).append("\":[");
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) {
        json.append(',');
      }
      json.append(values.get(i));
    }
    json.append(']');
    return json;
  }

  private static StringBuilder appendStringArray(StringBuilder json, String key, List<String> values) {
    json.append('"').append(key).append("\":[");
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) {
        json.append(',');
      }
      json.append(quote(values.get(i)));
    }
    json.append(']');
    return json;
  }

  private static StringBuilder appendDecimal(StringBuilder json, String key, double value) {
    return json.append('"')
      .append(key)
      .append("\":")
      .append(String.format(Locale.ROOT, "%.4f", value));
  }

  private static StringBuilder appendBoolean(StringBuilder json, String key, boolean value) {
    return json.append('"').append(key).append("\":").append(value);
  }

  private static String quote(String value) {
    StringBuilder escaped = new StringBuilder();
    escaped.append('"');
    for (int i = 0; i < value.length(); i++) {
      char ch = value.charAt(i);
      switch (ch) {
        case '"' -> escaped.append("\\\"");
        case '\\' -> escaped.append("\\\\");
        case '\b' -> escaped.append("\\b");
        case '\f' -> escaped.append("\\f");
        case '\n' -> escaped.append("\\n");
        case '\r' -> escaped.append("\\r");
        case '\t' -> escaped.append("\\t");
        default -> {
          if (ch < 0x20) {
            escaped.append(String.format(Locale.ROOT, "\\u%04X", (int) ch));
          } else {
            escaped.append(ch);
          }
        }
      }
    }
    escaped.append('"');
    return escaped.toString();
  }

  private static String knownOrUnknown(String value) {
    return value == null || value.isBlank() ? "unknown" : value;
  }
}
