package com.antigravity.pdf;

import java.io.File;
import java.io.IOException;
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

import org.apache.fontbox.cmap.CMap;
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
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.font.PDCIDFont;
import org.apache.pdfbox.pdmodel.font.PDCIDSystemInfo;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDSimpleFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;
import org.apache.pdfbox.util.Matrix;
import org.apache.pdfbox.util.Vector;

public final class GlyphRepairCli {
  private static final int MAX_GLYPH_SAMPLES_PER_FONT = 24;

  private GlyphRepairCli() {
  }

  public static void main(String[] args) {
    try {
      CliOptions options = CliOptions.parse(args);
      GlyphDiagnosticsReport report = diagnose(options);
      System.out.println(report.toJson());
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

  private static final class CliOptions {
    private final File inputFile;
    private final String pages;

    private CliOptions(File inputFile, String pages) {
      this.inputFile = inputFile;
      this.pages = pages;
    }

    static CliOptions parse(String[] args) {
      if (args.length == 0 || !"diagnose".equals(args[0])) {
        throw new IllegalArgumentException("Usage: glyph-repair diagnose --input <pdf> [--pages 1,2,3|all]");
      }

      File input = null;
      String pages = "all";
      for (int i = 1; i < args.length; i++) {
        String arg = args[i];
        if ("--input".equals(arg) && i + 1 < args.length) {
          input = new File(args[++i]);
        } else if ("--pages".equals(arg) && i + 1 < args.length) {
          pages = args[++i];
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

      return new CliOptions(input, pages);
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
