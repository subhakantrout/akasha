const crypto = require("crypto");

function generateId(type, value) {
  // Faster than SHA1 - use simple hash for IDs
  const hash = crypto.createHash('md5').update(`${type}:${value}`).digest('hex').slice(0, 10);
  return `${type}_${hash}`;
}

/**
 * Vedic Ontology Logic
 * Maps verses to Deities, Sages (Rishis), and Philosophical Concepts.
 */
function analyzeVedicText(text, metadata = {}) {
  const nodes = [];
  const edges = [];
  const seenNodeIds = new Set();

  // 1. Create the Verse Node
  const verseId = generateId("verse", text.slice(0, 50));
  nodes.push({
    id: verseId,
    type: "verse",
    label: metadata.title || "Untitled Mantra",
    content: text,
    transliteration: metadata.transliteration || "",
  });
  seenNodeIds.add(verseId);

  // 2. Link to Source
  if (metadata.source) {
    const sourceId = generateId("source", metadata.source);
    if (!seenNodeIds.has(sourceId)) {
      nodes.push({ id: sourceId, type: "source", label: metadata.source });
      seenNodeIds.add(sourceId);
    }
    edges.push({ from: verseId, to: sourceId, type: "part_of" });
  }

  // 3. Extract Deities
  if (metadata.deities && Array.isArray(metadata.deities)) {
    metadata.deities.forEach(deity => {
      const dId = generateId("deity", deity);
      if (!seenNodeIds.has(dId)) {
        nodes.push({ id: dId, type: "deity", label: deity });
        seenNodeIds.add(dId);
      }
      edges.push({ from: verseId, to: dId, type: "invokes" });
    });
  }

  // 4. Extract Rishis
  if (metadata.rishis && Array.isArray(metadata.rishis)) {
    metadata.rishis.forEach(rishi => {
      const rId = generateId("rishi", rishi);
      if (!seenNodeIds.has(rId)) {
        nodes.push({ id: rId, type: "rishi", label: rishi });
        seenNodeIds.add(rId);
      }
      edges.push({ from: verseId, to: rId, type: "revealed_by" });
    });
  }

  // 5. Concept Extraction
  const knownConcepts = ["Brahman", "Atman", "Dharma", "Karma", "Maya", "Moksha", "Ananda"];
  const conceptsToLink = new Set();

  if (metadata.concepts && Array.isArray(metadata.concepts)) {
    metadata.concepts.forEach(c => conceptsToLink.add(c));
  }

  const searchText = (text + ' ' + (metadata.transliteration || '')).toLowerCase();
  knownConcepts.forEach(concept => {
    if (searchText.includes(concept.toLowerCase())) {
      conceptsToLink.add(concept);
    }
  });

  conceptsToLink.forEach(concept => {
    const cId = generateId("concept", concept);
    if (!seenNodeIds.has(cId)) {
      nodes.push({ id: cId, type: "concept", label: concept });
      seenNodeIds.add(cId);
    }
    edges.push({ from: verseId, to: cId, type: "discusses" });
  });

  return { nodes, edges };
}

/**
 * Optimized graph merging using O(n) approach instead of O(n²)
 */
function mergeGraphs(graphs) {
  const nodeMap = new Map();
  const edgeSet = new Set(); // O(1) deduplication

  // Process all graphs in single pass
  for (const g of graphs) {
    // Merge nodes
    const nodes = g.nodes;
    if (nodes && Array.isArray(nodes)) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n && n.id) {
          nodeMap.set(n.id, n); // Last node wins (simple merge)
        }
      }
    }

    // Merge edges with O(1) deduplication
    const edges = g.edges;
    if (edges && Array.isArray(edges)) {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e && e.from && e.to) {
          const edgeKey = `${e.from}|${e.to}|${e.type || 'connected'}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            nodeMap.set(`_edge_${edgeKey}`, e); // Temporarily store edges in same map
          }
        }
      }
    }
  }

  // Separate nodes from edges
  const nodes = [];
  const finalEdges = [];

  for (const [key, value] of nodeMap) {
    if (key.startsWith('_edge_')) {
      finalEdges.push(value);
    } else {
      nodes.push(value);
    }
  }

  return { nodes, edges: finalEdges };
}

/**
 * Batch analyze multiple texts efficiently (Yields to event loop)
 */
async function batchAnalyze(texts, metadataList) {
  const allNodes = [];
  const allEdges = [];
  const chunkSize = 100;

  for (let i = 0; i < texts.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, texts.length);
    for (let j = i; j < end; j++) {
      const result = analyzeVedicText(texts[j], metadataList[j] || {});
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
    }

    // Yield to the event loop so we don't block other tasks
    if (end < texts.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  // Yield before starting the merge process
  await new Promise(resolve => setImmediate(resolve));

  // Single merge at the end
  return mergeGraphs([{ nodes: allNodes, edges: allEdges }]);
}

module.exports = {
  analyzeVedicText,
  mergeGraphs,
  batchAnalyze,
  generateId,
};