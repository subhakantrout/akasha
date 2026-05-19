const {
  analyzeVedicText,
  mergeGraphs,
  batchAnalyze,
  generateId,
} = require("../src/ontology");

describe("ontology.js", () => {
  describe("generateId", () => {
    it("should generate a consistent ID for the same type and value", () => {
      const id1 = generateId("verse", "hello world");
      const id2 = generateId("verse", "hello world");
      expect(id1).toEqual(id2);
      expect(id1.startsWith("verse_")).toBe(true);
    });

    it("should generate different IDs for different values", () => {
      const id1 = generateId("verse", "hello world");
      const id2 = generateId("verse", "goodbye world");
      expect(id1).not.toEqual(id2);
    });

    it("should generate different IDs for different types", () => {
      const id1 = generateId("verse", "hello world");
      const id2 = generateId("source", "hello world");
      expect(id1).not.toEqual(id2);
    });
  });

  describe("analyzeVedicText", () => {
    it("should create a basic verse node", () => {
      const text = "I am Brahman";
      const result = analyzeVedicText(text);

      expect(result.nodes).toHaveLength(2); // Verse node and Brahman concept node
      expect(result.edges).toHaveLength(1);

      const verseNode = result.nodes.find(n => n.type === "verse");
      expect(verseNode).toBeDefined();
      expect(verseNode.label).toEqual("Untitled Mantra");
      expect(verseNode.content).toEqual(text);
      expect(verseNode.transliteration).toEqual("");

      const conceptNode = result.nodes.find(n => n.type === "concept");
      expect(conceptNode).toBeDefined();
      expect(conceptNode.label).toEqual("Brahman");
    });

    it("should link to source if provided", () => {
      const text = "Tat Tvam Asi";
      const result = analyzeVedicText(text, { source: "Chandogya Upanishad" });

      const sourceNode = result.nodes.find((n) => n.type === "source");
      expect(sourceNode).toBeDefined();
      expect(sourceNode.label).toEqual("Chandogya Upanishad");

      const verseNode = result.nodes.find((n) => n.type === "verse");
      const edge = result.edges.find((e) => e.from === verseNode.id && e.to === sourceNode.id);
      expect(edge).toBeDefined();
      expect(edge.type).toEqual("part_of");
    });

    it("should extract deities", () => {
      const text = "Praise be to Agni";
      const result = analyzeVedicText(text, { deities: ["Agni", "Indra"] });

      const deityNodes = result.nodes.filter((n) => n.type === "deity");
      expect(deityNodes).toHaveLength(2);

      const agniNode = deityNodes.find(n => n.label === "Agni");
      const indraNode = deityNodes.find(n => n.label === "Indra");
      expect(agniNode).toBeDefined();
      expect(indraNode).toBeDefined();

      const verseNode = result.nodes.find((n) => n.type === "verse");
      const edges = result.edges.filter((e) => e.from === verseNode.id && e.type === "invokes");
      expect(edges).toHaveLength(2);
    });

    it("should extract rishis", () => {
      const text = "Revealed by Vishvamitra";
      const result = analyzeVedicText(text, { rishis: ["Vishvamitra"] });

      const rishiNode = result.nodes.find((n) => n.type === "rishi");
      expect(rishiNode).toBeDefined();
      expect(rishiNode.label).toEqual("Vishvamitra");

      const verseNode = result.nodes.find((n) => n.type === "verse");
      const edge = result.edges.find((e) => e.from === verseNode.id && e.to === rishiNode.id && e.type === "revealed_by");
      expect(edge).toBeDefined();
    });

    it("should extract explicit concepts", () => {
      const text = "Some text";
      const result = analyzeVedicText(text, { concepts: ["CustomConcept"] });

      const conceptNode = result.nodes.find((n) => n.type === "concept");
      expect(conceptNode).toBeDefined();
      expect(conceptNode.label).toEqual("CustomConcept");
    });

    it("should implicitly extract known concepts from text", () => {
      const text = "Understanding Atman and Moksha leads to Ananda";
      const result = analyzeVedicText(text);

      const conceptNodes = result.nodes.filter((n) => n.type === "concept");
      expect(conceptNodes).toHaveLength(3);

      const labels = conceptNodes.map(n => n.label).sort();
      expect(labels).toEqual(["Ananda", "Atman", "Moksha"]);
    });

    it("should deduplicate concepts", () => {
      const text = "Understanding Atman";
      const result = analyzeVedicText(text, { concepts: ["Atman"] });

      const conceptNodes = result.nodes.filter((n) => n.type === "concept");
      expect(conceptNodes).toHaveLength(1);
      expect(conceptNodes[0].label).toEqual("Atman");
    });
  });

  describe("mergeGraphs", () => {
    it("should merge multiple graphs", () => {
      const g1 = {
        nodes: [{ id: "n1", type: "verse" }, { id: "n2", type: "source" }],
        edges: [{ from: "n1", to: "n2", type: "part_of" }],
      };
      const g2 = {
        nodes: [{ id: "n3", type: "verse" }, { id: "n2", type: "source", extra: true }],
        edges: [{ from: "n3", to: "n2", type: "part_of" }],
      };

      const result = mergeGraphs([g1, g2]);

      expect(result.nodes).toHaveLength(3);

      const n2 = result.nodes.find(n => n.id === "n2");
      expect(n2.extra).toBe(true); // Last node wins

      expect(result.edges).toHaveLength(2);
    });

    it("should deduplicate edges", () => {
      const g1 = {
        nodes: [{ id: "n1", type: "verse" }],
        edges: [{ from: "n1", to: "n2", type: "part_of" }],
      };
      const g2 = {
        nodes: [{ id: "n2", type: "source" }],
        edges: [{ from: "n1", to: "n2", type: "part_of" }],
      };

      const result = mergeGraphs([g1, g2]);
      expect(result.edges).toHaveLength(1);
    });

    it("should handle empty or malformed graphs", () => {
      const g1 = { nodes: null, edges: undefined };
      const g2 = {};
      const result = mergeGraphs([g1, g2]);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });
  });

  describe("batchAnalyze", () => {
    it("should analyze multiple texts and return a merged graph", () => {
      const texts = ["Text about Atman", "Text about Brahman"];
      const metadataList = [
        { source: "Source A" },
        { source: "Source B" },
      ];

      const result = batchAnalyze(texts, metadataList);

      // 2 verses + 2 sources + 2 concepts
      expect(result.nodes.filter(n => n.type === "verse")).toHaveLength(2);
      expect(result.nodes.filter(n => n.type === "source")).toHaveLength(2);
      expect(result.nodes.filter(n => n.type === "concept")).toHaveLength(2);

      expect(result.edges).toHaveLength(4); // 2 part_of edges + 2 discusses edges
    });
  });
});
