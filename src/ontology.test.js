const { analyzeVedicText, mergeGraphs, batchAnalyze, generateId } = require('./ontology');

describe('ontology.js', () => {
  describe('generateId', () => {
    it('should generate a deterministic ID based on type and value', () => {
      const id1 = generateId('verse', 'hello world');
      const id2 = generateId('verse', 'hello world');
      const id3 = generateId('concept', 'hello world');

      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1.startsWith('verse_')).toBe(true);
    });
  });

  describe('analyzeVedicText', () => {
    it('should create basic nodes without metadata', () => {
      const text = 'Some vedic verse text';
      const result = analyzeVedicText(text);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);

      const verseNode = result.nodes[0];
      expect(verseNode.type).toBe('verse');
      expect(verseNode.content).toBe(text);
      expect(verseNode.label).toBe('Untitled Mantra');
    });

    it('should process text with all metadata properties', () => {
      const text = 'A profound verse';
      const metadata = {
        title: 'Rig Veda 1.1.1',
        transliteration: 'Agnimile purohitam',
        source: 'Rig Veda',
        deities: ['Agni'],
        rishis: ['Madhuchhandas'],
        concepts: ['Yajna']
      };

      const result = analyzeVedicText(text, metadata);

      const verseNode = result.nodes.find(n => n.type === 'verse');
      expect(verseNode.label).toBe('Rig Veda 1.1.1');
      expect(verseNode.transliteration).toBe('Agnimile purohitam');

      // Nodes: verse(1), source(1), deity(1), rishi(1), concept(1) = 5
      expect(result.nodes).toHaveLength(5);
      // Edges: verse->source, verse->deity, verse->rishi, verse->concept = 4
      expect(result.edges).toHaveLength(4);

      const sourceNode = result.nodes.find(n => n.type === 'source');
      expect(sourceNode.label).toBe('Rig Veda');

      const deityNode = result.nodes.find(n => n.type === 'deity');
      expect(deityNode.label).toBe('Agni');

      const rishiNode = result.nodes.find(n => n.type === 'rishi');
      expect(rishiNode.label).toBe('Madhuchhandas');

      const conceptNode = result.nodes.find(n => n.type === 'concept');
      expect(conceptNode.label).toBe('Yajna');
    });

    it('should extract implicit concepts case-insensitively from text and transliteration', () => {
      const text = 'Understanding brahman and karma is essential';
      const metadata = { transliteration: 'discussing dharma implicitly' };

      const result = analyzeVedicText(text, metadata);

      const concepts = result.nodes
        .filter(n => n.type === 'concept')
        .map(n => n.label);

      expect(concepts).toContain('Brahman');
      expect(concepts).toContain('Karma');
      expect(concepts).toContain('Dharma');

      // Should create correct edges for each concept
      const discussEdges = result.edges.filter(e => e.type === 'discusses');
      expect(discussEdges.length).toBeGreaterThanOrEqual(3);
    });

    it('should not duplicate concepts extracted explicitly vs implicitly', () => {
      const text = 'Brahman is all';
      const metadata = { concepts: ['Brahman'] };

      const result = analyzeVedicText(text, metadata);

      const concepts = result.nodes.filter(n => n.type === 'concept');
      expect(concepts).toHaveLength(1);
    });
  });

  describe('mergeGraphs', () => {
    it('should merge multiple graphs and deduplicate edges', () => {
      const graph1 = {
        nodes: [{ id: 'n1', label: 'Node 1' }, { id: 'n2', label: 'Node 2 v1' }],
        edges: [{ from: 'n1', to: 'n2', type: 'link' }]
      };
      const graph2 = {
        nodes: [{ id: 'n2', label: 'Node 2 v2' }, { id: 'n3', label: 'Node 3' }],
        edges: [
          { from: 'n1', to: 'n2', type: 'link' }, // Duplicate edge
          { from: 'n2', to: 'n3', type: 'link' }
        ]
      };

      const result = mergeGraphs([graph1, graph2]);

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);

      // Node 2 should be overwritten by the second graph (last node wins)
      const n2 = result.nodes.find(n => n.id === 'n2');
      expect(n2.label).toBe('Node 2 v2');
    });

    it('should handle empty or undefined nodes/edges gracefully', () => {
      const g1 = { nodes: [{ id: 'n1' }] };
      const g2 = { edges: [{ from: 'n1', to: 'n2' }] };
      const result = mergeGraphs([g1, g2]);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
    });
  });

  describe('batchAnalyze', () => {
    it('should batch analyze multiple texts and return a merged graph', () => {
      const texts = ['First text about Brahman', 'Second text about Atman'];
      const metadata = [
        { title: 'T1' },
        { title: 'T2', source: 'Upanishad' }
      ];

      const result = batchAnalyze(texts, metadata);

      // nodes: 2 verses, 1 source, 2 concepts (Brahman, Atman)
      const verses = result.nodes.filter(n => n.type === 'verse');
      expect(verses).toHaveLength(2);
      expect(verses[0].label).toBe('T1');
      expect(verses[1].label).toBe('T2');

      const concepts = result.nodes.filter(n => n.type === 'concept');
      expect(concepts.map(c => c.label)).toEqual(expect.arrayContaining(['Brahman', 'Atman']));

      const sources = result.nodes.filter(n => n.type === 'source');
      expect(sources).toHaveLength(1);
    });
  });
});
